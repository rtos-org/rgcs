//! ROI controller state machine: pure, no I/O.
//!
//! `(state, inputs, now) → (state, camera commands, status)`. The server task
//! (`RoiHub`) owns one controller per vehicle, feeds it vehicle / gimbal samples
//! every control period and sends the returned commands. Port of the Python
//! `roi_controller.py`; the single-writer task replaces its lock + generation.

use rgcs_core::{CameraCommand, GimbalMode, RoiControl, RoiControlMode, RoiStatus, RoiTarget};

use super::pid::PidState;

pub const MIN_DISTANCE_M: f64 = 3.0;
pub const MAX_POSITION_AGE_MS: u64 = 2_000;
pub const ATTITUDE_MAX_AGE_MS: u64 = 500;
pub const FOLLOW_INTERVAL_MS: u64 = 5_000;
pub const ZERO_RESENDS: u8 = 2;
pub const DT_MAX_PERIODS: f64 = 2.0;
pub const YAW_HYSTERESIS_LIMIT_DEG: f64 = 190.0;

/// Fixed `RoiStatus.error` codes, translated by the UI.
pub mod codes {
    pub const NO_POSITION: &str = "no_position";
    pub const POSITION_STALE: &str = "position_stale";
    pub const HEADING_UNKNOWN: &str = "heading_unknown";
    pub const TARGET_TOO_CLOSE: &str = "target_too_close";
    pub const NO_ATTITUDE: &str = "no_attitude";
    pub const INVALID_ANGLES: &str = "invalid_angles";
    pub const FOLLOW_FAILED: &str = "follow_failed";
    pub const SEND_FAILED: &str = "send_failed";
    pub const CAMERA_OFFLINE: &str = "camera_offline";
    pub const WAITING: &str = "waiting";
}

/// Vehicle position + heading; `age_ms` = time since the last GLOBAL_POSITION_INT.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct VehicleFix {
    pub lat: f64,
    pub lon: f64,
    pub alt_msl: f64,
    pub hdg: Option<f64>,
    pub age_ms: u64,
}

/// Measured gimbal attitude (0x0D, RFU: +yaw = left), `age_ms` since it arrived.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct AttitudeSample {
    pub yaw: f64,
    pub pitch: f64,
    pub age_ms: u64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct RoiInputs {
    pub now_ms: u64,
    pub vehicle: Option<VehicleFix>,
    pub attitude: Option<AttitudeSample>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StopReason {
    Operator,
    Manual,
    TargetRemoved,
    Shutdown,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RoiStartError {
    Unset,
}

/// Commands to send, in order, plus whether to request a 0x0D attitude afterwards.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct StepOut {
    pub commands: Vec<CameraCommand>,
    pub request_attitude: bool,
}

impl StepOut {
    pub(super) fn of(commands: Vec<CameraCommand>) -> Self {
        Self {
            commands,
            request_attitude: false,
        }
    }
}

/// Per-activation control state; replaced, never mutated.
#[derive(Debug, Clone, PartialEq, Default)]
pub(super) struct LoopState {
    /// Smoothed goal (yaw, pitch) in gimbal degrees.
    pub goal: Option<(f64, f64)>,
    pub goal_error: Option<&'static str>,
    pub target_at: Option<u64>,
    pub control_at: Option<u64>,
    pub pid_yaw: PidState,
    pub pid_pitch: PidState,
    pub hold_yaw: bool,
    pub hold_pitch: bool,
    pub yaw_error: Option<f64>,
    pub last_sent_angle: Option<(f64, f64)>,
}

#[derive(Debug, Clone, PartialEq)]
pub(super) struct Active {
    pub target: RoiTarget,
    pub lp: LoopState,
}

pub(super) const STILL: (i8, i8) = (0, 0);

pub(super) fn rate_cmd((yaw, pitch): (i8, i8)) -> CameraCommand {
    CameraCommand::GimbalRate { yaw, pitch }
}

pub(super) fn follow_cmd() -> CameraCommand {
    CameraCommand::GimbalMode {
        mode: GimbalMode::Follow,
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct RoiController {
    pub(super) settings: RoiControl,
    pub(super) active: Option<Active>,
    /// Last 0x07 speed sent (the gimbal keeps turning at it).
    pub(super) last_speed: (i8, i8),
    pub(super) zero_resends: u8,
    pub(super) last_follow_ms: Option<u64>,
    pub(super) status: RoiStatus,
}

impl RoiController {
    pub fn new(settings: RoiControl) -> Self {
        Self {
            settings,
            active: None,
            last_speed: STILL,
            zero_resends: 0,
            last_follow_ms: None,
            status: RoiStatus::default(),
        }
    }

    /// Activates `target`. The gimbal is always zeroed first (with resends): the operator's
    /// stick may have left it turning, and its release zero is dropped once ROI is active
    ///. Follow mode goes out on the first step.
    pub fn start(&self, target: RoiTarget) -> Result<(Self, StepOut), RoiStartError> {
        if !target.is_set() {
            return Err(RoiStartError::Unset);
        }
        let (halted, commands) = self.halt(true);
        let status = RoiStatus {
            active_target: Some(target.id.clone()),
            mode: Some(self.settings.control_mode),
            ..RoiStatus::default()
        };
        let next = Self {
            active: Some(Active {
                target,
                lp: LoopState::default(),
            }),
            last_follow_ms: None,
            status,
            ..halted
        };
        Ok((next, StepOut::of(commands)))
    }

    /// Ruling 8: an active stop always sends speed 0 (plus 2 resends unless `Manual`).
    /// Stopping an inactive controller sends nothing; `Manual` drops pending resends.
    pub fn stop(&self, reason: StopReason) -> (Self, StepOut) {
        let manual = reason == StopReason::Manual;
        if self.active.is_none() {
            let zero_resends = if manual { 0 } else { self.zero_resends };
            return (
                Self {
                    zero_resends,
                    ..self.clone()
                },
                StepOut::default(),
            );
        }
        let next = Self {
            active: None,
            last_speed: STILL,
            zero_resends: if manual { 0 } else { ZERO_RESENDS },
            last_follow_ms: None,
            status: RoiStatus::default(),
            ..self.clone()
        };
        (next, StepOut::of(vec![rate_cmd(STILL)]))
    }

    /// New settings: leaving rate mode halts; PID / deadband / angle memory reset.
    pub fn configure(&self, settings: RoiControl) -> (Self, StepOut) {
        let leaving_rate = self.settings.control_mode == RoiControlMode::Rate
            && settings.control_mode != RoiControlMode::Rate;
        let (base, commands) = if leaving_rate {
            self.halt(false)
        } else {
            (self.clone(), Vec::new())
        };
        let active = base.active.as_ref().map(|a| Active {
            lp: LoopState {
                control_at: None,
                pid_yaw: PidState::default(),
                pid_pitch: PidState::default(),
                hold_yaw: false,
                hold_pitch: false,
                last_sent_angle: None,
                ..a.lp.clone()
            },
            ..a.clone()
        });
        let status = match active {
            Some(_) => RoiStatus {
                mode: Some(settings.control_mode),
                ..base.status.clone()
            },
            None => base.status.clone(),
        };
        let next = Self {
            settings,
            active,
            status,
            ..base
        };
        (next, StepOut::of(commands))
    }

    /// Ruling 11: the active slot unset / removed stops; new coordinates keep running.
    pub fn retarget(&self, targets: &[RoiTarget]) -> (Self, StepOut) {
        let Some(a) = &self.active else {
            return (self.clone(), StepOut::default());
        };
        match targets.iter().find(|t| t.id == a.target.id) {
            Some(t) if t.is_set() => {
                let active = Active {
                    target: t.clone(),
                    ..a.clone()
                };
                let next = Self {
                    active: Some(active),
                    ..self.clone()
                };
                (next, StepOut::default())
            }
            _ => self.stop(StopReason::TargetRemoved),
        }
    }

    /// A command from the last output failed (or timed out): force a halt and report.
    /// A failed Follow is retried on the next step; a failed angle is re-sent.
    pub fn send_failed(&self, failed: &CameraCommand) -> (Self, StepOut) {
        if self.active.is_none() {
            return (self.clone(), StepOut::default());
        }
        let follow = matches!(failed, CameraCommand::GimbalMode { .. });
        let (halted, commands) = self.halt(true);
        let active = halted.active.as_ref().map(|a| Active {
            lp: LoopState {
                last_sent_angle: None,
                ..a.lp.clone()
            },
            ..a.clone()
        });
        let code = if follow {
            codes::FOLLOW_FAILED
        } else {
            codes::SEND_FAILED
        };
        let next = Self {
            active,
            last_follow_ms: if follow { None } else { halted.last_follow_ms },
            status: RoiStatus {
                error: Some(code.into()),
                ..halted.status.clone()
            },
            ..halted
        };
        (next, StepOut::of(commands))
    }

    pub fn status(&self) -> RoiStatus {
        self.status.clone()
    }

    pub fn is_active(&self) -> bool {
        self.active.is_some()
    }

    /// Inactive and no zero resends pending: the task may go quiet.
    pub fn is_idle(&self) -> bool {
        self.active.is_none() && self.zero_resends == 0
    }

    /// Control period: round(1000 / rate_hz) ms, at least 20 ms.
    pub fn period_ms(&self) -> u64 {
        let hz = self.settings.rate_hz;
        if !(hz > 0.0 && hz.is_finite()) {
            return 100;
        }
        ((1000.0 / hz).round() as u64).max(20)
    }

    /// Stops a moving gimbal: speed 0 now plus `ZERO_RESENDS` on later steps
    /// (only when moving, unless `force`). Resets the rate loop; shows speed 0.
    pub(super) fn halt(&self, force: bool) -> (Self, Vec<CameraCommand>) {
        let status = match self.active {
            Some(_) => RoiStatus {
                speed_yaw: Some(0),
                speed_pitch: Some(0),
                ..self.status.clone()
            },
            None => self.status.clone(),
        };
        if self.last_speed == STILL && !force {
            return (
                Self {
                    status,
                    ..self.clone()
                },
                Vec::new(),
            );
        }
        let active = self.active.as_ref().map(|a| Active {
            lp: LoopState {
                control_at: None,
                pid_yaw: PidState::default(),
                pid_pitch: PidState::default(),
                hold_yaw: false,
                hold_pitch: false,
                ..a.lp.clone()
            },
            ..a.clone()
        });
        let next = Self {
            active,
            status,
            last_speed: STILL,
            zero_resends: ZERO_RESENDS,
            ..self.clone()
        };
        (next, vec![rate_cmd(STILL)])
    }
}

/// Near ±180°, keeps yaw on the previous side (up to ±190°) so heading jitter
/// does not swing the command a full turn.
pub fn stabilize_yaw(new_deg: f64, prev_deg: Option<f64>) -> f64 {
    let Some(prev) = prev_deg else {
        return new_deg;
    };
    if (new_deg - prev).abs() <= 180.0 {
        return new_deg;
    }
    let candidate = new_deg + if prev > 0.0 { 360.0 } else { -360.0 };
    if candidate.abs() <= YAW_HYSTERESIS_LIMIT_DEG {
        candidate
    } else {
        new_deg
    }
}

#[cfg(test)]
#[path = "controller_tests.rs"]
mod tests;
