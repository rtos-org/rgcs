//! `RoiController::step` and its per-cycle helpers (goal, rate, angle, follow).

use rgcs_core::{CameraCommand, RoiControlMode, RoiStatus, RoiTarget};

use super::controller::{
    codes, follow_cmd, rate_cmd, stabilize_yaw, Active, AttitudeSample, LoopState, RoiController, RoiInputs,
    StepOut, ATTITUDE_MAX_AGE_MS, DT_MAX_PERIODS, FOLLOW_INTERVAL_MS, MAX_POSITION_AGE_MS, MIN_DISTANCE_M,
    STILL,
};
use super::geo::{look_angles, to_gimbal_angles, GeoPos, LookAngles};
use super::pid::{deadband_with_hysteresis, pid_step, smooth_angle, stable_yaw_error, PidGains, PidState};

type Cycle = (RoiController, Vec<CameraCommand>, Option<&'static str>);

impl RoiController {
    /// One control period of the GPS ROI loop.
    pub fn step(&self, inp: &RoiInputs) -> (Self, StepOut) {
        if self.active.is_none() {
            let (base, resend) = self.flush_resend();
            return (base, StepOut::of(resend));
        }
        let rate = self.settings.control_mode == RoiControlMode::Rate;
        let (base, first_follow) = self.follow_if(inp.now_ms, self.last_follow_ms.is_none());
        let base = base.goal_update(inp);
        let (next, motion, error, reassert) = match base.goal() {
            Err(code) => {
                let (halted, zero) = base.halt(false);
                (halted, zero, Some(code), false)
            }
            Ok(goal) if rate => {
                let (c, m, e) = base.rate_cycle(goal, inp);
                (c, m, e, true)
            }
            Ok(goal) => {
                let (c, m, e) = base.angle_cycle(goal);
                (c, m, e, true)
            }
        };
        let (next, resend) = next.settle_resends(&motion);
        let due = reassert && next.follow_due(inp.now_ms);
        let (next, follow) = next.follow_if(inp.now_ms, due);
        let next = Self {
            status: RoiStatus {
                error: error.map(str::to_owned),
                ..next.status.clone()
            },
            ..next
        };
        let commands = [resend, first_follow, motion, follow].concat();
        (
            next,
            StepOut {
                commands,
                request_attitude: rate,
            },
        )
    }

    /// Pending zero resends go out only on a cycle without its own motion command; a
    /// motion command other than a zero supersedes them (I4: start zeros with resends).
    fn settle_resends(&self, motion: &[CameraCommand]) -> (Self, Vec<CameraCommand>) {
        if motion.is_empty() {
            return self.flush_resend();
        }
        if motion.iter().all(|c| *c == rate_cmd(STILL)) {
            return (self.clone(), Vec::new());
        }
        let next = Self {
            zero_resends: 0,
            ..self.clone()
        };
        (next, Vec::new())
    }

    fn flush_resend(&self) -> (Self, Vec<CameraCommand>) {
        if self.zero_resends == 0 {
            return (self.clone(), Vec::new());
        }
        let next = Self {
            zero_resends: self.zero_resends - 1,
            ..self.clone()
        };
        (next, vec![rate_cmd(STILL)])
    }

    fn follow_due(&self, now: u64) -> bool {
        self.last_follow_ms
            .is_some_and(|t| now.saturating_sub(t) >= FOLLOW_INTERVAL_MS)
    }

    fn follow_if(&self, now: u64, send: bool) -> (Self, Vec<CameraCommand>) {
        if !send {
            return (self.clone(), Vec::new());
        }
        let next = Self {
            last_follow_ms: Some(now),
            ..self.clone()
        };
        (next, vec![follow_cmd()])
    }

    fn lp(&self) -> &LoopState {
        &self.active.as_ref().expect("active controller").lp
    }

    fn with_lp(&self, lp: LoopState, status: RoiStatus) -> Self {
        let active = self.active.as_ref().map(|a| Active { lp, ..a.clone() });
        Self {
            active,
            status,
            ..self.clone()
        }
    }

    fn goal(&self) -> Result<(f64, f64), &'static str> {
        let lp = self.lp();
        match (lp.goal_error, lp.goal) {
            (Some(code), _) => Err(code),
            (None, None) => Err(codes::WAITING),
            (None, Some(goal)) => Ok(goal),
        }
    }

    /// Target loop (decimated to `target_rate_hz`): fix → raw angles → smoothed goal.
    fn goal_update(&self, inp: &RoiInputs) -> Self {
        let Some(a) = &self.active else {
            return self.clone();
        };
        let (lp, now) = (&a.lp, inp.now_ms);
        let period = 1000.0 / self.settings.target_rate_hz;
        if lp
            .target_at
            .is_some_and(|t| (now.saturating_sub(t) as f64) < period)
        {
            return self.clone();
        }
        match self.raw_goal(&a.target, inp) {
            Err(code) => {
                let lp = LoopState {
                    target_at: Some(now),
                    goal_error: Some(code),
                    ..lp.clone()
                };
                self.with_lp(lp, self.status.clone())
            }
            Ok((raw, look)) => self.smoothed_goal(raw, &look, now),
        }
    }

    fn smoothed_goal(&self, raw: (f64, f64), look: &LookAngles, now: u64) -> Self {
        let lp = self.lp();
        let dt = lp
            .target_at
            .map_or(0.0, |t| now.saturating_sub(t) as f64 / 1000.0);
        let prev = lp.goal.filter(|_| lp.goal_error.is_none());
        let tau = self.settings.smoothing_tau_s;
        let yaw = smooth_angle(prev.map(|p| p.0), raw.0, dt, tau, true);
        let pitch = smooth_angle(prev.map(|p| p.1), raw.1, dt, tau, false);
        let next_lp = LoopState {
            goal: Some((yaw, pitch)),
            goal_error: None,
            target_at: Some(now),
            ..lp.clone()
        };
        let status = RoiStatus {
            bearing_deg: Some(look.bearing_deg),
            elevation_deg: Some(look.elevation_deg),
            distance_m: Some(look.distance_m),
            yaw_cmd_deg: Some(yaw),
            pitch_cmd_deg: Some(pitch),
            ..self.status.clone()
        };
        self.with_lp(next_lp, status)
    }

    fn raw_goal(
        &self,
        target: &RoiTarget,
        inp: &RoiInputs,
    ) -> Result<((f64, f64), LookAngles), &'static str> {
        let fix = inp.vehicle.ok_or(codes::NO_POSITION)?;
        if fix.age_ms > MAX_POSITION_AGE_MS {
            return Err(codes::POSITION_STALE);
        }
        let hdg = fix.hdg.ok_or(codes::HEADING_UNKNOWN)?;
        let own = GeoPos {
            lat_deg: fix.lat,
            lon_deg: fix.lon,
            alt_m: fix.alt_msl,
        };
        let goal = GeoPos {
            lat_deg: target.lat,
            lon_deg: target.lon,
            alt_m: target.alt_msl,
        };
        let look = look_angles(&own, &goal);
        if look.distance_m < MIN_DISTANCE_M {
            return Err(codes::TARGET_TOO_CLOSE);
        }
        let cmd = to_gimbal_angles(&look, hdg, self.settings.yaw_offset_deg);
        if !(cmd.yaw_deg.is_finite() && cmd.pitch_deg.is_finite()) {
            return Err(codes::INVALID_ANGLES);
        }
        Ok(((cmd.yaw_deg, cmd.pitch_deg), look))
    }

    fn gains(&self) -> PidGains {
        let s = &self.settings;
        PidGains {
            kp: s.pid_kp,
            ki: s.pid_ki,
            kd: s.pid_kd,
            i_limit: s.max_speed / 2.0,
            out_limit: s.max_speed,
        }
    }

    /// Rate mode: attitude vs goal → deadband → PID → 0x07 speed (+yaw = right).
    fn rate_cycle(&self, goal: (f64, f64), inp: &RoiInputs) -> Cycle {
        let Some(att) = fresh_attitude(inp.attitude) else {
            let (halted, zero) = self.halt(false);
            return (halted, zero, Some(codes::NO_ATTITUDE));
        };
        let (lp, now, db) = (self.lp(), inp.now_ms, self.settings.deadband_deg);
        let period = self.period_ms() as f64 / 1000.0;
        let dt = lp.control_at.map_or(period, |t| {
            (now.saturating_sub(t) as f64 / 1000.0).min(DT_MAX_PERIODS * period)
        });
        let yaw_error = stable_yaw_error(goal.0, att.yaw, lp.yaw_error);
        let (e_yaw, hold_yaw) = deadband_with_hysteresis(yaw_error, db, lp.hold_yaw);
        let (e_pitch, hold_pitch) = deadband_with_hysteresis(goal.1 - att.pitch, db, lp.hold_pitch);
        let gains = self.gains();
        let (out_yaw, pid_yaw) = axis(&gains, &lp.pid_yaw, e_yaw, dt);
        let (out_pitch, pid_pitch) = axis(&gains, &lp.pid_pitch, e_pitch, dt);
        let speed = (to_speed(-out_yaw), to_speed(out_pitch));
        let send = speed != STILL || self.last_speed != STILL;
        let next_lp = LoopState {
            control_at: Some(now),
            pid_yaw,
            pid_pitch,
            hold_yaw,
            hold_pitch,
            yaw_error: Some(yaw_error),
            ..lp.clone()
        };
        let status = RoiStatus {
            gimbal_yaw_deg: Some(att.yaw),
            gimbal_pitch_deg: Some(att.pitch),
            speed_yaw: Some(speed.0),
            speed_pitch: Some(speed.1),
            ..self.status.clone()
        };
        let next = Self {
            last_speed: speed,
            zero_resends: if speed != STILL { 0 } else { self.zero_resends },
            ..self.with_lp(next_lp, status)
        };
        let commands = if send { vec![rate_cmd(speed)] } else { Vec::new() };
        (next, commands, None)
    }

    /// Angle mode: 0x0E when the goal moved by at least the deadband.
    fn angle_cycle(&self, goal: (f64, f64)) -> Cycle {
        let lp = self.lp();
        let last = lp.last_sent_angle;
        let yaw = stabilize_yaw(goal.0, last.map(|l| l.0));
        let pitch = goal.1;
        let moved =
            last.is_none_or(|l| (yaw - l.0).abs().max((pitch - l.1).abs()) >= self.settings.deadband_deg);
        if !moved {
            return (self.clone(), Vec::new(), None);
        }
        let next_lp = LoopState {
            last_sent_angle: Some((yaw, pitch)),
            ..lp.clone()
        };
        let status = RoiStatus {
            yaw_cmd_deg: Some(yaw),
            ..self.status.clone()
        };
        let cmd = CameraCommand::GimbalAngle {
            yaw_deg: yaw as f32,
            pitch_deg: pitch as f32,
        };
        (self.with_lp(next_lp, status), vec![cmd], None)
    }
}

fn fresh_attitude(att: Option<AttitudeSample>) -> Option<AttitudeSample> {
    att.filter(|a| a.age_ms <= ATTITUDE_MAX_AGE_MS && a.yaw.is_finite() && a.pitch.is_finite())
}

/// Inside the deadband: output 0 and forget the integral.
fn axis(gains: &PidGains, state: &PidState, error: f64, dt: f64) -> (f64, PidState) {
    if error == 0.0 {
        return (0.0, PidState::default());
    }
    pid_step(gains, state, error, dt)
}

fn to_speed(out: f64) -> i8 {
    out.round().clamp(-100.0, 100.0) as i8
}
