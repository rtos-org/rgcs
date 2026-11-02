//! One camera driver per vehicle, built from `camera_profiles`; state changes are broadcast
//! as `camera_state` (on change and at least every second).

use std::collections::HashMap;
use std::net::Ipv4Addr;
#[cfg(any(test, feature = "sim"))]
use std::net::SocketAddr;
use std::sync::{Arc, RwLock};
use std::time::Duration;

use rgcs_camera::camera::GpsTime;
use rgcs_camera::{Camera, CameraError, MavlinkCamera, NoneCamera, SiyiMt11};
use rgcs_core::{CameraCommand, CameraKind, CameraProfile, CameraSnapshot, ServerMessage, SysId};
use rgcs_mavlink::MavPort;
use rgcs_store::Store;
use tokio::sync::{broadcast, Mutex};
use tokio::task::JoinHandle;

const RESEND_EVERY: Duration = Duration::from_secs(1);
/// Ruling 8: `camera_state` frames go out at most every 100 ms (10 Hz).
pub const STATE_MIN_GAP: Duration = Duration::from_millis(100);

/// How drivers are built. `Sim` ignores the profile host and connects to the simulator.
#[derive(Debug, Clone, Copy)]
pub enum CameraFactory {
    Real,
    #[cfg(any(test, feature = "sim"))]
    Sim(SocketAddr),
}

/// True while something else (an active ROI) owns the gimbal of that vehicle.
pub type GimbalOwned = Arc<dyn Fn(SysId) -> bool + Send + Sync>;

/// Builds the clock-sync GPS source of a vehicle.
pub type GpsTimeFactory = Arc<dyn Fn(SysId) -> Arc<dyn GpsTime> + Send + Sync>;

struct Entry {
    camera: Arc<dyn Camera>,
    forwarder: JoinHandle<()>,
    link_zero: JoinHandle<()>,
}

#[derive(Clone)]
pub struct CameraManager {
    store: Store,
    tx: broadcast::Sender<ServerMessage>,
    factory: CameraFactory,
    entries: Arc<Mutex<HashMap<SysId, Entry>>>,
    owned: Arc<RwLock<Option<GimbalOwned>>>,
    gps_time: Arc<RwLock<Option<GpsTimeFactory>>>,
    mav: Arc<RwLock<Option<MavPort>>>,
}

impl CameraManager {
    pub fn new(store: Store, tx: broadcast::Sender<ServerMessage>, factory: CameraFactory) -> Self {
        Self {
            store,
            tx,
            factory,
            entries: Arc::new(Mutex::new(HashMap::new())),
            owned: Arc::new(RwLock::new(None)),
            gps_time: Arc::new(RwLock::new(None)),
            mav: Arc::new(RwLock::new(None)),
        }
    }

    /// Installs the GPS time source drivers get when their profile has `clock_sync` on.
    pub fn set_gps_time(&self, f: GpsTimeFactory) {
        if let Ok(mut slot) = self.gps_time.write() {
            *slot = Some(f);
        }
    }

    fn gps_time_for(&self, profile: &CameraProfile) -> Option<Arc<dyn GpsTime>> {
        if !profile.clock_sync {
            return None;
        }
        self.gps_time
            .read()
            .ok()
            .and_then(|f| f.as_ref().map(|f| f(profile.sysid)))
    }

    /// Installs the FC link port `mavlink` drivers send and listen on.
    pub fn set_mav_port(&self, port: MavPort) {
        if let Ok(mut slot) = self.mav.write() {
            *slot = Some(port);
        }
    }

    fn mav_port(&self) -> MavPort {
        self.mav
            .read()
            .ok()
            .and_then(|p| p.clone())
            .unwrap_or_else(MavPort::detached)
    }

    /// Installs the check that suppresses the link-up zero while ROI owns the gimbal.
    pub fn set_gimbal_owned(&self, owned: GimbalOwned) {
        if let Ok(mut slot) = self.owned.write() {
            *slot = Some(owned);
        }
    }

    fn gimbal_owned(&self, sysid: SysId) -> bool {
        self.owned
            .read()
            .ok()
            .and_then(|o| o.as_ref().map(|f| f(sysid)))
            .unwrap_or(false)
    }

    fn build(&self, profile: &CameraProfile) -> Arc<dyn Camera> {
        match profile.kind {
            CameraKind::Mavlink => Arc::new(MavlinkCamera::new(
                profile.sysid,
                profile.comp_id,
                self.mav_port(),
            )),
            CameraKind::SiyiMt11 => self.build_mt11(profile),
            _ => Arc::new(NoneCamera::default()),
        }
    }

    fn build_mt11(&self, profile: &CameraProfile) -> Arc<dyn Camera> {
        let mt11 = match (profile.kind, self.factory) {
            (CameraKind::SiyiMt11, CameraFactory::Real) => {
                let host = profile.host.parse().unwrap_or(Ipv4Addr::new(192, 168, 144, 25));
                SiyiMt11::new(host, profile.port)
            }
            #[cfg(any(test, feature = "sim"))]
            (CameraKind::SiyiMt11, CameraFactory::Sim(addr)) => {
                SiyiMt11::new(Ipv4Addr::LOCALHOST, addr.port())
            }
            _ => return Arc::new(NoneCamera::default()),
        };
        match self.gps_time_for(profile) {
            Some(src) => Arc::new(mt11.with_gps_time(src)),
            None => Arc::new(mt11),
        }
    }

    /// The running driver of `sysid`, without spawning one.
    pub async fn get(&self, sysid: SysId) -> Option<Arc<dyn Camera>> {
        self.entries.lock().await.get(&sysid).map(|e| e.camera.clone())
    }

    /// The driver for `sysid`, spawning it from the stored profile on first use.
    pub async fn ensure(&self, sysid: SysId) -> Arc<dyn Camera> {
        if let Some(e) = self.entries.lock().await.get(&sysid) {
            return e.camera.clone();
        }
        let profile = self
            .store
            .camera_profile(sysid)
            .await
            .unwrap_or_else(|_| CameraProfile::default_for(sysid));
        self.install(sysid, &profile).await
    }

    async fn install(&self, sysid: SysId, profile: &CameraProfile) -> Arc<dyn Camera> {
        let camera = self.build(profile);
        if let Err(e) = camera.connect().await {
            tracing::warn!(sysid, error = %e, "camera connect failed");
        }
        let forwarder = tokio::spawn(forward(sysid, camera.clone(), self.tx.clone()));
        let link_zero = tokio::spawn(link_zero(self.clone(), sysid, profile.kind, camera.clone()));
        let mut entries = self.entries.lock().await;
        if let Some(old) = entries.insert(
            sysid,
            Entry {
                camera: camera.clone(),
                forwarder,
                link_zero,
            },
        ) {
            old.forwarder.abort();
            old.link_zero.abort();
            old.camera.disconnect().await;
        }
        camera
    }

    /// Starts every driver with a saved, non-`none` profile (server boot).
    pub async fn ensure_all_configured(&self) {
        let sysids = self.store.camera_profile_sysids().await.unwrap_or_default();
        for sysid in sysids {
            self.ensure(sysid).await;
        }
    }

    /// Disconnects the current driver and spawns one from the (new) profile.
    pub async fn reload(&self, sysid: SysId) {
        let profile = self
            .store
            .camera_profile(sysid)
            .await
            .unwrap_or_else(|_| CameraProfile::default_for(sysid));
        self.install(sysid, &profile).await;
    }

    pub async fn snapshot(&self) -> Vec<CameraSnapshot> {
        let entries = self.entries.lock().await;
        let mut out: Vec<CameraSnapshot> = entries
            .iter()
            .map(|(sysid, e)| CameraSnapshot {
                sysid: *sysid,
                caps: e.camera.caps(),
                state: e.camera.state().borrow().clone(),
            })
            .collect();
        out.sort_by_key(|c| c.sysid);
        out
    }

    /// The refusal `send` would return now (capability, link, driver preconditions), with
    /// nothing sent.
    pub async fn check(&self, sysid: SysId, cmd: &CameraCommand) -> Result<(), CameraError> {
        let camera = self.ensure(sysid).await;
        if !camera.caps().supports(cmd) {
            return Err(CameraError::Unsupported(cmd.name()));
        }
        camera.check(cmd).await
    }

    /// Capability-checked send.
    pub async fn send(&self, sysid: SysId, cmd: CameraCommand) -> Result<(), CameraError> {
        let camera = self.ensure(sysid).await;
        if !camera.caps().supports(&cmd) {
            return Err(CameraError::Unsupported(cmd.name()));
        }
        camera.send(cmd).await
    }
}

/// Ruling 18 + I5: every time the link comes up (first connect of a driver and every
/// reconnect) the gimbal gets speed 0, unless an active ROI owns it. This covers a crash, a
/// stop while the link was down (its zero failed) and a manual cancel while offline.
/// Rate support is re-read on every edge (caps can change after connect). A `mavlink` camera
/// rides the FC link: a rate 0 there would end FC-side targeting, so it gets none.
async fn link_zero(manager: CameraManager, sysid: SysId, kind: CameraKind, camera: Arc<dyn Camera>) {
    if kind == CameraKind::Mavlink {
        return;
    }
    let mut state = camera.state();
    loop {
        if state.wait_for(|s| s.connected).await.is_err() {
            return;
        }
        let rate = camera.caps().gimbal.is_some_and(|g| g.rate);
        if rate && !manager.gimbal_owned(sysid) {
            if let Err(e) = camera.send(CameraCommand::GimbalRate { yaw: 0, pitch: 0 }).await {
                tracing::warn!(sysid, error = %e, "link-up gimbal zero failed");
            }
        }
        if state.wait_for(|s| !s.connected).await.is_err() {
            return;
        }
    }
}

/// Broadcasts state changes at most every `STATE_MIN_GAP` (a burst collapses into its newest
/// state) and re-sends the current state each second. The caps are read for every frame, so
/// a driver that learns its caps after connecting reaches the UI.
async fn forward(sysid: SysId, camera: Arc<dyn Camera>, tx: broadcast::Sender<ServerMessage>) {
    let mut rx = camera.state();
    loop {
        let state = rx.borrow_and_update().clone();
        let sent_at = tokio::time::Instant::now();
        let _ = tx.send(ServerMessage::CameraState {
            sysid,
            caps: camera.caps(),
            state,
        });
        tokio::select! {
            changed = rx.changed() => { if changed.is_err() { return; } }
            _ = tokio::time::sleep_until(sent_at + RESEND_EVERY) => {}
        }
        tokio::time::sleep_until(sent_at + STATE_MIN_GAP).await;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rgcs_core::{CameraCaps, CameraState};
    use tokio::time::Instant;

    /// Collects (arrival offset, zoom) of every `camera_state` frame until the channel closes.
    fn collect(
        mut rx: broadcast::Receiver<ServerMessage>,
        start: Instant,
    ) -> JoinHandle<Vec<(Duration, f32)>> {
        tokio::spawn(async move {
            let mut out = Vec::new();
            while let Ok(ServerMessage::CameraState { state, .. }) = rx.recv().await {
                out.push((start.elapsed(), state.zoom));
            }
            out
        })
    }

    /// A driver whose caps and state the test sets.
    struct FakeCam {
        caps: std::sync::Mutex<CameraCaps>,
        state: tokio::sync::watch::Sender<CameraState>,
    }

    impl FakeCam {
        fn new() -> Arc<Self> {
            let (state, _) = tokio::sync::watch::channel(CameraState::disconnected(1.0));
            Arc::new(Self {
                caps: std::sync::Mutex::new(CameraCaps::none()),
                state,
            })
        }

        fn set_caps(&self, caps: CameraCaps) {
            if let Ok(mut c) = self.caps.lock() {
                *c = caps;
            }
        }
    }

    #[async_trait::async_trait]
    impl Camera for FakeCam {
        fn caps(&self) -> CameraCaps {
            self.caps
                .lock()
                .map(|c| c.clone())
                .unwrap_or_else(|_| CameraCaps::none())
        }
        async fn send(&self, _cmd: CameraCommand) -> Result<(), CameraError> {
            Ok(())
        }
        fn state(&self) -> tokio::sync::watch::Receiver<CameraState> {
            self.state.subscribe()
        }
        async fn connect(&self) -> Result<(), CameraError> {
            Ok(())
        }
        async fn disconnect(&self) {}
    }

    #[tokio::test]
    async fn forward_sends_current_caps() {
        let cam = FakeCam::new();
        let (tx, mut rx) = broadcast::channel(16);
        let task = tokio::spawn(forward(1, cam.clone(), tx));
        let first = rx.recv().await.expect("first frame");
        cam.set_caps(CameraCaps::siyi_mt11());
        cam.state.send_modify(|_| {});
        let second = rx.recv().await.expect("second frame");
        task.abort();
        let kinds: Vec<CameraCaps> = [first, second]
            .into_iter()
            .filter_map(|m| match m {
                ServerMessage::CameraState { caps, .. } => Some(caps),
                _ => None,
            })
            .collect();
        assert_eq!(kinds, vec![CameraCaps::none(), CameraCaps::siyi_mt11()]);
    }

    #[tokio::test]
    async fn forward_caps_bursts_at_10_hz() {
        let cam = FakeCam::new();
        let state_tx = cam.state.clone();
        let (tx, rx) = broadcast::channel(256);
        let start = Instant::now();
        let frames = collect(rx, start);
        let task = tokio::spawn(forward(1, cam.clone(), tx));
        for i in 1..=50u16 {
            let next = CameraState {
                zoom: f32::from(i),
                ..state_tx.borrow().clone()
            };
            state_tx.send_replace(next);
            tokio::time::sleep_until(start + Duration::from_millis(4) * u32::from(i)).await;
        }
        tokio::time::sleep(Duration::from_millis(300)).await;
        task.abort();
        let _ = task.await;
        let frames = frames.await.expect("collector");
        let window = Duration::from_millis(200);
        let in_window = frames.iter().filter(|(at, _)| *at < window).count();
        assert!(in_window <= 4, "{in_window} frames in 200 ms: {frames:?}");
        assert_eq!(frames.last().map(|f| f.1), Some(50.0), "{frames:?}");
    }
}
