//! PID, deadband and angle smoothing for ROI rate control (port of `app/gimbal_pid.py`).

use super::geo::wrap_180;

/// Within this distance of +/-180 deg the yaw error keeps its previous sign (no dithering).
pub const YAW_FLIP_GUARD_DEG: f64 = 170.0;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PidGains {
    pub kp: f64,
    pub ki: f64,
    pub kd: f64,
    /// |integral term| clamp (output units) for anti-windup.
    pub i_limit: f64,
    /// |output| clamp (0x07 speed units).
    pub out_limit: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub struct PidState {
    /// Already multiplied by ki (output units).
    pub integral: f64,
    pub prev_error: Option<f64>,
}

/// One PID update. Returns (output, new_state); the given state is untouched.
pub fn pid_step(g: &PidGains, s: &PidState, error: f64, dt: f64) -> (f64, PidState) {
    let integral = (s.integral + g.ki * error * dt).clamp(-g.i_limit, g.i_limit);
    let derivative = match s.prev_error {
        Some(prev) if dt > 0.0 => (error - prev) / dt,
        _ => 0.0,
    };
    let output = (g.kp * error + integral + g.kd * derivative).clamp(-g.out_limit, g.out_limit);
    (
        output,
        PidState {
            integral,
            prev_error: Some(error),
        },
    )
}

pub fn apply_deadband(error: f64, deadband: f64) -> f64 {
    if error.abs() < deadband {
        0.0
    } else {
        error
    }
}

/// EMA with time constant `tau_s` (0 = off). With `wrap` the step takes the short way round.
pub fn smooth_angle(prev: Option<f64>, new: f64, dt: f64, tau_s: f64, wrap: bool) -> f64 {
    let prev = match prev {
        Some(p) if tau_s > 0.0 => p,
        _ => return new,
    };
    let alpha = 1.0 - (-dt.max(0.0) / tau_s).exp();
    let delta = if wrap { wrap_180(new - prev) } else { new - prev };
    let value = prev + alpha * delta;
    if wrap {
        wrap_180(value)
    } else {
        value
    }
}

/// Shortest yaw error, but keep the previous turning direction near +/-180 deg.
pub fn stable_yaw_error(target: f64, current: f64, prev_error: Option<f64>) -> f64 {
    let error = wrap_180(target - current);
    match prev_error {
        Some(prev)
            if error.abs() > YAW_FLIP_GUARD_DEG
                && prev.abs() > YAW_FLIP_GUARD_DEG
                && (error > 0.0) != (prev > 0.0) =>
        {
            error + if prev > 0.0 { 360.0 } else { -360.0 }
        }
        _ => error,
    }
}

/// Stop below `deadband`; once stopped, resume only above 2 x deadband.
/// Returns (error_to_use, holding).
pub fn deadband_with_hysteresis(error: f64, deadband: f64, holding: bool) -> (f64, bool) {
    let threshold = if holding { 2.0 * deadband } else { deadband };
    if error.abs() < threshold {
        (0.0, true)
    } else {
        (error, false)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const GAINS: PidGains = PidGains {
        kp: 2.0,
        ki: 0.5,
        kd: 0.1,
        i_limit: 20.0,
        out_limit: 60.0,
    };

    fn near(a: f64, b: f64, tol: f64) {
        assert!((a - b).abs() <= tol, "{a} vs {b} (tol {tol})");
    }

    fn gains(kp: f64, ki: f64, kd: f64, i_limit: f64, out_limit: f64) -> PidGains {
        PidGains {
            kp,
            ki,
            kd,
            i_limit,
            out_limit,
        }
    }

    #[test]
    fn pid_proportional_only_first_step() {
        let (out, s) = pid_step(
            &gains(2.0, 0.0, 0.0, 10.0, 100.0),
            &PidState::default(),
            10.0,
            0.1,
        );
        near(out, 20.0, 1e-9);
        assert_eq!(s.prev_error, Some(10.0));
    }

    #[test]
    fn pid_integral_accumulates_and_is_limited() {
        let g = gains(0.0, 1.0, 0.0, 0.5, 100.0);
        let mut s = PidState::default();
        let mut out = 0.0;
        for _ in 0..20 {
            (out, s) = pid_step(&g, &s, 1.0, 0.1);
        }
        near(s.integral, 0.5, 1e-9);
        near(out, 0.5, 1e-9);
    }

    #[test]
    fn pid_derivative_uses_error_change() {
        let g = gains(0.0, 0.0, 1.0, 10.0, 100.0);
        let (first, s) = pid_step(&g, &PidState::default(), 1.0, 0.1);
        near(first, 0.0, 1e-9);
        let (second, _) = pid_step(&g, &s, 2.0, 0.1);
        near(second, 10.0, 1e-9);
    }

    #[test]
    fn pid_output_clamped() {
        let (hi, _) = pid_step(&GAINS, &PidState::default(), 1000.0, 0.1);
        let (lo, _) = pid_step(&GAINS, &PidState::default(), -1000.0, 0.1);
        near(hi, 60.0, 1e-9);
        near(lo, -60.0, 1e-9);
    }

    #[test]
    fn pid_state_not_mutated() {
        let s = PidState::default();
        let _ = pid_step(&GAINS, &s, 5.0, 0.1);
        assert_eq!(s, PidState::default());
    }

    #[test]
    fn deadband_inside_zero_outside_passes() {
        near(apply_deadband(0.2, 0.3), 0.0, 0.0);
        near(apply_deadband(-0.29, 0.3), 0.0, 0.0);
        near(apply_deadband(0.5, 0.3), 0.5, 0.0);
        near(apply_deadband(-2.0, 0.3), -2.0, 0.0);
    }

    #[test]
    fn smooth_first_value_passes() {
        near(smooth_angle(None, 7.0, 0.1, 1.0, false), 7.0, 0.0);
    }

    #[test]
    fn smooth_ema_step() {
        near(
            smooth_angle(Some(0.0), 10.0, 0.5, 1.0, false),
            10.0 * (1.0 - (-0.5_f64).exp()),
            1e-9,
        );
    }

    #[test]
    fn smooth_zero_tau_disables() {
        near(smooth_angle(Some(0.0), 10.0, 0.5, 0.0, false), 10.0, 0.0);
    }

    #[test]
    fn smooth_wraps_across_180() {
        near(smooth_angle(Some(179.0), -179.0, 100.0, 1.0, true), -179.0, 1e-6);
        near(
            smooth_angle(Some(179.0), -179.0, 2.0_f64.ln(), 1.0, true).abs(),
            180.0,
            1e-6,
        );
    }

    #[test]
    fn stable_yaw_error_shortest() {
        near(stable_yaw_error(10.0, 0.0, None), 10.0, 1e-9);
        near(stable_yaw_error(-170.0, 170.0, None), 20.0, 1e-9);
    }

    #[test]
    fn stable_yaw_error_keeps_direction_near_180() {
        near(stable_yaw_error(-1.0, 178.0, Some(179.0)), 181.0, 1e-9);
    }

    #[test]
    fn stable_yaw_error_releases() {
        near(stable_yaw_error(-90.0, 0.0, Some(179.0)), -90.0, 1e-9);
    }

    #[test]
    fn deadband_hysteresis() {
        assert_eq!(deadband_with_hysteresis(0.2, 0.3, false), (0.0, true));
        assert_eq!(deadband_with_hysteresis(0.5, 0.3, true), (0.0, true));
        assert_eq!(deadband_with_hysteresis(0.7, 0.3, true), (0.7, false));
        assert_eq!(deadband_with_hysteresis(0.5, 0.3, false), (0.5, false));
    }
}
