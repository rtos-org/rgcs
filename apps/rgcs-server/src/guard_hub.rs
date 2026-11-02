//! AI 緊急介入 hub: one toilet-bowl detector and one
//! intervention machine per vehicle, fed from the lossy guard tap (`LinkChannels.guard`) and the
//! router's `watch` state. It raises `guard_alert` frames, message rows and decision records, and
//! — only at L2 / L3 with consent 3 — sends `SetMode {ALT_HOLD | QHOVER}`, at most once per
//! arm → disarm, never after a takeover. [`GuardHub::execute`] is the only place a guard
//! command is enqueued.
//!
//! Dev aid: `RGCS_GUARD_DUMP=<path>` appends every detector `Sample` as one JSON line (for
//! replay fixtures). Off unless the variable is set.

use std::collections::HashMap;
use std::io::Write as _;
use std::sync::{Arc, Mutex as StdMutex, MutexGuard, OnceLock};
use std::time::Duration;

use rgcs_core::{GuardAlert, GuardSettings, ServerMessage, SysId, VehicleCommand, VehicleState};
use rgcs_guard::{
    effective, recommended_mode, ExternalContext, Input, Level, Phase, Policy, Sample, TakeoverWhy,
    ToiletBowlConfig,
};
use rgcs_mavlink::{GuardBody, GuardFrame, Outcome};
use tokio::sync::{broadcast, mpsc, oneshot, Mutex};

use crate::app::AppState;
use crate::guard_settings::{config, policy};
use crate::guard_vehicle::{airframe, Ctx, Out, Pos, VehicleGuard};
pub use crate::guard_worker::{audit, AUDIT_TARGET, KEEP_DECISIONS};
use crate::guard_worker::{ActionAudit, GuardIo, Job};

/// Deadline / takeover-wait resolution and the 1 Hz countdown re-send.
const TICK: Duration = Duration::from_millis(250);
/// The only modes the guard may ever send.
pub const ALLOWED_MODES: [&str; 2] = ["ALT_HOLD", "QHOVER"];
const RCMAP: [&str; 4] = ["RCMAP_ROLL", "RCMAP_PITCH", "RCMAP_THROTTLE", "RCMAP_YAW"];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CancelError {
    NotFound,
    NotCancellable,
}

type ClockFn = Arc<dyn Fn() -> u64 + Send + Sync>;

/// Work for the execution task: the guard's `SetMode`, never queued behind a SQLite write.
enum Exec {
    Run {
        sysid: SysId,
        alert_id: String,
        mode: &'static str,
    },
    Flush(oneshot::Sender<()>),
}

type Slot<T> = Arc<StdMutex<Option<mpsc::UnboundedReceiver<T>>>>;

fn slot<T>(rx: mpsc::UnboundedReceiver<T>) -> Slot<T> {
    Arc::new(StdMutex::new(Some(rx)))
}

fn take<T>(slot: &Slot<T>) -> Option<mpsc::UnboundedReceiver<T>> {
    slot.lock().unwrap_or_else(|e| e.into_inner()).take()
}

struct HubState {
    settings: GuardSettings,
    policy: Policy,
    base: ToiletBowlConfig,
    eff: ToiletBowlConfig,
    ext: ExternalContext,
    vehicles: HashMap<SysId, VehicleGuard>,
}

impl HubState {
    fn new(settings: GuardSettings) -> Self {
        let base = config(&settings);
        Self {
            policy: policy(&settings),
            eff: base.clone(),
            base,
            settings,
            ext: ExternalContext::default(),
            vehicles: HashMap::new(),
        }
    }

    /// Runs `f` on every vehicle (or one) with the step context.
    fn each<F>(&mut self, only: Option<SysId>, now: u64, mut f: F) -> Vec<Out>
    where
        F: FnMut(&mut VehicleGuard, &Ctx) -> Vec<Out>,
    {
        let HubState {
            policy,
            base,
            eff,
            ext,
            vehicles,
            ..
        } = self;
        let cx = Ctx {
            policy,
            base,
            eff,
            ext,
            now,
        };
        vehicles
            .iter_mut()
            .filter(|(id, _)| only.is_none_or(|o| o == **id))
            .flat_map(|(_, vg)| f(vg, &cx))
            .collect()
    }
}

#[derive(Clone)]
pub struct GuardHub {
    inner: Arc<StdMutex<HubState>>,
    tx: broadcast::Sender<ServerMessage>,
    jobs: mpsc::UnboundedSender<Job>,
    jobs_rx: Slot<Job>,
    exec: mpsc::UnboundedSender<Exec>,
    exec_rx: Slot<Exec>,
    io: Arc<OnceLock<GuardIo>>,
    clock: ClockFn,
    settings_lock: Arc<Mutex<()>>,
    dump: Arc<OnceLock<StdMutex<std::fs::File>>>,
}

impl GuardHub {
    /// Off (default settings) until `apply_settings`; inert until `attach` / `spawn`.
    pub fn new(tx: broadcast::Sender<ServerMessage>) -> Self {
        let (jobs, rx) = mpsc::unbounded_channel();
        let (exec, exec_rx) = mpsc::unbounded_channel();
        Self {
            inner: Arc::new(StdMutex::new(HubState::new(GuardSettings::default()))),
            tx,
            jobs,
            jobs_rx: slot(rx),
            exec,
            exec_rx: slot(exec_rx),
            io: Arc::new(OnceLock::new()),
            clock: Arc::new(crate::app::unix_ms),
            settings_lock: Arc::new(Mutex::new(())),
            dump: Arc::new(OnceLock::new()),
        }
    }

    /// Replaces the wall clock (Unix ms) — tests drive time by hand.
    pub fn with_clock(self, clock: ClockFn) -> Self {
        Self { clock, ..self }
    }

    pub fn now_ms(&self) -> u64 {
        (self.clock)()
    }

    fn lock(&self) -> MutexGuard<'_, HubState> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Starts the writer (records, message rows, audit) and the execution task on `app`'s
    /// store / queue. Idempotent.
    pub fn attach(&self, app: &AppState) {
        let (Some(rx), Some(exec_rx)) = (take(&self.jobs_rx), take(&self.exec_rx)) else {
            return;
        };
        let io = GuardIo {
            store: app.store.clone(),
            messages: app.messages.clone(),
            flights: app.flights.clone(),
            queue: app.queue.clone(),
            router: app.router.clone(),
            params: app.params.clone(),
        };
        let _ = self.io.set(io.clone());
        tokio::spawn(crate::guard_worker::work(self.tx.clone(), io.clone(), rx));
        tokio::spawn(self.clone().exec_loop(io, exec_rx));
    }

    /// `attach`, then the frame consumer and the tick task for the server's lifetime.
    pub fn spawn(&self, app: AppState, mut frames: broadcast::Receiver<GuardFrame>) {
        self.attach(&app);
        self.open_dump();
        let hub = self.clone();
        tokio::spawn(async move {
            loop {
                match frames.recv().await {
                    Ok(f) => hub.on_frame(f).await,
                    Err(broadcast::error::RecvError::Lagged(n)) => {
                        tracing::debug!(dropped = n, "guard tap lagged");
                    }
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
        });
        let hub = self.clone();
        tokio::spawn(async move {
            let mut ticker = tokio::time::interval(TICK);
            ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            loop {
                ticker.tick().await;
                hub.tick();
            }
        });
    }

    fn open_dump(&self) {
        let Ok(path) = std::env::var("RGCS_GUARD_DUMP") else {
            return;
        };
        match std::fs::OpenOptions::new().create(true).append(true).open(&path) {
            Ok(f) => {
                tracing::warn!(path = %path, "RGCS_GUARD_DUMP: writing guard samples");
                let _ = self.dump.set(StdMutex::new(f));
            }
            Err(e) => tracing::warn!(error = %e, "RGCS_GUARD_DUMP could not be opened"),
        }
    }

    fn write_dump(&self, s: &Sample) {
        let (Some(file), Ok(line)) = (self.dump.get(), serde_json::to_string(s)) else {
            return;
        };
        let mut f = file.lock().unwrap_or_else(|e| e.into_inner());
        let _ = writeln!(f, "{line}");
    }

    /// Alerts go out at once, the action to the execution task, records and message rows to
    /// the writer in step order.
    fn dispatch(&self, outs: Vec<Out>) {
        for o in outs {
            match o {
                Out::Alert(alert) => {
                    let _ = self.tx.send(ServerMessage::GuardAlert { alert });
                }
                Out::Execute {
                    sysid,
                    alert_id,
                    mode,
                } => {
                    let _ = self.exec.send(Exec::Run {
                        sysid,
                        alert_id,
                        mode,
                    });
                }
                other => {
                    if let Some(job) = Job::of(other) {
                        let _ = self.jobs.send(job);
                    }
                }
            }
        }
    }

    /// Waits until the execution task, then the writer, have handled everything dispatched so
    /// far (an action's rejected audit row is queued by then).
    pub async fn flush(&self) {
        if self.io.get().is_none() {
            return;
        }
        let (tx, rx) = oneshot::channel();
        if self.exec.send(Exec::Flush(tx)).is_ok() {
            let _ = rx.await;
        }
        let (tx, rx) = oneshot::channel();
        if self.jobs.send(Job::Flush(tx)).is_ok() {
            let _ = rx.await;
        }
    }

    /// One guard-tap frame. Off means off: nothing is detected (a disarm still resets). A
    /// vehicle is adopted on its first frame even while off, so "first seen armed"
    /// means first seen by this server process.
    pub async fn on_frame(&self, f: GuardFrame) {
        let Some(io) = self.io.get() else {
            return;
        };
        let now = self.now_ms();
        if !self.lock().vehicles.contains_key(&f.sysid) && !self.adopt(io, f.sysid).await {
            return;
        }
        if !self.lock().policy.enabled {
            self.each_quiet(Some(f.sysid));
            return;
        }
        let map = matches!(f.body, GuardBody::Rc { .. }).then(|| rc_map(&io.params, f.sysid));
        let mut sample = None;
        {
            let mut st = self.lock();
            let outs = st.each(Some(f.sysid), now, |vg, cx| {
                if f.compid != vg.fc {
                    return Vec::new();
                }
                let (outs, s) = frame_step(vg, &f.body, map, cx);
                sample = s;
                outs
            });
            self.dispatch(outs);
        }
        if let Some(s) = sample {
            self.write_dump(&s);
        }
    }

    fn each_quiet(&self, only: Option<SysId>) {
        let mut st = self.lock();
        st.vehicles
            .iter_mut()
            .filter(|(id, _)| only.is_none_or(|o| o == **id))
            .for_each(|(_, vg)| vg.while_off());
    }

    /// First frame of a vehicle: its state watch and FC component (one router lock).
    async fn adopt(&self, io: &GuardIo, sysid: SysId) -> bool {
        let (rx, fc) = {
            let router = io.router.lock().await;
            (router.subscribe(sysid), router.fc_component(sysid))
        };
        let (Some(rx), Some(fc)) = (rx, fc) else {
            return false;
        };
        self.lock()
            .vehicles
            .entry(sysid)
            .or_insert_with(|| VehicleGuard::new(sysid, fc, rx));
        true
    }

    /// Deadlines, the 1 Hz countdown re-send, disarm and mode-change checks.
    pub fn tick(&self) {
        let now = self.now_ms();
        if !self.lock().policy.enabled {
            self.each_quiet(None);
            return;
        }
        let mut st = self.lock();
        let outs = st.each(None, now, |vg, cx| vg.on_tick(cx));
        self.dispatch(outs);
    }

    pub fn settings(&self) -> GuardSettings {
        self.lock().settings.clone()
    }

    /// Serializes `PUT /api/guard/settings` (read → validate → store → apply).
    pub async fn lock_settings(&self) -> tokio::sync::MutexGuard<'_, ()> {
        self.settings_lock.lock().await
    }

    pub fn apply_settings(&self, s: GuardSettings) {
        let now = self.now_ms();
        let mut st = self.lock();
        st.policy = policy(&s);
        st.base = config(&s);
        st.eff = effective(&st.base, &st.ext);
        st.settings = s;
        let outs = st.each(None, now, |vg, cx| vg.on_policy(cx));
        self.dispatch(outs);
    }

    /// The latest external context (only Kp matters in v1); never triggers on its own.
    pub fn set_context(&self, ctx: ExternalContext) {
        let mut st = self.lock();
        st.eff = effective(&st.base, &ctx);
        st.ext = ctx;
    }

    /// The external context in use (set by `EnvHub`).
    pub fn context(&self) -> ExternalContext {
        self.lock().ext
    }

    /// An accepted operator command / guided target for `sysid` counts as takeover.
    pub fn note_operator_command(&self, sysid: SysId) {
        let now = self.now_ms();
        let mut st = self.lock();
        if !st.policy.enabled {
            return;
        }
        let why = TakeoverWhy::GcsCommand;
        let outs = st.each(Some(sysid), now, |vg, cx| {
            vg.step(Input::Takeover { why, now_ms: now }, cx)
        });
        self.dispatch(outs);
    }

    /// 取り消し: only a running countdown or a due action; the warning stays.
    pub fn cancel(&self, alert_id: &str, by: &str) -> Result<GuardAlert, CancelError> {
        let now = self.now_ms();
        let mut st = self.lock();
        let sysid = st
            .vehicles
            .values()
            .find(|vg| vg.alert.as_ref().is_some_and(|a| a.id == alert_id))
            .map(|vg| (vg.sysid, vg.machine.phase));
        let sysid = match sysid {
            None => return Err(CancelError::NotFound),
            Some((_, phase)) if !matches!(phase, Phase::Countdown | Phase::Due) => {
                return Err(CancelError::NotCancellable)
            }
            Some((sysid, _)) => sysid,
        };
        let input = || Input::Cancel {
            by: by.to_string(),
            now_ms: now,
        };
        let outs = st.each(Some(sysid), now, |vg, cx| vg.step(input(), cx));
        self.dispatch(outs);
        st.vehicles
            .get(&sysid)
            .and_then(|vg| vg.alert.clone())
            .ok_or(CancelError::NotFound)
    }

    pub fn active_alerts(&self) -> Vec<GuardAlert> {
        let st = self.lock();
        let mut out: Vec<GuardAlert> = st.vehicles.values().filter_map(|vg| vg.alert.clone()).collect();
        out.sort_by_key(|a| a.sysid);
        out
    }

    fn action_result(&self, sysid: SysId, alert_id: &str, ok: bool) {
        let now = self.now_ms();
        let mut st = self.lock();
        let outs = st.each(Some(sysid), now, |vg, cx| {
            if vg.alert.as_ref().is_some_and(|a| a.id == alert_id) {
                vg.step(Input::ActionResult { ok, now_ms: now }, cx)
            } else {
                Vec::new()
            }
        });
        self.dispatch(outs);
    }

    async fn exec_loop(self, io: GuardIo, mut rx: mpsc::UnboundedReceiver<Exec>) {
        while let Some(job) = rx.recv().await {
            match job {
                Exec::Run {
                    sysid,
                    alert_id,
                    mode,
                } => self.execute(&io, sysid, alert_id, mode).await,
                Exec::Flush(done) => {
                    let _ = done.send(());
                }
            }
        }
    }

    /// The audit row goes to the writer, behind the action's `Executing` record (its id).
    fn audit_action(
        &self,
        sysid: SysId,
        alert_id: &str,
        mode: &'static str,
        result: &'static str,
        reason: Option<String>,
    ) {
        let a = ActionAudit {
            sysid,
            alert_id: alert_id.to_string(),
            mode,
            result,
            reason,
        };
        let _ = self.jobs.send(Job::Audit(a));
    }

    /// The single guard enqueue site. Re-reads the vehicle, re-checks the stand-down rules under the hub
    /// lock (so a takeover / cancel / disable that won the race stops it) and hands
    /// `SetMode {ALT_HOLD | QHOVER}` to the queue; the outcome becomes `Executed` / `Refused`.
    async fn execute(&self, io: &GuardIo, sysid: SysId, alert_id: String, mode: &'static str) {
        let v = io.router.lock().await.state(sysid).cloned();
        let sent = {
            let st = self.lock();
            match refusal(&st, sysid, &alert_id, mode, v.as_ref(), self.now_ms()) {
                Some(reason) => Err(reason),
                None => enqueue(io, v.as_ref(), mode),
            }
        };
        match sent {
            Ok(done) => {
                tokio::spawn(self.clone().await_outcome(sysid, alert_id, mode, done));
            }
            Err(reason) => {
                self.audit_action(sysid, &alert_id, mode, "rejected", Some(reason));
                self.action_result(sysid, &alert_id, false);
            }
        }
    }

    async fn await_outcome(
        self,
        sysid: SysId,
        alert_id: String,
        mode: &'static str,
        done: oneshot::Receiver<Outcome>,
    ) {
        let outcome = done.await.unwrap_or(Outcome::LinkClosed);
        let result = match &outcome {
            Outcome::Accepted => "ok",
            Outcome::Timeout => "timeout",
            _ => "failed",
        };
        self.audit_action(sysid, &alert_id, mode, result, outcome.reason());
        self.action_result(sysid, &alert_id, outcome.ok());
    }
}

/// Hands the job to the queue without waiting (a full queue refuses rather than blocks).
fn enqueue(
    io: &GuardIo,
    v: Option<&VehicleState>,
    mode: &'static str,
) -> Result<oneshot::Receiver<Outcome>, String> {
    let v = v.ok_or_else(|| "not_connected".to_string())?;
    let (done_tx, done_rx) = oneshot::channel();
    let cmd = VehicleCommand::SetMode {
        mode: mode.to_string(),
    };
    io.queue
        .try_send(crate::commands::queued(v, cmd, done_tx))
        .map(|_| done_rx)
        .map_err(|_| "queue_unavailable".to_string())
}

/// Why the guard must not send now, or `None`.
fn refusal(
    st: &HubState,
    sysid: SysId,
    alert_id: &str,
    mode: &str,
    v: Option<&VehicleState>,
    now: u64,
) -> Option<String> {
    if !ALLOWED_MODES.contains(&mode) {
        return Some("mode_not_allowed".into());
    }
    let Some(vg) = st.vehicles.get(&sysid) else {
        return Some("unknown_vehicle".into());
    };
    let same = vg.alert.as_ref().is_some_and(|a| a.id == alert_id);
    if !same || vg.machine.phase != Phase::Executing {
        return Some("superseded".into());
    }
    if st.policy.effective_level() < Level::L2 {
        return Some("level".into());
    }
    let Some(v) = v else {
        return Some("not_connected".into());
    };
    if recommended_mode(airframe(v)) != Some(mode) {
        return Some("airframe".into());
    }
    if !v.armed || !vg.monitored_now(v, now) {
        return Some("not_monitored".into());
    }
    let cmd = VehicleCommand::SetMode {
        mode: mode.to_string(),
    };
    crate::commands::precheck(&cmd, v).map(|(_, code, _)| code.to_string())
}

/// One frame for one vehicle.
fn frame_step(
    vg: &mut VehicleGuard,
    body: &GuardBody,
    map: Option<[usize; 4]>,
    cx: &Ctx,
) -> (Vec<Out>, Option<Sample>) {
    match body {
        GuardBody::Position {
            lat,
            lon,
            vn,
            ve,
            hdg,
        } => {
            let p = Pos {
                lat: *lat,
                lon: *lon,
                vn: *vn,
                ve: *ve,
                hdg: *hdg,
            };
            let (outs, s) = vg.on_position(p, cx);
            (outs, Some(s))
        }
        GuardBody::Ekf { compass_var, .. } => {
            vg.on_ekf(*compass_var, cx.now);
            (Vec::new(), None)
        }
        GuardBody::Rc { chans, .. } => {
            let sticks = map.and_then(|m| sticks(chans, m));
            (sticks.map(|s| vg.on_rc(s, cx)).unwrap_or_default(), None)
        }
        GuardBody::MissionSeq(seq) => {
            vg.on_mission_seq(*seq);
            (Vec::new(), None)
        }
        GuardBody::VtolState(s) => {
            vg.on_vtol(*s);
            (Vec::new(), None)
        }
        GuardBody::Wind { .. } => (Vec::new(), None),
    }
}

/// `[roll, pitch, throttle, yaw]` channel indexes: `RCMAP_*` when cached, else ch 1–4.
fn rc_map(params: &crate::params::ParamCache, sysid: SysId) -> [usize; 4] {
    std::array::from_fn(|i| {
        params
            .get(sysid, RCMAP[i])
            .filter(|v| (1.0..=18.0).contains(v))
            .map_or(i, |v| v as usize - 1)
    })
}

fn sticks(chans: &[u16], map: [usize; 4]) -> Option<[u16; 4]> {
    let picked: Vec<u16> = map.iter().filter_map(|&i| chans.get(i).copied()).collect();
    <[u16; 4]>::try_from(picked)
        .ok()
        .filter(|s| s.iter().all(|&v| v != 0 && v != u16::MAX))
}

#[cfg(test)]
#[path = "guard_hub_tests.rs"]
mod tests;
