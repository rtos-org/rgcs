//! One vehicle inside `GuardHub`: detector + intervention machine + RC watch, and the
//! translation of the pure machine's effects into alerts, records, message rows and the one
//! possible action. Nothing here does I/O; the hub dispatches the returned [`Out`]s.

use rgcs_core::{GuardAlert, GuardLevel, GuardPhase, GuardSigns, Severity, SysId, VehicleKind, VehicleState};
use rgcs_guard::{
    monitored, DecisionRecord, Effect, ExternalContext, Input, Intervention, Phase, Policy, RcWatch, Sample,
    TakeoverWhy, TbState, ToiletBowlConfig, ToiletBowlDetector, Verdict, MAX_RECORD_SAMPLES, OWNER_GCS,
    RECORD_VERSION,
};
use tokio::sync::watch;

use crate::guard_settings::guard_level;

/// Fixed values (Takeover): a stick ≥ 60 µs off its baseline for ≥ 300 ms.
pub const RC_DEVIATION_US: u16 = 60;
pub const RC_HOLD_MS: u64 = 300;
/// LOITER / POSHOLD / QLOITER sticks count as centred within ±40 µs of 1500.
pub const STICK_CENTRE_TOL_US: u16 = 40;
pub const EVENT: &str = "toilet_bowl";
/// `MAV_VTOL_STATE_MC`.
const VTOL_MC: u8 = 3;

/// What one step needs from the hub.
pub struct Ctx<'a> {
    pub policy: &'a Policy,
    pub base: &'a ToiletBowlConfig,
    pub eff: &'a ToiletBowlConfig,
    pub ext: &'a ExternalContext,
    pub now: u64,
}

impl Ctx<'_> {
    fn level(&self) -> GuardLevel {
        guard_level(self.policy.effective_level())
    }

    fn kp_raised(&self) -> bool {
        self.eff != self.base
    }
}

/// Work for the hub: alerts go out at once, the action to its execution task, records and
/// message rows to its writer in this order.
#[derive(Debug)]
pub enum Out {
    Alert(GuardAlert),
    Record {
        sysid: SysId,
        alert_id: String,
        phase: &'static str,
        level: GuardLevel,
        record: Box<DecisionRecord>,
    },
    Message {
        sysid: SysId,
        severity: Severity,
        text: String,
        ts: u64,
    },
    /// The only command the guard can ask for (`ALT_HOLD` / `QHOVER`), re-checked by
    /// `GuardHub::execute` before it reaches the queue.
    Execute {
        sysid: SysId,
        alert_id: String,
        mode: &'static str,
    },
}

/// One `GLOBAL_POSITION_INT` point.
#[derive(Debug, Clone, Copy)]
pub struct Pos {
    pub lat: f64,
    pub lon: f64,
    pub vn: f32,
    pub ve: f32,
    pub hdg: Option<f32>,
}

pub fn airframe(v: &VehicleState) -> rgcs_guard::Airframe {
    match v.kind {
        VehicleKind::Copter => rgcs_guard::Airframe::Copter,
        VehicleKind::Plane if v.vtol => rgcs_guard::Airframe::QuadPlane,
        _ => rgcs_guard::Airframe::Other,
    }
}

pub struct VehicleGuard {
    pub sysid: SysId,
    pub fc: u8,
    state: watch::Receiver<VehicleState>,
    detector: ToiletBowlDetector,
    pub machine: Intervention,
    rc: RcWatch,
    last_verdict: Option<Verdict>,
    /// The latest `Detected` verdict (signs and confidence shown on the alert).
    detected: Option<Verdict>,
    ekf: Option<(f32, u64)>,
    mission_seq: Option<u16>,
    vtol_mc: bool,
    last_mode: Option<String>,
    /// The mode the guard sent this flight (its own mode change is not a takeover).
    commanded: Option<&'static str>,
    pub alert: Option<GuardAlert>,
    countdown_left: Option<u64>,
    /// First seen already armed (e.g. the server restarted mid-flight, so this flight's latches
    /// are unknown): alerts only, at L1 at most, until the vehicle disarms once.
    alert_only: bool,
}

impl VehicleGuard {
    pub fn new(sysid: SysId, fc: u8, state: watch::Receiver<VehicleState>) -> Self {
        let (last_mode, armed) = {
            let v = state.borrow();
            (Some(v.mode.clone()), v.armed)
        };
        Self {
            sysid,
            fc,
            state,
            detector: ToiletBowlDetector::default(),
            machine: Intervention {
                hands_off: armed,
                ..Intervention::default()
            },
            rc: RcWatch::default(),
            last_verdict: None,
            detected: None,
            ekf: None,
            mission_seq: None,
            vtol_mc: false,
            last_mode,
            commanded: None,
            alert: None,
            countdown_left: None,
            alert_only: armed,
        }
    }

    /// The level shown and recorded: capped at L1 while alert-only.
    fn level(&self, cx: &Ctx) -> GuardLevel {
        if self.alert_only {
            cx.level().min(GuardLevel::L1)
        } else {
            cx.level()
        }
    }

    pub fn vehicle(&self) -> VehicleState {
        self.state.borrow().clone()
    }

    pub fn on_ekf(&mut self, compass_var: f32, now: u64) {
        self.ekf = Some((compass_var, now));
    }

    pub fn on_mission_seq(&mut self, seq: u16) {
        self.mission_seq = Some(seq);
    }

    pub fn on_vtol(&mut self, state: u8) {
        self.vtol_mc = state == VTOL_MC;
    }

    pub fn sample_of(&self, v: &VehicleState, now: u64, p: Pos) -> Sample {
        Sample {
            t_ms: now,
            lat: p.lat,
            lon: p.lon,
            vn: p.vn,
            ve: p.ve,
            hdg: p.hdg.or(v.hdg),
            compass_var: self.ekf.map(|e| e.0),
            ekf_t_ms: self.ekf.map(|e| e.1),
            airframe: airframe(v),
            mode: v.mode.clone(),
            armed: v.armed,
            vtol_mc: self.vtol_mc,
            target: v.target.map(|t| (t.lat, t.lon)),
            mission_seq: self.mission_seq,
            wp_dist: v.nav.map(|n| n.wp_dist),
            sticks_centred: self.rc.centred(now, STICK_CENTRE_TOL_US),
        }
    }

    /// Armed and in a monitored mode right now (checked again at execution).
    pub fn monitored_now(&self, v: &VehicleState, now: u64) -> bool {
        let p = Pos {
            lat: v.lat,
            lon: v.lon,
            vn: 0.0,
            ve: 0.0,
            hdg: v.hdg,
        };
        monitored(&self.sample_of(v, now, p))
    }

    pub fn on_position(&mut self, p: Pos, cx: &Ctx) -> (Vec<Out>, Sample) {
        let v = self.vehicle();
        let mut out = self.host_inputs(&v, cx);
        let sample = self.sample_of(&v, cx.now, p);
        let (detector, verdict) = self.detector.push(&sample, cx.eff);
        self.detector = detector;
        if verdict.state == TbState::Detected {
            self.detected = Some(verdict.clone());
        }
        self.last_verdict = Some(verdict.clone());
        out.extend(self.step(
            Input::Verdict {
                v: &verdict,
                now_ms: cx.now,
            },
            cx,
        ));
        out.extend(self.step(Input::Tick { now_ms: cx.now }, cx));
        out.extend(self.refresh(cx));
        (out, sample)
    }

    pub fn on_rc(&mut self, sticks: [u16; 4], cx: &Ctx) -> Vec<Out> {
        self.rc = self.rc.push(cx.now, sticks);
        let watching = !matches!(self.machine.phase, Phase::Idle | Phase::TakenOver);
        if watching && self.rc.moved(cx.now, RC_DEVIATION_US, RC_HOLD_MS) {
            self.step(
                Input::Takeover {
                    why: TakeoverWhy::Rc,
                    now_ms: cx.now,
                },
                cx,
            )
        } else {
            Vec::new()
        }
    }

    pub fn on_tick(&mut self, cx: &Ctx) -> Vec<Out> {
        let v = self.vehicle();
        let mut out = self.host_inputs(&v, cx);
        out.extend(self.step(Input::Tick { now_ms: cx.now }, cx));
        out.extend(self.refresh(cx));
        out
    }

    /// The host side of the stand-down rules: a disarm ends the flight, and a mode change the guard
    /// did not command is a takeover.
    fn host_inputs(&mut self, v: &VehicleState, cx: &Ctx) -> Vec<Out> {
        let mut out = Vec::new();
        if !v.armed && self.machine != Intervention::default() {
            out.extend(self.step(Input::Disarmed, cx));
            self.commanded = None;
        }
        if !v.armed {
            self.alert_only = false;
        }
        let changed = self.last_mode.as_deref().is_some_and(|m| m != v.mode);
        if changed && self.commanded != Some(v.mode.as_str()) {
            out.extend(self.step(
                Input::Takeover {
                    why: TakeoverWhy::ModeChange,
                    now_ms: cx.now,
                },
                cx,
            ));
        }
        self.last_mode = Some(v.mode.clone());
        out
    }

    /// While the feature is off nothing is detected; a disarm still ends the flight quietly.
    pub fn while_off(&mut self) {
        let v = self.vehicle();
        if !v.armed {
            self.machine = Intervention::default();
            self.commanded = None;
            self.alert_only = false;
        }
        self.last_mode = Some(v.mode);
    }

    /// A settings change; turning the guard off cancels / drops the alert.
    pub fn on_policy(&mut self, cx: &Ctx) -> Vec<Out> {
        let mut out = self.step(Input::PolicyChanged(cx.policy), cx);
        if cx.policy.effective_level() == rgcs_guard::Level::L0 {
            out.extend(self.clear(cx));
            self.detector = ToiletBowlDetector::default();
            self.last_verdict = None;
            self.detected = None;
        }
        out
    }

    pub fn step(&mut self, input: Input<'_>, cx: &Ctx) -> Vec<Out> {
        let (next, effects) = self.machine.step(cx.policy, input);
        self.machine = next;
        // The decision record is queued before the action so its id goes into the audit row.
        let (sends, rest): (Vec<Effect>, Vec<Effect>) = effects
            .into_iter()
            .partition(|e| matches!(e, Effect::SendMode(_)));
        let mut out = Vec::new();
        for e in rest.into_iter().chain(sends) {
            out.extend(self.effect(e, cx));
        }
        out
    }

    fn effect(&mut self, e: Effect, cx: &Ctx) -> Vec<Out> {
        match e {
            Effect::Alert { phase, sound } => self.alert_out(to_guard_phase(phase), sound, cx),
            Effect::Record { phase } => self.record_out(phase, cx).into_iter().collect(),
            Effect::SendMode(mode) => self.send_out(mode, cx),
            Effect::Clear => self.clear(cx),
        }
    }

    fn send_out(&mut self, mode: &'static str, cx: &Ctx) -> Vec<Out> {
        let Some(alert_id) = self.alert.as_ref().map(|a| a.id.clone()) else {
            return Vec::new();
        };
        self.commanded = Some(mode);
        let shown = self.alert.as_ref().map(|a| a.phase);
        let mut out = if shown == Some(GuardPhase::Executing) {
            Vec::new()
        } else {
            self.alert_out(GuardPhase::Executing, false, cx)
        };
        out.push(Out::Execute {
            sysid: self.sysid,
            alert_id,
            mode,
        });
        out
    }

    fn alert_out(&mut self, phase: GuardPhase, sound: bool, cx: &Ctx) -> Vec<Out> {
        let fresh = self.alert.is_none();
        if fresh {
            self.rc = self.rc.freeze_baseline(cx.now);
        }
        let id = self
            .alert
            .as_ref()
            .map_or_else(|| format!("g-{}", uuid::Uuid::new_v4()), |a| a.id.clone());
        let alert = self.build_alert(id, phase, sound, cx);
        self.countdown_left = (phase == GuardPhase::Countdown).then(|| self.secs_left(cx.now));
        self.alert = Some(alert.clone());
        let detection = fresh && sound;
        let mut out = vec![Out::Alert(alert.clone())];
        let severity =
            message_severity(phase, detection).or_else(|| mode_changed(&alert).then_some(Severity::Warn));
        if let Some(severity) = severity {
            let text = if detection {
                headline(&alert.vehicle_name)
            } else {
                alert.text.clone()
            };
            out.push(Out::Message {
                sysid: self.sysid,
                severity,
                text,
                ts: cx.now,
            });
        }
        out
    }

    /// The 1 Hz countdown re-send, and a re-send when RC goes stale / comes back.
    fn refresh(&mut self, cx: &Ctx) -> Vec<Out> {
        let Some(shown) = self.alert.clone() else {
            return Vec::new();
        };
        let counting = self.machine.phase == Phase::Countdown && shown.phase == GuardPhase::Countdown;
        let tick = counting && Some(self.secs_left(cx.now)) != self.countdown_left;
        if !tick && shown.rc_stale == self.rc.stale(cx.now) {
            return Vec::new();
        }
        let alert = self.build_alert(shown.id, shown.phase, false, cx);
        if counting {
            self.countdown_left = Some(self.secs_left(cx.now));
        }
        self.alert = Some(alert.clone());
        vec![Out::Alert(alert)]
    }

    fn clear(&mut self, cx: &Ctx) -> Vec<Out> {
        let Some(shown) = self.alert.take() else {
            return Vec::new();
        };
        self.countdown_left = None;
        let alert = GuardAlert {
            phase: GuardPhase::Cleared,
            sound: false,
            text: text(GuardPhase::Cleared, &shown.vehicle_name, "", 0),
            deadline_ms: None,
            ts: cx.now,
            ..shown
        };
        vec![Out::Alert(alert)]
    }

    fn secs_left(&self, now: u64) -> u64 {
        self.machine
            .deadline_ms
            .map_or(0, |d| d.saturating_sub(now).div_ceil(1_000))
    }

    fn build_alert(&self, id: String, phase: GuardPhase, sound: bool, cx: &Ctx) -> GuardAlert {
        let VehicleState {
            name,
            mode: vehicle_mode,
            ..
        } = self.vehicle();
        let taken_over_by = (phase == GuardPhase::TakenOver).then(|| self.machine.by.clone());
        let det = self.detected.as_ref();
        let mode = self.machine.mode.unwrap_or("");
        let timed = matches!(phase, GuardPhase::Countdown | GuardPhase::Executed);
        let planned = matches!(
            phase,
            GuardPhase::Countdown
                | GuardPhase::Due
                | GuardPhase::Executing
                | GuardPhase::Executed
                | GuardPhase::Unanswered
                | GuardPhase::Refused
                | GuardPhase::Cancelled
        );
        GuardAlert {
            id,
            sysid: self.sysid,
            text: match taken_over_by.as_deref() {
                Some(MODE_CHANGE) => mode_changed_text(&vehicle_mode),
                _ => text(phase, &name, mode, self.secs_left(cx.now)),
            },
            vehicle_name: name,
            event: EVENT.into(),
            phase,
            level: self.level(cx),
            confidence: det.map_or(0.0, |d| d.confidence),
            signs: guard_signs(det),
            deadline_ms: self.machine.deadline_ms.filter(|_| timed),
            action_mode: self.machine.mode.filter(|_| planned).map(str::to_string),
            taken_over_by,
            vehicle_mode,
            rc_stale: self.rc.stale(cx.now),
            kp_raised: cx.kp_raised(),
            sound,
            ts: cx.now,
        }
    }

    fn record_out(&self, phase: Phase, cx: &Ctx) -> Option<Out> {
        let alert_id = self.alert.as_ref()?.id.clone();
        let window = self.detector.window();
        let skip = window.len().saturating_sub(MAX_RECORD_SAMPLES);
        let record = DecisionRecord {
            version: RECORD_VERSION,
            config: cx.base.clone(),
            context: *cx.ext,
            samples: window.into_iter().skip(skip).collect(),
            last_detected_ms: self.detector.last_detected_ms(),
            verdict: self.last_verdict.clone().unwrap_or_else(not_monitored),
            phase,
            action: self
                .machine
                .mode
                .filter(|_| self.machine.acted_this_flight)
                .map(str::to_string),
            by: self.machine.by.clone(),
            owner: OWNER_GCS.into(),
            ts_ms: cx.now,
        };
        Some(Out::Record {
            sysid: self.sysid,
            alert_id,
            phase: phase_str(phase),
            level: self.level(cx),
            record: Box::new(record),
        })
    }
}

fn not_monitored() -> Verdict {
    Verdict {
        state: TbState::NotMonitored,
        confidence: 0.0,
        signs: None,
        recommended_mode: None,
    }
}

fn guard_signs(v: Option<&Verdict>) -> GuardSigns {
    let s = v.and_then(|v| v.signs.as_ref());
    GuardSigns {
        a: s.is_some_and(|s| s.a),
        b: s.is_some_and(|s| s.b),
        c: s.is_some_and(|s| s.c),
        turn_deg: s.map_or(0.0, |s| s.turn_deg),
        radius_m: s.map_or(0.0, |s| s.radius_m),
        compass_var: s.and_then(|s| s.compass_var),
    }
}

/// Ruling 7: rows on detection, executed, cancelled, unanswered (and a refused action).
fn message_severity(phase: GuardPhase, detection: bool) -> Option<Severity> {
    match phase {
        _ if detection => Some(Severity::Error),
        GuardPhase::Unanswered | GuardPhase::Refused => Some(Severity::Error),
        GuardPhase::Executed | GuardPhase::Cancelled => Some(Severity::Warn),
        _ => None,
    }
}

/// `GuardAlert::taken_over_by` for a mode change the guard did not make.
const MODE_CHANGE: &str = "mode_change";

/// A mode change the guard did not make (a pilot's mode switch or a vehicle failsafe): the guard
/// stands down, but it is not shown as a confirmed takeover.
fn mode_changed(a: &GuardAlert) -> bool {
    a.phase == GuardPhase::TakenOver && a.taken_over_by.as_deref() == Some(MODE_CHANGE)
}

pub fn mode_changed_text(vehicle_mode: &str) -> String {
    format!("Mode changed to {vehicle_mode}: the AI takes no further action")
}

pub fn headline(name: &str) -> String {
    format!("{name} Unstable circling (toilet bowl). Take over manually")
}

/// Alert text per phase, in English: the message log and the AI tools read it; the UI banner
/// builds its own text from the alert fields in the operator's language.
pub fn text(phase: GuardPhase, name: &str, mode: &str, secs_left: u64) -> String {
    match phase {
        GuardPhase::Alerting | GuardPhase::Executing => headline(name),
        GuardPhase::Countdown => format!("Switching to {mode} in {secs_left} s"),
        GuardPhase::Due => format!("Switching to {mode} if the signs persist"),
        GuardPhase::Executed => {
            format!("Switched to {mode}: the vehicle drifts with the wind. Take over manually")
        }
        GuardPhase::TakenOver => "Taken over".into(),
        GuardPhase::Unanswered => "No takeover confirmed: the AI takes no further action".into(),
        GuardPhase::Cancelled => "Automatic switch cancelled. Take over manually".into(),
        GuardPhase::Refused => format!("Switching to {mode} failed. Take over manually"),
        GuardPhase::Cleared => "The toilet-bowl signs have cleared".into(),
    }
}

fn to_guard_phase(p: Phase) -> GuardPhase {
    match p {
        Phase::Idle => GuardPhase::Cleared,
        Phase::Alerting => GuardPhase::Alerting,
        Phase::Countdown => GuardPhase::Countdown,
        Phase::Due => GuardPhase::Due,
        Phase::Executing => GuardPhase::Executing,
        Phase::Executed => GuardPhase::Executed,
        Phase::Cancelled => GuardPhase::Cancelled,
        Phase::TakenOver => GuardPhase::TakenOver,
        Phase::Unanswered => GuardPhase::Unanswered,
        Phase::Refused => GuardPhase::Refused,
    }
}

/// `guard_decisions.phase`.
pub fn phase_str(p: Phase) -> &'static str {
    match p {
        Phase::Idle => "idle",
        Phase::Alerting => "alerting",
        Phase::Countdown => "countdown",
        Phase::Due => "due",
        Phase::Executing => "executing",
        Phase::Executed => "executed",
        Phase::Cancelled => "cancelled",
        Phase::TakenOver => "taken_over",
        Phase::Unanswered => "unanswered",
        Phase::Refused => "refused",
    }
}

pub fn level_str(l: GuardLevel) -> &'static str {
    match l {
        GuardLevel::L0 => "l0",
        GuardLevel::L1 => "l1",
        GuardLevel::L2 => "l2",
        GuardLevel::L3 => "l3",
    }
}
