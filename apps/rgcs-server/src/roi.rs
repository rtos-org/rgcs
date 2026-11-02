//! GPS ROI runtime (Computed and Native): one task per active vehicle aims the gimbal at a preset
//!. Every start / stop / config / target change and every control tick go
//! through that single task, so a stop can never be followed by a stale command.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Duration, Instant};

use rgcs_core::{RoiControl, RoiMode, RoiTarget, ServerMessage, SysId};
use rgcs_mavlink::Router;
use rgcs_store::Store;
use tokio::sync::{broadcast, mpsc, oneshot, Mutex};

use crate::cameras::CameraManager;

pub use rgcs_camera::roi::controller::StopReason;

/// `roi_status` cadence while active (2 Hz).
pub const STATUS_EVERY: Duration = Duration::from_millis(500);
/// A camera send slower than this counts as failed (no watchdog thread).
pub const SEND_TIMEOUT: Duration = Duration::from_millis(200);
/// Stick speeds below this are ignored while ROI is active; at or above it cancel ROI.
pub const MANUAL_THRESHOLD: i8 = 5;
/// How long `shutdown_all` waits for the zero resends to go out.
const SHUTDOWN_GRACE: Duration = Duration::from_secs(1);

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RoiError {
    NotFound,
    Unset,
    Unsupported,
    CameraOffline,
    Internal(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ManualVerdict {
    Forward,
    Drop,
}

/// Requests to a vehicle's ROI task; each is acknowledged once applied.
pub(crate) enum Cmd {
    Start {
        target: RoiTarget,
        control: RoiControl,
        ack: oneshot::Sender<()>,
    },
    /// Replies whether ROI was active.
    Stop(StopReason, oneshot::Sender<bool>),
    Configure(RoiControl, oneshot::Sender<()>),
    Targets(Vec<RoiTarget>, oneshot::Sender<()>),
}

struct Handle {
    gen: u64,
    /// Which task runs it: `Computed` (`roi_task`) or `Native` (`roi_native`).
    mode: RoiMode,
    cmds: mpsc::UnboundedSender<Cmd>,
    /// The active preset id, written by the task before it acknowledges.
    active: Option<String>,
}

#[derive(Clone)]
pub struct RoiHub {
    pub(crate) store: Store,
    pub(crate) cameras: CameraManager,
    pub(crate) router: Arc<Mutex<Router>>,
    pub(crate) tx: broadcast::Sender<ServerMessage>,
    handles: Arc<StdMutex<HashMap<SysId, Handle>>>,
    next_gen: Arc<AtomicU64>,
    epoch: Instant,
}

impl RoiHub {
    pub fn new(
        store: Store,
        cameras: CameraManager,
        router: Arc<Mutex<Router>>,
        tx: broadcast::Sender<ServerMessage>,
    ) -> Self {
        let handles: Arc<StdMutex<HashMap<SysId, Handle>>> = Arc::new(StdMutex::new(HashMap::new()));
        let owned = handles.clone();
        cameras.set_gimbal_owned(Arc::new(move |sysid| {
            owned
                .lock()
                .map(|h| h.get(&sysid).is_some_and(|h| h.active.is_some()))
                .unwrap_or(false)
        }));
        Self {
            store,
            cameras,
            router,
            tx,
            handles,
            next_gen: Arc::new(AtomicU64::new(1)),
            epoch: Instant::now(),
        }
    }

    /// Starts (or switches) ROI on preset `id`; returns once the task has applied it.
    pub async fn start(&self, sysid: SysId, id: &str) -> Result<RoiTarget, RoiError> {
        let targets = self.store.roi_targets(sysid).await.map_err(internal)?;
        let target = targets
            .into_iter()
            .find(|t| t.id == id)
            .ok_or(RoiError::NotFound)?;
        let camera = self.cameras.ensure(sysid).await;
        let mode = camera.caps().roi;
        if !matches!(mode, RoiMode::Computed | RoiMode::Native) {
            return Err(RoiError::Unsupported);
        }
        if !camera.state().borrow().connected {
            return Err(RoiError::CameraOffline);
        }
        if !target.is_set() {
            return Err(RoiError::Unset);
        }
        if camera.caps().ai_tracking.is_some() {
            self.cancel_ai_tracking(sysid).await;
        }
        let control = self.store.roi_control(sysid).await.map_err(internal)?;
        let (ack, done) = oneshot::channel();
        let cmd = Cmd::Start {
            target: target.clone(),
            control,
            ack,
        };
        self.dispatch(sysid, cmd, Some(mode));
        done.await
            .map_err(|_| RoiError::Internal("roi task ended".into()))?;
        Ok(target)
    }

    /// Ruling 9: ROI and the AI tracker never steer the gimbal together, so a start cancels
    /// tracking first. A failure is logged and does not block the start.
    async fn cancel_ai_tracking(&self, sysid: SysId) {
        let cancel = self.cameras.send(sysid, rgcs_core::CameraCommand::AiCancel);
        match tokio::time::timeout(SEND_TIMEOUT, cancel).await {
            Ok(Ok(())) => {}
            Ok(Err(e)) => tracing::warn!(sysid, error = %e, "ROI start: AI tracking cancel failed"),
            Err(_) => tracing::warn!(sysid, "ROI start: AI tracking cancel timed out"),
        }
    }

    /// Stops ROI and waits until the task has sent its zero; `false` when it was inactive.
    pub async fn stop(&self, sysid: SysId, reason: StopReason) -> bool {
        let (reply, done) = oneshot::channel();
        if !self.dispatch(sysid, Cmd::Stop(reason, reply), None) {
            return false;
        }
        done.await.unwrap_or(false)
    }

    pub fn active_target(&self, sysid: SysId) -> Option<String> {
        self.lock().get(&sysid).and_then(|h| h.active.clone())
    }

    /// A joystick / WS gimbal rate: small speeds are dropped, large ones cancel ROI first.
    pub async fn on_manual_rate(&self, sysid: SysId, yaw: i8, pitch: i8) -> ManualVerdict {
        if self.active_target(sysid).is_none() {
            return ManualVerdict::Forward;
        }
        let threshold = MANUAL_THRESHOLD.unsigned_abs();
        if yaw.unsigned_abs().max(pitch.unsigned_abs()) < threshold {
            return ManualVerdict::Drop;
        }
        self.stop(sysid, StopReason::Manual).await;
        ManualVerdict::Forward
    }

    /// Ruling 7: joystick zeros are dropped while ROI owns the gimbal.
    pub fn on_zero(&self, sysid: SysId) -> ManualVerdict {
        match self.active_target(sysid) {
            Some(_) => ManualVerdict::Drop,
            None => ManualVerdict::Forward,
        }
    }

    pub async fn configure(&self, sysid: SysId, c: RoiControl) {
        let (ack, done) = oneshot::channel();
        if self.dispatch(sysid, Cmd::Configure(c, ack), None) {
            let _ = done.await;
        }
    }

    pub async fn set_targets(&self, sysid: SysId, t: Vec<RoiTarget>) {
        let (ack, done) = oneshot::channel();
        if self.dispatch(sysid, Cmd::Targets(t, ack), None) {
            let _ = done.await;
        }
    }

    /// Graceful shutdown: stop every vehicle and give the zero resends time to go out.
    pub async fn shutdown_all(&self) {
        let sysids: Vec<SysId> = self.lock().keys().copied().collect();
        for sysid in sysids {
            self.stop(sysid, StopReason::Shutdown).await;
        }
        let deadline = Instant::now() + SHUTDOWN_GRACE;
        while !self.lock().is_empty() && Instant::now() < deadline {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    }

    /// Monotonic ms since the hub was built (attitude stamps, controller clock).
    pub(crate) fn now_ms(&self) -> u64 {
        self.epoch.elapsed().as_millis() as u64
    }

    pub(crate) fn broadcast(&self, sysid: SysId, status: rgcs_core::RoiStatus) {
        let _ = self.tx.send(ServerMessage::RoiStatus { sysid, status });
    }

    /// The task publishes its active preset (ignored once its handle was replaced).
    pub(crate) fn publish_active(&self, sysid: SysId, gen: u64, active: Option<String>) {
        if let Some(h) = self.lock().get_mut(&sysid).filter(|h| h.gen == gen) {
            h.active = active;
        }
    }

    /// The idle task leaves only if no request is queued; sends happen under the same lock,
    /// so a request can never land in a channel nobody reads.
    pub(crate) fn try_retire(&self, sysid: SysId, gen: u64, cmds: &mpsc::UnboundedReceiver<Cmd>) -> bool {
        let mut handles = self.lock();
        if !cmds.is_empty() {
            return false;
        }
        if handles.get(&sysid).is_some_and(|h| h.gen == gen) {
            handles.remove(&sysid);
        }
        true
    }

    /// Hands `cmd` to the vehicle's task; with `spawn`, starts the task for that ROI mode if
    /// none is running. A running task of the other mode (the camera kind changed) is
    /// replaced: dropping its sender ends it once its queue is drained.
    fn dispatch(&self, sysid: SysId, cmd: Cmd, spawn: Option<RoiMode>) -> bool {
        let mut handles = self.lock();
        let cmd = match handles.get(&sysid) {
            Some(h) if spawn.is_none_or(|m| m == h.mode) => match h.cmds.send(cmd) {
                Ok(()) => return true,
                Err(mpsc::error::SendError(cmd)) => cmd,
            },
            _ => cmd,
        };
        handles.remove(&sysid);
        let Some(mode) = spawn else {
            return false;
        };
        let gen = self.next_gen.fetch_add(1, Ordering::Relaxed);
        let (tx, rx) = mpsc::unbounded_channel();
        let _ = tx.send(cmd);
        handles.insert(
            sysid,
            Handle {
                gen,
                mode,
                cmds: tx,
                active: None,
            },
        );
        match mode {
            RoiMode::Native => tokio::spawn(crate::roi_native::run(self.clone(), sysid, gen, rx)),
            _ => tokio::spawn(crate::roi_task::run(self.clone(), sysid, gen, rx)),
        };
        true
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<SysId, Handle>> {
        self.handles.lock().expect("roi handles mutex")
    }
}

fn internal(e: impl std::fmt::Display) -> RoiError {
    RoiError::Internal(e.to_string())
}
