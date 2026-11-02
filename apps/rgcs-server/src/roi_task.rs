//! The per-vehicle ROI task: owns the `RoiController`, feeds it router / camera samples each
//! control period and sends its commands.

use std::sync::Arc;
use std::time::Duration;

use rgcs_camera::roi::controller::{codes, RoiController, RoiInputs, StepOut};
use rgcs_camera::roi::inputs::{attitude_sample, attitude_stamp, vehicle_fix};
use rgcs_camera::Camera;
use rgcs_core::{CameraCommand, CameraState, RoiControl, RoiStatus, SysId};
use rgcs_mavlink::GLOBAL_POSITION_INT_ID;
use tokio::sync::{mpsc, watch};
use tokio::time::{interval, timeout, Interval, MissedTickBehavior};

use crate::roi::{Cmd, RoiHub, StopReason, SEND_TIMEOUT, STATUS_EVERY};

struct Runner {
    hub: RoiHub,
    sysid: SysId,
    gen: u64,
    ctl: RoiController,
    camera: Option<Arc<dyn Camera>>,
    watch: Option<watch::Receiver<CameraState>>,
    /// Monotonic ms the current gimbal attitude was measured.
    stamp: Option<u64>,
    offline: bool,
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
        ctl: RoiController::new(RoiControl::default()),
        camera: None,
        watch: None,
        stamp: None,
        offline: false,
    };
    let mut period = r.ctl.period_ms();
    let mut tick = every(Duration::from_millis(period));
    let mut status = every(STATUS_EVERY);
    loop {
        let was_active = r.ctl.is_active();
        tokio::select! {
            cmd = cmds.recv() => match cmd {
                Some(cmd) => r.on_cmd(cmd).await,
                None => return,
            },
            _ = tick.tick() => r.on_tick().await,
            _ = status.tick() => if r.ctl.is_active() { r.broadcast() },
        }
        if r.after(was_active) {
            status.reset();
        }
        if r.ctl.period_ms() != period {
            period = r.ctl.period_ms();
            tick = every(Duration::from_millis(period));
        }
        if r.ctl.is_idle() && r.hub.try_retire(sysid, gen, &cmds) {
            return;
        }
    }
}

impl Runner {
    async fn on_cmd(&mut self, cmd: Cmd) {
        match cmd {
            Cmd::Start { target, control, ack } => {
                let (next, out) = self.ctl.configure(control);
                self.apply(next, out).await;
                if let Ok((next, out)) = self.ctl.start(target) {
                    self.offline = false;
                    self.apply(next, out).await;
                    self.on_tick().await;
                }
                self.publish();
                let _ = ack.send(());
            }
            Cmd::Stop(reason, reply) => {
                let was = self.ctl.is_active();
                let (next, out) = self.ctl.stop(reason);
                self.apply(next, out).await;
                self.publish();
                let _ = reply.send(was);
            }
            Cmd::Configure(control, ack) => {
                let (next, out) = self.ctl.configure(control);
                self.apply(next, out).await;
                let _ = ack.send(());
            }
            Cmd::Targets(targets, ack) => {
                let (next, out) = self.ctl.retarget(&targets);
                self.apply(next, out).await;
                self.publish();
                let _ = ack.send(());
            }
        }
    }

    /// One control period: refresh the camera, then step unless it is offline.
    async fn on_tick(&mut self) {
        let now = self.hub.now_ms();
        self.refresh_camera(now).await;
        self.offline = !self.watch.as_ref().is_some_and(|w| w.borrow().connected);
        if self.offline {
            if !self.ctl.is_active() {
                // Nothing to resend to: drop pending zeros so the task can retire. The camera
                // manager zeros the gimbal when the link comes back (cameras::link_zero).
                self.ctl = self.ctl.stop(StopReason::Manual).0;
            }
            return;
        }
        let inputs = self.inputs(now).await;
        let (next, out) = self.ctl.step(&inputs);
        self.apply(next, out).await;
    }

    /// Follows driver reloads and stamps the attitude on every camera-watch change.
    async fn refresh_camera(&mut self, now: u64) {
        let camera = self.hub.cameras.ensure(self.sysid).await;
        let same = self.camera.as_ref().is_some_and(|c| Arc::ptr_eq(c, &camera));
        if !same {
            let mut w = camera.state();
            w.borrow_and_update();
            self.watch = Some(w);
            self.camera = Some(camera);
            self.stamp = None;
            return;
        }
        if let Some(w) = self.watch.as_mut() {
            if w.has_changed().unwrap_or(false) {
                self.stamp = attitude_stamp(&w.borrow_and_update(), now);
            }
        }
    }

    async fn inputs(&self, now_ms: u64) -> RoiInputs {
        let (state, age) = {
            let router = self.hub.router.lock().await;
            (
                router.state(self.sysid).cloned(),
                router.message_age_ms(self.sysid, GLOBAL_POSITION_INT_ID),
            )
        };
        let attitude = self
            .watch
            .as_ref()
            .and_then(|w| attitude_sample(&w.borrow(), self.stamp, now_ms));
        RoiInputs {
            now_ms,
            vehicle: state.and_then(|v| vehicle_fix(&v, age)),
            attitude,
        }
    }

    /// Adopts `next` and sends `out`; the first failed command halts the controller and
    /// skips the rest of the batch.
    async fn apply(&mut self, next: RoiController, out: StepOut) {
        self.ctl = next;
        for cmd in out.commands {
            if !self.send(cmd.clone()).await {
                let (halted, zero) = self.ctl.send_failed(&cmd);
                self.ctl = halted;
                for z in zero.commands {
                    self.send(z).await;
                }
                return;
            }
        }
        if out.request_attitude {
            if let Some(cam) = &self.camera {
                let _ = timeout(SEND_TIMEOUT, cam.request_attitude()).await;
            }
        }
    }

    async fn send(&self, cmd: CameraCommand) -> bool {
        match timeout(SEND_TIMEOUT, self.hub.cameras.send(self.sysid, cmd)).await {
            Ok(Ok(())) => true,
            Ok(Err(e)) => {
                tracing::debug!(sysid = self.sysid, error = %e, "roi camera send failed");
                false
            }
            Err(_) => {
                tracing::debug!(sysid = self.sysid, "roi camera send timed out");
                false
            }
        }
    }

    fn status(&self) -> RoiStatus {
        let s = self.ctl.status();
        if self.offline && self.ctl.is_active() {
            RoiStatus {
                error: Some(codes::CAMERA_OFFLINE.into()),
                ..s
            }
        } else {
            s
        }
    }

    fn broadcast(&self) {
        self.hub.broadcast(self.sysid, self.status());
    }

    fn publish(&self) {
        let active = self.ctl.status().active_target;
        self.hub.publish_active(self.sysid, self.gen, active);
    }

    /// Broadcasts on activation changes (one final frame on stop); `true` when ROI became active.
    fn after(&self, was_active: bool) -> bool {
        let active = self.ctl.is_active();
        if active != was_active {
            self.publish();
            self.broadcast();
        }
        active && !was_active
    }
}
