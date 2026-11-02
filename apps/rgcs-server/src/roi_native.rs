//! The per-vehicle GPS ROI task for `caps.roi = native`: the
//! gimbal manager aims by itself, so this task only sends `DO_SET_ROI_LOCATION` /
//! `DO_SET_ROI_NONE` through `NativeRoi` and reports a display-only `roi_status`.
//!
//! Camera offline (like the computed ROI): ROI stays active with `camera_offline`, no location
//! is sent, and the reconnect edge re-asserts it at once. A release that cannot reach the
//! manager while offline is kept pending and sent on the reconnect edge.

use std::sync::Arc;
use std::time::Duration;

use rgcs_camera::roi::controller::codes;
use rgcs_camera::roi::inputs::vehicle_fix;
use rgcs_camera::roi::native::{NativeOut, NativeRoi};
use rgcs_camera::{Camera, CameraError};
use rgcs_core::{RoiStatus, SysId};
use rgcs_mavlink::GLOBAL_POSITION_INT_ID;
use tokio::sync::mpsc;
use tokio::time::{interval, timeout, Interval, MissedTickBehavior};

use crate::roi::{Cmd, RoiHub, STATUS_EVERY};

/// One native send waits for its COMMAND_ACK (1.5 s), so it gets more than `SEND_TIMEOUT`.
pub const NATIVE_SEND_TIMEOUT: Duration = Duration::from_secs(2);
/// A failed release is tried once more.
const RELEASE_ATTEMPTS: usize = 2;

struct Runner {
    hub: RoiHub,
    sysid: SysId,
    gen: u64,
    roi: NativeRoi,
    offline: bool,
    pending_release: bool,
}

fn every(period: Duration) -> Interval {
    let mut iv = interval(period);
    iv.set_missed_tick_behavior(MissedTickBehavior::Skip);
    iv
}

pub(crate) async fn run(hub: RoiHub, sysid: SysId, gen: u64, mut cmds: mpsc::UnboundedReceiver<Cmd>) {
    let mut r = Runner {
        hub,
        sysid,
        gen,
        roi: NativeRoi::default(),
        offline: false,
        pending_release: false,
    };
    let mut tick = every(STATUS_EVERY);
    loop {
        let was_active = r.roi.is_active();
        tokio::select! {
            cmd = cmds.recv() => match cmd {
                Some(cmd) => r.on_cmd(cmd).await,
                None => return,
            },
            _ = tick.tick() => r.on_tick().await,
        }
        if r.roi.is_active() != was_active {
            r.publish();
            r.broadcast().await;
            tick.reset();
        }
        let idle = !r.roi.is_active() && !r.pending_release;
        if idle && r.hub.try_retire(sysid, gen, &cmds) {
            return;
        }
    }
}

impl Runner {
    async fn on_cmd(&mut self, cmd: Cmd) {
        match cmd {
            Cmd::Start { target, ack, .. } => {
                self.pending_release = false;
                self.offline = !self.camera().await.state().borrow().connected;
                let (next, out) = self.roi.start(target, self.hub.now_ms());
                self.apply(next, out).await;
                self.publish();
                let _ = ack.send(());
            }
            Cmd::Stop(_, reply) => {
                let was = self.roi.is_active();
                let (next, out) = self.roi.stop();
                self.apply(next, out).await;
                self.publish();
                let _ = reply.send(was);
            }
            // RoiControl (rate / angle / PID) does not apply to a native gimbal manager.
            Cmd::Configure(_, ack) => {
                let _ = ack.send(());
            }
            Cmd::Targets(targets, ack) => {
                let (next, out) = self.roi.retarget(&targets, self.hub.now_ms());
                self.apply(next, out).await;
                self.publish();
                let _ = ack.send(());
            }
        }
    }

    /// Liveness edges, the 5 s re-assert and the 2 Hz status.
    async fn on_tick(&mut self) {
        let now = self.hub.now_ms();
        let was_offline = self.offline;
        self.offline = !self.camera().await.state().borrow().connected;
        if self.offline {
            if self.roi.is_active() {
                self.broadcast().await;
            }
            return;
        }
        if self.pending_release {
            self.pending_release = false;
            self.release().await;
        }
        let (next, out) = if was_offline {
            self.roi.resend(now)
        } else {
            self.roi.tick(now)
        };
        self.apply(next, out).await;
        if self.roi.is_active() {
            self.broadcast().await;
        }
    }

    async fn apply(&mut self, next: NativeRoi, out: Vec<NativeOut>) {
        self.roi = next;
        for o in out {
            match o {
                NativeOut::Point { lat, lon, alt_msl } => self.point(lat, lon, alt_msl).await,
                NativeOut::Release => self.release().await,
            }
        }
    }

    /// Skipped while offline: the reconnect edge re-sends the location.
    async fn point(&mut self, lat: f64, lon: f64, alt_msl: f64) {
        if self.offline {
            return;
        }
        let camera = self.camera().await;
        let ok = bounded(camera.roi_location(lat, lon, alt_msl)).await.is_ok();
        if !ok {
            tracing::warn!(sysid = self.sysid, "native ROI location not accepted");
        }
        self.roi = self.roi.sent(ok);
    }

    /// `ROI_NONE`, retried once; kept pending for the reconnect edge when the camera is offline.
    async fn release(&mut self) {
        let camera = self.camera().await;
        let mut last = Ok(());
        for _ in 0..RELEASE_ATTEMPTS {
            last = bounded(camera.roi_none()).await;
            if last.is_ok() {
                return;
            }
        }
        let offline = matches!(last, Err(CameraError::NotConnected)) || !camera.state().borrow().connected;
        tracing::warn!(sysid = self.sysid, offline, "native ROI release not accepted");
        self.pending_release = offline;
    }

    async fn camera(&self) -> Arc<dyn Camera> {
        self.hub.cameras.ensure(self.sysid).await
    }

    async fn status(&self) -> RoiStatus {
        let (state, age) = {
            let router = self.hub.router.lock().await;
            (
                router.state(self.sysid).cloned(),
                router.message_age_ms(self.sysid, GLOBAL_POSITION_INT_ID),
            )
        };
        let fix = state.and_then(|v| vehicle_fix(&v, age));
        let gimbal = self.camera().await.state().borrow().gimbal.clone();
        let s = self.roi.status(fix.as_ref(), gimbal.as_ref());
        if self.offline && self.roi.is_active() {
            RoiStatus {
                error: Some(codes::CAMERA_OFFLINE.into()),
                ..s
            }
        } else {
            s
        }
    }

    async fn broadcast(&self) {
        let status = self.status().await;
        self.hub.broadcast(self.sysid, status);
    }

    fn publish(&self) {
        let active = self.roi.status(None, None).active_target;
        self.hub.publish_active(self.sysid, self.gen, active);
    }
}

async fn bounded(
    send: impl std::future::Future<Output = Result<(), CameraError>>,
) -> Result<(), CameraError> {
    timeout(NATIVE_SEND_TIMEOUT, send)
        .await
        .unwrap_or(Err(CameraError::Io("roi send timed out".into())))
}
