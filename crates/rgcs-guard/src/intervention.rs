//! Per-vehicle intervention state machine.
//!
//! Pure: every input carries its own time, and [`Intervention::step`] returns the next state
//! plus the effects the host must carry out (alert, send a mode, write a record, clear). The
//! only command it can ask for is [`Effect::SendMode`] with the verdict's no-position-hold mode
//! (`ALT_HOLD` / `QHOVER`), at most once per arm → disarm.

use serde::{Deserialize, Serialize};

use crate::toilet_bowl::{TbState, Verdict};

/// The verdict must have been `Detected` this recently when the countdown ends.
pub const RECHECK_MS: u64 = 1_000;
/// `by` for phase changes the guard makes itself.
pub const BY_GUARD: &str = "ai-guard";
/// `by` for a countdown cancelled because the feature was turned off.
pub const BY_DISABLED: &str = "disabled";

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum Level {
    L0,
    L1,
    L2,
    L3,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Policy {
    pub enabled: bool,
    /// Consent 3 (automatic operation risk).
    pub auto_ops: bool,
    pub level: Level,
    pub countdown_ms: u64,
    pub takeover_wait_ms: u64,
}

impl Policy {
    /// `L0` when disabled; `L2` / `L3` are capped at `L1` without consent 3.
    pub fn effective_level(&self) -> Level {
        match (self.enabled, self.auto_ops, self.level) {
            (false, _, _) => Level::L0,
            (true, false, Level::L2 | Level::L3) => Level::L1,
            (true, _, level) => level,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Phase {
    Idle,
    Alerting,
    Countdown,
    /// The L2 countdown ran out without a fresh `Detected`: still cancellable, acts on
    /// the first fresh `Detected` until the detector clears.
    Due,
    Executing,
    Executed,
    Cancelled,
    TakenOver,
    Unanswered,
    Refused,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TakeoverWhy {
    Rc,
    GcsCommand,
    ModeChange,
}

impl TakeoverWhy {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Rc => "rc",
            Self::GcsCommand => "gcs_command",
            Self::ModeChange => "mode_change",
        }
    }
}

pub enum Input<'a> {
    Verdict { v: &'a Verdict, now_ms: u64 },
    Tick { now_ms: u64 },
    Cancel { by: String, now_ms: u64 },
    Takeover { why: TakeoverWhy, now_ms: u64 },
    ActionResult { ok: bool, now_ms: u64 },
    Disarmed,
    PolicyChanged(&'a Policy),
}

#[derive(Debug, Clone, PartialEq)]
pub enum Effect {
    Alert { phase: Phase, sound: bool },
    SendMode(&'static str),
    Record { phase: Phase },
    Clear,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Intervention {
    pub phase: Phase,
    /// End of the countdown (`Countdown`) or of the takeover wait (`Executed`).
    pub deadline_ms: Option<u64>,
    /// A mode was sent this flight (survives alert clear / re-detect; reset on disarm).
    pub acted_this_flight: bool,
    /// After `TakenOver`, `Unanswered`, `Cancelled` or `Refused`: nothing more is sent.
    pub hands_off: bool,
    /// Who made the latest phase change: [`BY_GUARD`], a username, [`BY_DISABLED`] or a
    /// [`TakeoverWhy::as_str`].
    pub by: String,
    /// Time of the latest `Detected` verdict input (the ruling-4 re-check).
    pub last_detected_ms: Option<u64>,
    /// The mode the latest `Detected` verdict recommended.
    pub mode: Option<&'static str>,
}

impl Default for Intervention {
    fn default() -> Self {
        Self {
            phase: Phase::Idle,
            deadline_ms: None,
            acted_this_flight: false,
            hands_off: false,
            by: String::new(),
            last_detected_ms: None,
            mode: None,
        }
    }
}

type Step = (Intervention, Vec<Effect>);

impl Intervention {
    pub fn step(&self, policy: &Policy, input: Input<'_>) -> Step {
        match input {
            Input::Verdict { v, now_ms } => self.on_verdict(policy, v, now_ms),
            Input::Tick { now_ms } => self.on_tick(policy, now_ms),
            Input::Cancel { by, .. } => self.on_cancel(by),
            Input::Takeover { why, .. } => self.on_takeover(why),
            Input::ActionResult { ok, now_ms } => self.on_result(policy, ok, now_ms),
            Input::Disarmed => self.on_disarmed(),
            Input::PolicyChanged(p) => self.on_policy(p),
        }
    }

    fn unchanged(&self) -> Step {
        (self.clone(), Vec::new())
    }

    fn enter(&self, phase: Phase, by: &str, deadline_ms: Option<u64>) -> Self {
        Self {
            phase,
            by: by.to_string(),
            deadline_ms,
            ..self.clone()
        }
    }

    /// Enters a terminal (hands-off) phase with its alert and record.
    fn hands_off_in(&self, phase: Phase, by: &str, sound: bool) -> Step {
        let next = Self {
            hands_off: true,
            ..self.enter(phase, by, None)
        };
        (
            next,
            vec![Effect::Alert { phase, sound }, Effect::Record { phase }],
        )
    }

    fn may_act(&self) -> bool {
        !self.hands_off && !self.acted_this_flight
    }

    fn on_verdict(&self, policy: &Policy, v: &Verdict, now_ms: u64) -> Step {
        match v.state {
            TbState::Clear => self.on_clear(),
            TbState::Detected if policy.effective_level() != Level::L0 => self.on_detected(policy, v, now_ms),
            _ => self.unchanged(),
        }
    }

    fn on_detected(&self, policy: &Policy, v: &Verdict, now_ms: u64) -> Step {
        let seen = Self {
            last_detected_ms: Some(now_ms),
            mode: v.recommended_mode,
            ..self.clone()
        };
        match self.phase {
            Phase::Idle | Phase::Alerting | Phase::Due => seen.start(policy, now_ms),
            _ => (seen, Vec::new()),
        }
    }

    /// A detection from `Idle` (or a fresh one while only alerting or due): count down, act
    /// at once, or just alert, by level and latch. While due (the countdown already ran and
    /// was not cancelled) the fresh `Detected` acts at once.
    fn start(&self, policy: &Policy, now_ms: u64) -> Step {
        let mode = self.mode.filter(|_| self.may_act());
        match (policy.effective_level(), mode) {
            (Level::L2, Some(m)) if self.phase == Phase::Due => self.execute(m, false),
            (Level::L2, Some(_)) => {
                let phase = Phase::Countdown;
                let next = self.enter(phase, BY_GUARD, Some(now_ms + policy.countdown_ms));
                (
                    next,
                    vec![Effect::Alert { phase, sound: true }, Effect::Record { phase }],
                )
            }
            (Level::L3, Some(m)) => self.execute(m, true),
            _ if matches!(self.phase, Phase::Idle | Phase::Due) => {
                let phase = Phase::Alerting;
                let next = self.enter(phase, BY_GUARD, None);
                (
                    next,
                    vec![Effect::Alert { phase, sound: true }, Effect::Record { phase }],
                )
            }
            _ => self.unchanged(),
        }
    }

    fn execute(&self, mode: &'static str, with_alert: bool) -> Step {
        let phase = Phase::Executing;
        let next = Self {
            acted_this_flight: true,
            ..self.enter(phase, BY_GUARD, None)
        };
        let alert = with_alert.then_some(Effect::Alert { phase, sound: true });
        let effects = alert
            .into_iter()
            .chain([Effect::SendMode(mode), Effect::Record { phase }])
            .collect();
        (next, effects)
    }

    fn on_tick(&self, policy: &Policy, now_ms: u64) -> Step {
        let due = self.deadline_ms.is_some_and(|d| now_ms >= d);
        match self.phase {
            Phase::Countdown if due => self.recheck(policy, now_ms),
            Phase::Executed if due => self.hands_off_in(Phase::Unanswered, BY_GUARD, true),
            _ => self.unchanged(),
        }
    }

    /// Ruling 4, re-checked when the countdown ends. Without a fresh `Detected` the machine
    /// becomes due instead of restarting a full countdown on the next detection.
    fn recheck(&self, policy: &Policy, now_ms: u64) -> Step {
        let fresh = self
            .last_detected_ms
            .is_some_and(|t| now_ms.saturating_sub(t) <= RECHECK_MS);
        let allowed = policy.effective_level() >= Level::L2 && self.may_act();
        match (self.mode.filter(|_| allowed), fresh) {
            (Some(m), true) => self.execute(m, false),
            (Some(_), false) => self.settle(Phase::Due),
            (None, _) => self.settle(Phase::Alerting),
        }
    }

    /// A quiet phase change with its alert and record (no tone, no deadline).
    fn settle(&self, phase: Phase) -> Step {
        (
            self.enter(phase, BY_GUARD, None),
            vec![Effect::Alert { phase, sound: false }, Effect::Record { phase }],
        )
    }

    fn on_cancel(&self, by: String) -> Step {
        match self.phase {
            Phase::Countdown | Phase::Due => self.hands_off_in(Phase::Cancelled, &by, false),
            _ => self.unchanged(),
        }
    }

    fn on_takeover(&self, why: TakeoverWhy) -> Step {
        match self.phase {
            Phase::Idle | Phase::TakenOver => self.unchanged(),
            _ => self.hands_off_in(Phase::TakenOver, why.as_str(), false),
        }
    }

    fn on_result(&self, policy: &Policy, ok: bool, now_ms: u64) -> Step {
        match (self.phase, ok) {
            (Phase::Executing, true) => {
                let phase = Phase::Executed;
                let next = self.enter(phase, BY_GUARD, Some(now_ms + policy.takeover_wait_ms));
                (
                    next,
                    vec![Effect::Alert { phase, sound: false }, Effect::Record { phase }],
                )
            }
            (Phase::Executing, false) => self.hands_off_in(Phase::Refused, BY_GUARD, false),
            _ => self.unchanged(),
        }
    }

    /// The detector cleared (15 s without `Detected`): drop a settled alert, keep the latches.
    /// A countdown, an action in flight, `Executed` and `Unanswered` are not dropped here.
    fn on_clear(&self) -> Step {
        match self.phase {
            Phase::Alerting | Phase::Due | Phase::Cancelled | Phase::TakenOver | Phase::Refused => {
                self.to_idle(self.clone())
            }
            _ => self.unchanged(),
        }
    }

    fn to_idle(&self, base: Self) -> Step {
        let next = base.enter(Phase::Idle, BY_GUARD, None);
        let effects = if self.phase == Phase::Idle {
            Vec::new()
        } else {
            vec![Effect::Record { phase: Phase::Idle }, Effect::Clear]
        };
        (next, effects)
    }

    /// Disarm ends the flight: everything resets, latches included.
    fn on_disarmed(&self) -> Step {
        let (_, effects) = self.to_idle(Self::default());
        (Self::default(), effects)
    }

    /// Turning the feature off cancels a countdown (or a due action) and drops any other
    /// alert. A lower level is applied by the countdown re-check, and ends a due
    /// action at once.
    fn on_policy(&self, p: &Policy) -> Step {
        match (p.effective_level(), self.phase) {
            (Level::L0, Phase::Countdown | Phase::Due) => {
                self.hands_off_in(Phase::Cancelled, BY_DISABLED, false)
            }
            (Level::L0, _) => self.to_idle(self.clone()),
            (Level::L1, Phase::Due) => self.settle(Phase::Alerting),
            _ => self.unchanged(),
        }
    }
}
