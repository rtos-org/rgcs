//! `MavlinkCamera`: the MAVLink camera / gimbal driver over the FC link.
//! An actor folds the payload frames into a `watch<Model>`, keeps liveness and sends the info /
//! stream requests; commands read the model and go out from the caller's task.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use async_trait::async_trait;
use mavlink::dialects::ardupilotmega::MavMessage;
use rgcs_core::{CameraCaps, CameraCommand, CameraState, RecordingState, SysId};
use rgcs_mavlink::{MavPort, Outcome, PayloadFrame};
use tokio::sync::{broadcast, watch};
use tokio::task::JoinHandle;
use tokio::time::{Instant, MissedTickBehavior};

use crate::mavlink_cam::apply::{apply, liveness, Model, LIVENESS_MS};
use crate::mavlink_cam::encode::{self, encode, Encoded};
use crate::mavlink_cam::motion::Motion;
use crate::mavlink_cam::requests::{due_requests, Requests, INFO_RETRY_MS};
use crate::{Camera, CameraError};

pub const STALE_MS: u64 = LIVENESS_MS;
pub const INFO_RETRY: Duration = Duration::from_millis(INFO_RETRY_MS);
pub use crate::mavlink_cam::requests::STREAM_RETRY_MS;
pub const TICK: Duration = Duration::from_millis(250);
/// No vehicle HEARTBEAT for this long: the link is down and nothing is requested.
pub const LINK_HB_MS: u64 = 3_000;

/// What the actor and the command path share.
struct Shared {
    sysid: SysId,
    comp_id: u8,
    port: MavPort,
    model: watch::Sender<Model>,
    state: watch::Sender<CameraState>,
}

impl Shared {
    /// Replaces the model with `f(model)` and publishes the state when it, or the caps, changed
    /// (a caps change alone still notifies).
    fn update(&self, f: impl FnOnce(&Model) -> Model) {
        self.model.send_if_modified(|m| {
            let next = f(m);
            if next == *m {
                return false;
            }
            if next.state != m.state || next.caps() != m.caps() {
                self.state.send_replace(next.state.clone());
            }
            *m = next;
            true
        });
    }

    /// The model, but only while connected (`NotConnected` otherwise).
    fn connected_model(&self) -> Result<Model, CameraError> {
        let m = self.model.borrow().clone();
        if m.state.connected {
            Ok(m)
        } else {
            Err(CameraError::NotConnected)
        }
    }

    async fn transmit(&self, e: Encoded) -> Result<(), CameraError> {
        match e {
            Encoded::Message(message) => self
                .port
                .send(message)
                .await
                .map_err(|e| CameraError::Io(e.to_string())),
            Encoded::Command { message, ack_for } => {
                outcome(self.port.command(self.sysid, message, ack_for).await)
            }
        }
    }
}

/// Ruling 7: not ACCEPTED → `camera_rejected`; no ACK → `Io`.
fn outcome(o: Outcome) -> Result<(), CameraError> {
    match o {
        Outcome::Accepted => Ok(()),
        Outcome::Refused(_) => Err(CameraError::Refused("camera_rejected")),
        Outcome::Timeout => Err(CameraError::Io("no COMMAND_ACK".into())),
        Outcome::LinkClosed => Err(CameraError::Io("link closed".into())),
        Outcome::Encode(e) => Err(CameraError::Protocol(e)),
    }
}

/// Ruling 14: an accepted start / stop sets the recording state before the camera reports it.
fn optimistic(cmd: &CameraCommand) -> Option<RecordingState> {
    match cmd {
        CameraCommand::RecordStart => Some(RecordingState::Recording),
        CameraCommand::RecordStop => Some(RecordingState::Idle),
        _ => None,
    }
}

pub struct MavlinkCamera {
    shared: Arc<Shared>,
    task: Mutex<Option<JoinHandle<()>>>,
    motion: Mutex<Motion>,
}

impl MavlinkCamera {
    /// `comp_id` is the profile's component id (a native MAVLink camera).
    pub fn new(sysid: SysId, comp_id: u8, port: MavPort) -> Self {
        let model = Model::new();
        let state = model.state.clone();
        let shared = Shared {
            sysid,
            comp_id,
            port,
            model: watch::Sender::new(model),
            state: watch::Sender::new(state),
        };
        Self {
            shared: Arc::new(shared),
            task: Mutex::new(None),
            motion: Mutex::new(Motion::default()),
        }
    }

    /// Whether `cmd` goes out; a rate-0 with nothing moving is dropped.
    fn admit(&self, cmd: &CameraCommand) -> bool {
        let Ok(mut motion) = self.motion.lock() else {
            return true;
        };
        let (next, send) = motion.admit(cmd, Instant::now());
        *motion = next;
        send
    }

    fn pointed(&self) {
        if let Ok(mut motion) = self.motion.lock() {
            *motion = Motion::pointed();
        }
    }

    async fn roi(
        &self,
        build: impl FnOnce(&Model) -> Result<Encoded, CameraError>,
    ) -> Result<(), CameraError> {
        let m = self.shared.connected_model()?;
        self.shared.transmit(build(&m)?).await
    }
}

#[async_trait]
impl Camera for MavlinkCamera {
    fn caps(&self) -> CameraCaps {
        self.shared.model.borrow().caps()
    }

    async fn send(&self, cmd: CameraCommand) -> Result<(), CameraError> {
        let m = self.shared.connected_model()?;
        if !self.admit(&cmd) {
            tracing::debug!("mavlink camera: rate-0 with no movement dropped");
            return Ok(());
        }
        let frames = encode(&cmd, &m.targets(self.shared.sysid), m.state.zoom)?;
        for frame in frames {
            self.shared.transmit(frame).await?;
        }
        if let Some(recording) = optimistic(&cmd) {
            self.shared.update(|m| Model {
                state: CameraState {
                    recording,
                    ..m.state.clone()
                },
                ..m.clone()
            });
        }
        Ok(())
    }

    fn state(&self) -> watch::Receiver<CameraState> {
        self.shared.state.subscribe()
    }

    async fn connect(&self) -> Result<(), CameraError> {
        let mut task = self
            .task
            .lock()
            .map_err(|_| CameraError::Io("driver lock poisoned".into()))?;
        if task.as_ref().is_some_and(|t| !t.is_finished()) {
            return Ok(());
        }
        // Subscribe before the first info request goes out, so its reply cannot be missed.
        let frames = self.shared.port.subscribe();
        *task = Some(tokio::spawn(run(self.shared.clone(), frames)));
        Ok(())
    }

    async fn disconnect(&self) {
        let task = self.task.lock().ok().and_then(|mut t| t.take());
        if let Some(task) = task {
            task.abort();
        }
    }

    /// The attitude is streamed at 10 Hz; nothing to ask for.
    async fn request_attitude(&self) -> Result<(), CameraError> {
        Ok(())
    }

    async fn roi_location(&self, lat: f64, lon: f64, alt_msl: f64) -> Result<(), CameraError> {
        let sysid = self.shared.sysid;
        self.pointed();
        self.roi(|m| encode::roi_location(&m.targets(sysid), lat, lon, alt_msl))
            .await
    }

    async fn roi_none(&self) -> Result<(), CameraError> {
        let sysid = self.shared.sysid;
        self.pointed();
        self.roi(|m| encode::roi_none(&m.targets(sysid))).await
    }
}

impl Drop for MavlinkCamera {
    fn drop(&mut self) {
        if let Some(task) = self.task.lock().ok().and_then(|mut t| t.take()) {
            task.abort();
        }
    }
}

/// The actor: frames from the vehicle's system, the 250 ms liveness / request tick.
async fn run(shared: Arc<Shared>, mut frames: broadcast::Receiver<PayloadFrame>) {
    let epoch = Instant::now();
    let now_ms = move || epoch.elapsed().as_millis() as u64;
    let mut tick = tokio::time::interval(TICK);
    tick.set_missed_tick_behavior(MissedTickBehavior::Delay);
    let mut requests = Requests::default();
    let mut hb_ms: Option<u64> = None;
    loop {
        tokio::select! {
            frame = frames.recv() => match frame {
                Ok(f) if f.header.system_id == shared.sysid
                    && matches!(f.message, MavMessage::HEARTBEAT(_)) => hb_ms = Some(now_ms()),
                Ok(f) if f.header.system_id == shared.sysid => {
                    let now = now_ms();
                    shared.update(|m| liveness(&apply(m, &f, shared.comp_id, now), now));
                }
                Ok(_) | Err(broadcast::error::RecvError::Lagged(_)) => {}
                Err(broadcast::error::RecvError::Closed) => break,
            },
            _ = tick.tick() => {
                let now = now_ms();
                let link_up = hb_ms.is_some_and(|t| now.saturating_sub(t) < LINK_HB_MS);
                requests = on_tick(&shared, &requests, now, link_up);
            }
        }
    }
}

/// Liveness, then the due info / stream requests (fire and forget). While the vehicle sends
/// no HEARTBEAT nothing is asked and the schedule counts as disconnected, so the first tick
/// with the link back is a (re)connect edge; a full link queue drops the request (the next
/// tick repeats it) instead of waiting.
fn on_tick(shared: &Shared, requests: &Requests, now: u64, link_up: bool) -> Requests {
    shared.update(|m| liveness(m, now));
    if !link_up {
        return Requests {
            connected: false,
            lost: requests.lost || requests.connected,
            ..requests.clone()
        };
    }
    let model = shared.model.borrow().clone();
    let (next, msgs) = due_requests(&model, requests, shared.sysid, now);
    for msg in msgs {
        if let Err(e) = shared.port.try_send(msg) {
            tracing::debug!("mavlink camera request dropped: {e}");
        }
    }
    next
}

#[cfg(test)]
#[path = "driver_tests.rs"]
mod tests;

#[cfg(test)]
#[path = "link_tests.rs"]
mod link_tests;
