use super::*;
use rgcs_core::{CameraCommand, GimbalMode, RoiControl, RoiControlMode, RoiTarget};

const T0: u64 = 100_000;

fn target(id: &str, name: &str, lat: f64, lon: f64, alt: f64) -> RoiTarget {
    RoiTarget {
        id: id.into(),
        name: name.into(),
        lat,
        lon,
        alt_msl: alt,
    }
}

fn north() -> RoiTarget {
    target("roi_1", "North", 35.009, 139.0, 0.0)
}

fn here() -> RoiTarget {
    target("roi_2", "Here", 35.0, 139.0, 1.0)
}

fn south() -> RoiTarget {
    target("roi_3", "South", 34.991, 139.0, 0.0)
}

fn angle_settings() -> RoiControl {
    RoiControl {
        control_mode: RoiControlMode::Angle,
        target_rate_hz: 10.0,
        smoothing_tau_s: 0.0,
        deadband_deg: 0.0,
        ..RoiControl::default()
    }
}

fn rate_settings() -> RoiControl {
    RoiControl {
        control_mode: RoiControlMode::Rate,
        target_rate_hz: 2.0,
        smoothing_tau_s: 0.0,
        deadband_deg: 0.3,
        pid_kp: 2.0,
        pid_ki: 0.0,
        pid_kd: 0.0,
        max_speed: 60.0,
        ..RoiControl::default()
    }
}

fn fix(hdg: Option<f64>, age_ms: u64) -> Option<VehicleFix> {
    Some(VehicleFix {
        lat: 35.0,
        lon: 139.0,
        alt_msl: 0.0,
        hdg,
        age_ms,
    })
}

fn att(yaw: f64, pitch: f64, age_ms: u64) -> Option<AttitudeSample> {
    Some(AttitudeSample { yaw, pitch, age_ms })
}

fn inp(now_ms: u64, vehicle: Option<VehicleFix>, attitude: Option<AttitudeSample>) -> RoiInputs {
    RoiInputs {
        now_ms,
        vehicle,
        attitude,
    }
}

fn rates(out: &StepOut) -> Vec<(i8, i8)> {
    out.commands
        .iter()
        .filter_map(|c| match c {
            CameraCommand::GimbalRate { yaw, pitch } => Some((*yaw, *pitch)),
            _ => None,
        })
        .collect()
}

fn angles(out: &StepOut) -> Vec<(f32, f32)> {
    out.commands
        .iter()
        .filter_map(|c| match c {
            CameraCommand::GimbalAngle { yaw_deg, pitch_deg } => Some((*yaw_deg, *pitch_deg)),
            _ => None,
        })
        .collect()
}

fn modes(out: &StepOut) -> usize {
    out.commands
        .iter()
        .filter(|c| {
            matches!(
                c,
                CameraCommand::GimbalMode {
                    mode: GimbalMode::Follow
                }
            )
        })
        .count()
}

fn near(a: f64, b: f64, tol: f64) {
    assert!((a - b).abs() <= tol, "{a} vs {b} (tol {tol})");
}

fn started(settings: RoiControl, t: RoiTarget) -> RoiController {
    RoiController::new(settings).start(t).unwrap().0
}

/// Runs steps and returns the final controller plus every step's output.
fn run(c: &RoiController, inputs: &[RoiInputs]) -> (RoiController, Vec<StepOut>) {
    inputs.iter().fold((c.clone(), Vec::new()), |(c, outs), i| {
        let (next, out) = c.step(i);
        (next, [outs, vec![out]].concat())
    })
}

fn all_rates(outs: &[StepOut]) -> Vec<(i8, i8)> {
    outs.iter().flat_map(rates).collect()
}

fn all_angles(outs: &[StepOut]) -> Vec<(f32, f32)> {
    outs.iter().flat_map(angles).collect()
}

/// Rate-mode controller already turning left at -60 (hdg 90, gimbal at 0).
fn moving() -> RoiController {
    let c = started(rate_settings(), north());
    let (c, out) = c.step(&inp(T0, fix(Some(90.0), 0), att(0.0, 0.0, 0)));
    assert_eq!(rates(&out), vec![(-60, 0)]);
    c
}

// ── angle mode ───────────────────────────────────────────────────

#[test]
fn follow_sent_on_first_step_only() {
    let (c, out) = RoiController::new(angle_settings()).start(north()).unwrap();
    assert_eq!(out.commands, vec![CameraCommand::GimbalRate { yaw: 0, pitch: 0 }]);
    assert_eq!(c.status().active_target.as_deref(), Some("roi_1"));
    let (_, outs) = run(
        &c,
        &[
            inp(T0, fix(Some(0.0), 0), None),
            inp(T0 + 100, fix(Some(0.0), 0), None),
        ],
    );
    assert_eq!(outs.iter().map(modes).sum::<usize>(), 1);
    assert_eq!(all_angles(&outs).len(), 2);
}

/// I4: the operator's stick may have left the gimbal turning (its release zero is dropped
/// while ROI is active), so a start always zeros, and a goal error keeps re-zeroing.
#[test]
fn start_forces_zero_even_when_controller_was_still() {
    let (c, out) = RoiController::new(rate_settings()).start(north()).unwrap();
    assert_eq!(rates(&out), vec![(0, 0)]);
    let (_, out) = c.step(&inp(T0, None, None));
    assert_eq!(c.status().error, None);
    assert_eq!(
        rates(&out),
        vec![(0, 0)],
        "goal error after start re-sends the zero"
    );
}

#[test]
fn start_rejects_unset_target() {
    let c = RoiController::new(angle_settings());
    let unnamed = target("roi_1", "  ", 35.0, 139.0, 0.0);
    let zero = target("roi_1", "Named", 0.0, 0.0, 0.0);
    assert_eq!(c.start(unnamed).unwrap_err(), RoiStartError::Unset);
    assert_eq!(c.start(zero).unwrap_err(), RoiStartError::Unset);
}

#[test]
fn angle_relative_to_heading() {
    let c = started(angle_settings(), north());
    let (c, out) = c.step(&inp(T0, fix(Some(90.0), 0), None));
    let (yaw, pitch) = angles(&out)[0];
    near(yaw as f64, 90.0, 0.1);
    near(pitch as f64, 0.0, 0.1);
    let s = c.status();
    near(s.distance_m.unwrap(), 1000.0, 10.0);
    assert_eq!(s.error, None);
    assert_eq!(s.mode, Some(RoiControlMode::Angle));
}

#[test]
fn inactive_step_is_silent() {
    let c = RoiController::new(angle_settings());
    let (_, out) = c.step(&inp(T0, fix(Some(0.0), 0), None));
    assert!(out.commands.is_empty());
}

fn assert_goal_error(t: RoiTarget, vehicle: Option<VehicleFix>, code: &str) {
    let c = started(angle_settings(), t);
    let (c, out) = c.step(&inp(T0, vehicle, None));
    assert!(angles(&out).is_empty());
    assert_eq!(c.status().error.as_deref(), Some(code));
    assert!(c.is_active());
}

#[test]
fn no_vehicle_reports_no_position() {
    assert_goal_error(north(), None, codes::NO_POSITION);
}

#[test]
fn stale_position_reports_stale() {
    assert_goal_error(north(), fix(Some(0.0), 2_500), codes::POSITION_STALE);
}

#[test]
fn unknown_heading_reports_heading() {
    assert_goal_error(north(), fix(None, 0), codes::HEADING_UNKNOWN);
}

#[test]
fn target_too_close() {
    assert_goal_error(here(), fix(Some(0.0), 0), codes::TARGET_TOO_CLOSE);
}

#[test]
fn too_close_resumes_when_vehicle_moves_away() {
    let c = started(angle_settings(), here());
    let (c, _) = c.step(&inp(T0, fix(Some(0.0), 0), None));
    let away = Some(VehicleFix {
        lat: 35.001,
        ..fix(Some(0.0), 0).unwrap()
    });
    let (c, out) = c.step(&inp(T0 + 100, away, None));
    assert_eq!(angles(&out).len(), 1);
    assert_eq!(c.status().error, None);
}

#[test]
fn stop_then_step_sends_no_angle() {
    let c = started(angle_settings(), north());
    let (c, _) = c.stop(StopReason::Operator);
    let (c, out) = c.step(&inp(T0, fix(Some(0.0), 0), None));
    assert!(angles(&out).is_empty());
    assert_eq!(c.status().active_target, None);
    assert!(!c.is_active());
}

#[test]
fn retarget_removing_active_stops() {
    let c = started(angle_settings(), north());
    let (c, out) = c.retarget(&[here()]);
    assert!(!c.is_active());
    assert_eq!(rates(&out), vec![(0, 0)]);
    let unset = started(angle_settings(), north())
        .retarget(&[RoiTarget::empty(1)])
        .0;
    assert!(!unset.is_active());
}

#[test]
fn retarget_moving_active_keeps_running() {
    let c = started(angle_settings(), north());
    let (c, _) = c.step(&inp(T0, fix(Some(0.0), 0), None));
    let east = target("roi_1", "North", 35.0, 139.011, 0.0);
    let (c, out) = c.retarget(&[east]);
    assert!(out.commands.is_empty());
    assert!(c.is_active());
    let (_, out) = c.step(&inp(T0 + 100, fix(Some(0.0), 0), None));
    near(angles(&out)[0].0 as f64, -90.0, 0.1);
}

#[test]
fn yaw_offset_applied() {
    let settings = RoiControl {
        yaw_offset_deg: 2.5,
        ..angle_settings()
    };
    let (_, out) = started(settings, north()).step(&inp(T0, fix(Some(0.0), 0), None));
    near(angles(&out)[0].0 as f64, 2.5, 0.1);
}

#[test]
fn follow_failure_reported_and_retried() {
    let c = started(angle_settings(), north());
    let (c, _) = c.step(&inp(T0, fix(Some(0.0), 0), None));
    let follow = CameraCommand::GimbalMode {
        mode: GimbalMode::Follow,
    };
    let (c, _) = c.send_failed(&follow);
    assert_eq!(c.status().error.as_deref(), Some(codes::FOLLOW_FAILED));
    assert!(c.is_active());
    let (c, out) = c.step(&inp(T0 + 100, fix(Some(0.0), 0), None));
    assert_eq!(modes(&out), 1);
    assert_eq!(c.status().error, None);
}

#[test]
fn yaw_hysteresis_keeps_previous_side() {
    let c = started(angle_settings(), south());
    let (c, out1) = c.step(&inp(T0, fix(Some(0.1), 0), None));
    let (_, out2) = c.step(&inp(T0 + 100, fix(Some(-0.1), 0), None));
    let (first, second) = (angles(&out1)[0].0 as f64, angles(&out2)[0].0 as f64);
    assert!((second - first).abs() < 1.0, "{first} -> {second}");
    assert!(second.abs() <= 190.0);
}

#[test]
fn yaw_hysteresis_released_away_from_boundary() {
    let c = started(angle_settings(), south());
    let (c, _) = c.step(&inp(T0, fix(Some(0.1), 0), None));
    let (_, out) = c.step(&inp(T0 + 100, fix(Some(-30.0), 0), None));
    near(angles(&out)[0].0 as f64, 150.0, 0.1);
}

#[test]
fn follow_reasserted_every_5s() {
    let c = started(angle_settings(), north());
    let (c, outs) = run(
        &c,
        &[
            inp(T0, fix(Some(0.0), 0), None),
            inp(T0 + 3000, fix(Some(0.0), 0), None),
        ],
    );
    assert_eq!(outs.iter().map(modes).sum::<usize>(), 1);
    let (_, out) = c.step(&inp(T0 + 5500, fix(Some(0.0), 0), None));
    assert_eq!(modes(&out), 1);
    assert!(matches!(
        out.commands.last(),
        Some(CameraCommand::GimbalMode { .. })
    ));
}

#[test]
fn angle_deadband_suppresses_small_changes() {
    let settings = RoiControl {
        deadband_deg: 0.5,
        ..angle_settings()
    };
    let c = started(settings, north());
    let (_, outs) = run(
        &c,
        &[
            inp(T0, fix(Some(0.0), 0), None),
            inp(T0 + 100, fix(Some(0.3), 0), None),
        ],
    );
    assert_eq!(all_angles(&outs).len(), 1);
    let (_, outs) = run(
        &c,
        &[
            inp(T0, fix(Some(0.0), 0), None),
            inp(T0 + 100, fix(Some(0.3), 0), None),
            inp(T0 + 200, fix(Some(1.0), 0), None),
        ],
    );
    assert_eq!(all_angles(&outs).len(), 2);
}

// ── rate mode ────────────────────────────────────────────────────

#[test]
fn rate_target_left_turns_left_with_negative_yaw() {
    let c = started(rate_settings(), north());
    let (_, out) = c.step(&inp(T0, fix(Some(90.0), 0), att(0.0, 0.0, 0)));
    assert_eq!(rates(&out), vec![(-60, 0)]);
    assert!(angles(&out).is_empty());
    assert!(out.request_attitude);
}

#[test]
fn rate_proportional_and_deadband() {
    let c = started(rate_settings(), north());
    let (c, out) = c.step(&inp(T0, fix(Some(-10.0), 0), att(-5.0, 0.0, 0)));
    assert_eq!(rates(&out), vec![(10, 0)]);
    let (_, out) = c.step(&inp(T0 + 100, fix(Some(-10.0), 0), att(-9.8, 0.0, 0)));
    assert_eq!(rates(&out), vec![(0, 0)]);
}

#[test]
fn rate_zero_not_sent_when_still() {
    let c = started(rate_settings(), north());
    let still = |t| inp(t, fix(Some(0.0), 0), att(0.0, 0.0, 0));
    let (_, outs) = run(
        &c,
        &[still(T0), still(T0 + 100), still(T0 + 200), still(T0 + 300)],
    );
    // Only the start zero's two resends; nothing once they are spent.
    assert_eq!(all_rates(&outs[..2]), vec![(0, 0), (0, 0)]);
    assert!(all_rates(&outs[2..]).is_empty());
}

#[test]
fn goal_recomputed_only_at_target_rate() {
    let c = started(rate_settings(), north());
    let (c, _) = c.step(&inp(T0, fix(Some(0.0), 0), att(0.0, 0.0, 0)));
    let (c, _) = c.step(&inp(T0 + 200, fix(Some(-90.0), 0), att(0.0, 0.0, 0)));
    near(c.status().yaw_cmd_deg.unwrap(), 0.0, 0.1);
    let (c, _) = c.step(&inp(T0 + 500, fix(Some(-90.0), 0), att(0.0, 0.0, 0)));
    near(c.status().yaw_cmd_deg.unwrap(), -90.0, 0.1);
}

#[test]
fn smoothing_moves_goal_gradually() {
    let settings = RoiControl {
        smoothing_tau_s: 1.0,
        ..rate_settings()
    };
    let c = started(settings, north());
    let (c, _) = c.step(&inp(T0, fix(Some(0.0), 0), att(0.0, 0.0, 0)));
    let (c, _) = c.step(&inp(T0 + 500, fix(Some(90.0), 0), att(0.0, 0.0, 0)));
    let yaw = c.status().yaw_cmd_deg.unwrap();
    assert!(20.0 < yaw && yaw < 90.0, "{yaw}");
}

#[test]
fn stale_attitude_halts() {
    let (c, out) = moving().step(&inp(T0 + 100, fix(Some(90.0), 0), att(0.0, 0.0, 1000)));
    assert_eq!(rates(&out), vec![(0, 0)]);
    assert_eq!(c.status().error.as_deref(), Some(codes::NO_ATTITUDE));
    assert!(out.request_attitude);
}

#[test]
fn missing_attitude_halts() {
    let (c, out) = moving().step(&inp(T0 + 100, fix(Some(90.0), 0), None));
    assert_eq!(rates(&out), vec![(0, 0)]);
    assert_eq!(c.status().error.as_deref(), Some(codes::NO_ATTITUDE));
}

#[test]
fn stale_position_halts_rate() {
    let (c, out) = moving().step(&inp(T0 + 3000, fix(Some(90.0), 3000), att(0.0, 0.0, 0)));
    assert_eq!(rates(&out), vec![(0, 0)]);
    assert_eq!(c.status().error.as_deref(), Some(codes::POSITION_STALE));
    assert!(c.is_active());
}

#[test]
fn nonzero_speed_resent_every_cycle() {
    let (_, out) = moving().step(&inp(T0 + 100, fix(Some(90.0), 0), att(0.0, 0.0, 0)));
    assert_eq!(rates(&out), vec![(-60, 0)]);
}

#[test]
fn stop_sends_zero_and_two_resends() {
    let (c, out) = moving().stop(StopReason::Operator);
    assert_eq!(rates(&out), vec![(0, 0)]);
    let steps: Vec<RoiInputs> = (1..=5)
        .map(|i| inp(T0 + 100 * i, fix(Some(90.0), 0), att(0.0, 0.0, 0)))
        .collect();
    let (c, outs) = run(&c, &steps);
    assert_eq!(all_rates(&outs), vec![(0, 0), (0, 0)]);
    assert_eq!(outs.iter().map(|o| o.commands.len()).sum::<usize>(), 2);
    assert!(c.is_idle());
}

#[test]
fn manual_stop_sends_single_zero() {
    let (c, out) = moving().stop(StopReason::Manual);
    assert_eq!(rates(&out), vec![(0, 0)]);
    let (c, outs) = run(
        &c,
        &[
            inp(T0 + 100, fix(Some(90.0), 0), att(0.0, 0.0, 0)),
            inp(T0 + 200, fix(Some(90.0), 0), att(0.0, 0.0, 0)),
        ],
    );
    assert!(all_rates(&outs).is_empty());
    assert!(c.is_idle());
}

#[test]
fn manual_stop_after_operator_stop_drops_resends() {
    let (c, _) = moving().stop(StopReason::Operator);
    let (c, out) = c.stop(StopReason::Manual);
    assert!(out.commands.is_empty());
    assert!(c.is_idle());
}

#[test]
fn stop_when_still_still_sends_zero() {
    let c = started(rate_settings(), north());
    let (c, _) = c.step(&inp(T0, fix(Some(0.0), 0), att(0.0, 0.0, 0)));
    let (_, out) = c.stop(StopReason::Operator);
    assert_eq!(rates(&out), vec![(0, 0)]);
    let (_, out) = started(angle_settings(), north()).stop(StopReason::Shutdown);
    assert_eq!(rates(&out), vec![(0, 0)]);
}

#[test]
fn switching_to_angle_mode_halts() {
    let (c, out) = moving().configure(RoiControl {
        control_mode: RoiControlMode::Angle,
        ..rate_settings()
    });
    assert_eq!(rates(&out), vec![(0, 0)]);
    assert_eq!(c.status().mode, Some(RoiControlMode::Angle));
    let (_, out) = c.step(&inp(T0 + 100, fix(Some(90.0), 0), None));
    assert_eq!(angles(&out).len(), 1);
}

#[test]
fn send_failure_halts_and_reports() {
    let (c, out) = moving().send_failed(&CameraCommand::GimbalRate { yaw: -60, pitch: 0 });
    assert_eq!(rates(&out), vec![(0, 0)]);
    assert_eq!(c.status().error.as_deref(), Some(codes::SEND_FAILED));
    assert_eq!(c.status().speed_yaw, Some(0));
}

#[test]
fn starting_another_target_halts_first() {
    let east = target("roi_3", "E", 35.0, 139.011, 0.0);
    let (c, out) = moving().start(east).unwrap();
    assert_eq!(rates(&out), vec![(0, 0)]);
    assert_eq!(c.status().active_target.as_deref(), Some("roi_3"));
}

#[test]
fn dt_clamped_after_gap() {
    let settings = RoiControl {
        pid_kp: 0.0,
        pid_ki: 1.0,
        ..rate_settings()
    };
    let c = started(settings, north());
    let (c, out) = c.step(&inp(T0, fix(Some(90.0), 0), att(0.0, 0.0, 0)));
    let first = rates(&out)[0].0.unsigned_abs() as f64;
    let (_, out) = c.step(&inp(T0 + 5000, fix(Some(90.0), 0), att(0.0, 0.0, 0)));
    let second = rates(&out)[0].0.unsigned_abs() as f64;
    assert!(first > 0.0);
    assert!(second <= first + 90.0 * 0.2 + 1.0, "{first} -> {second}");
}

#[test]
fn non_finite_attitude_halts() {
    let (c, out) = moving().step(&inp(T0 + 100, fix(Some(90.0), 0), att(f64::NAN, 0.0, 0)));
    assert_eq!(rates(&out), vec![(0, 0)]);
    assert_eq!(c.status().error.as_deref(), Some(codes::NO_ATTITUDE));
}

#[test]
fn halt_clears_displayed_speed() {
    let c = moving();
    assert_eq!(c.status().speed_yaw, Some(-60));
    let (c, _) = c.step(&inp(T0 + 1000, fix(Some(90.0), 0), att(0.0, 0.0, 1000)));
    assert_eq!(c.status().speed_yaw, Some(0));
    assert_eq!(c.status().speed_pitch, Some(0));
}

#[test]
fn controller_is_not_mutated() {
    let c = moving();
    let before = c.clone();
    let _ = c.step(&inp(T0 + 100, fix(Some(90.0), 0), att(0.0, 0.0, 0)));
    let _ = c.stop(StopReason::Operator);
    let _ = c.send_failed(&CameraCommand::GimbalRate { yaw: 0, pitch: 0 });
    assert_eq!(c, before);
}

#[test]
fn stabilize_yaw_limits() {
    near(stabilize_yaw(-179.0, Some(179.0)), 181.0, 1e-9);
    near(stabilize_yaw(-100.0, Some(179.0)), -100.0, 1e-9);
    near(stabilize_yaw(-175.0, Some(-170.0)), -175.0, 1e-9);
    near(stabilize_yaw(42.0, None), 42.0, 1e-9);
}

#[test]
fn period_ms_rounds_with_floor() {
    assert_eq!(RoiController::new(rate_settings()).period_ms(), 100);
    let fast = RoiControl {
        rate_hz: 50.0,
        ..rate_settings()
    };
    assert_eq!(RoiController::new(fast).period_ms(), 20);
    let odd = RoiControl {
        rate_hz: 3.0,
        ..rate_settings()
    };
    assert_eq!(RoiController::new(odd).period_ms(), 333);
}
