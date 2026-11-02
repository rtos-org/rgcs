//! What `{cmd: "other"}` may send. Only the MAV_CMDs the UI uses pass: a raw
//! ARM_DISARM (400) or MISSION_START (300) would skip the confirm token their named commands
//! need, and SET_MESSAGE_INTERVAL could silence the HEARTBEAT the link check depends on.

use axum::http::StatusCode;
use rgcs_core::VehicleState;

pub type Refusal = (StatusCode, &'static str, String);

const MAV_CMD_DO_SET_MISSION_CURRENT: u16 = 224;
const MAV_CMD_PREFLIGHT_REBOOT_SHUTDOWN: u16 = 246;
const MAV_CMD_SET_MESSAGE_INTERVAL: u16 = 511;

const HEARTBEAT: f32 = 0.0;
/// HEARTBEAT, SYS_STATUS, GPS_RAW_INT, ATTITUDE, GLOBAL_POSITION_INT, MISSION_CURRENT, VFR_HUD
/// (the UI's `CORE_TELEMETRY`).
const CORE_TELEMETRY: [f32; 7] = [0.0, 1.0, 24.0, 30.0, 33.0, 42.0, 74.0];
/// While armed, core telemetry stays at 0.5 Hz or faster.
const ARMED_MAX_INTERVAL_US: f32 = 2_000_000.0;
/// No stream faster than 100 Hz (a 1 µs request would flood the link).
const MIN_INTERVAL_US: f32 = 10_000.0;
/// PREFLIGHT_REBOOT_SHUTDOWN params the UI sends: reboot the autopilot, nothing else.
const REBOOT_AUTOPILOT: [f32; 7] = [1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0];

/// `None` when the command may go to the queue.
pub fn check(mav_cmd: u16, params: &[f32; 7], v: &VehicleState) -> Option<Refusal> {
    match mav_cmd {
        MAV_CMD_DO_SET_MISSION_CURRENT => None,
        MAV_CMD_SET_MESSAGE_INTERVAL => check_rate(params[0], params[1], v.armed),
        MAV_CMD_PREFLIGHT_REBOOT_SHUTDOWN if *params != REBOOT_AUTOPILOT => Some(invalid(
            "only an autopilot reboot (param1 = 1, other params 0) is allowed",
        )),
        MAV_CMD_PREFLIGHT_REBOOT_SHUTDOWN if v.armed => Some(armed("no reboot while armed")),
        MAV_CMD_PREFLIGHT_REBOOT_SHUTDOWN => None,
        _ => Some((
            StatusCode::UNPROCESSABLE_ENTITY,
            "not_allowed",
            format!("MAV_CMD {mav_cmd} cannot be sent as an other command"),
        )),
    }
}

fn armed(reason: &str) -> Refusal {
    (StatusCode::CONFLICT, "vehicle_armed", reason.into())
}

fn invalid(reason: &str) -> Refusal {
    (StatusCode::BAD_REQUEST, "invalid", reason.into())
}

/// SET_MESSAGE_INTERVAL: param1 message id, param2 interval µs (-1 stop, 0 default).
fn check_rate(msg_id: f32, interval_us: f32, is_armed: bool) -> Option<Refusal> {
    if !msg_id.is_finite() || msg_id < 0.0 || msg_id.fract() != 0.0 {
        return Some(invalid("param1 must be a message id"));
    }
    if !interval_us.is_finite() || interval_us < -1.0 {
        return Some(invalid("param2 must be -1, 0 or an interval in microseconds"));
    }
    if interval_us > 0.0 && interval_us < MIN_INTERVAL_US {
        return Some(invalid(
            "param2: no stream faster than 100 Hz (at least 10000 µs)",
        ));
    }
    if msg_id == HEARTBEAT {
        return Some(invalid(
            "the HEARTBEAT rate is never changed: the link check depends on it",
        ));
    }
    let slowed = interval_us < 0.0 || interval_us > ARMED_MAX_INTERVAL_US;
    if is_armed && CORE_TELEMETRY.contains(&msg_id) && slowed {
        return Some(armed("core telemetry stays at 0.5 Hz or faster while armed"));
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vehicle(armed: bool) -> VehicleState {
        VehicleState {
            armed,
            ..VehicleState::new(1, "UAV-01")
        }
    }

    fn rate(msg_id: f32, interval_us: f32) -> [f32; 7] {
        [msg_id, interval_us, 0.0, 0.0, 0.0, 0.0, 0.0]
    }

    const NONE: [f32; 7] = [0.0; 7];

    #[test]
    fn go_to_wp_passes_armed_or_not() {
        assert!(check(224, &[3.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0], &vehicle(true)).is_none());
        assert!(check(224, &NONE, &vehicle(false)).is_none());
    }

    #[test]
    fn commands_with_a_confirmed_named_form_or_unknown_ones_are_refused() {
        for mav_cmd in [400, 300, 185, 209, 241, 9999] {
            let (status, code, _) = check(mav_cmd, &NONE, &vehicle(false)).expect("refused");
            assert_eq!(
                (status, code),
                (StatusCode::UNPROCESSABLE_ENTITY, "not_allowed"),
                "{mav_cmd}"
            );
        }
    }

    #[test]
    fn the_heartbeat_rate_is_never_changed() {
        let (status, code, _) = check(511, &rate(0.0, -1.0), &vehicle(false)).expect("refused");
        assert_eq!((status, code), (StatusCode::BAD_REQUEST, "invalid"));
        assert!(check(511, &rate(0.0, 0.0), &vehicle(false)).is_some());
    }

    #[test]
    fn core_telemetry_cannot_be_stopped_or_slowed_below_half_a_hertz_while_armed() {
        // GLOBAL_POSITION_INT (33): stop, 0.4 Hz refused; 0.5 Hz and the default pass.
        let armed = vehicle(true);
        assert_eq!(check(511, &rate(33.0, -1.0), &armed).unwrap().1, "vehicle_armed");
        assert_eq!(
            check(511, &rate(33.0, 2_500_000.0), &armed).unwrap().1,
            "vehicle_armed"
        );
        assert!(check(511, &rate(33.0, 2_000_000.0), &armed).is_none());
        assert!(check(511, &rate(33.0, 0.0), &armed).is_none());
        assert!(check(511, &rate(33.0, -1.0), &vehicle(false)).is_none());
        assert!(
            check(511, &rate(36.0, -1.0), &armed).is_none(),
            "SERVO_OUTPUT_RAW is not core"
        );
    }

    #[test]
    fn a_rate_request_must_name_a_message_and_a_sane_interval() {
        assert_eq!(
            check(511, &rate(-3.0, 0.0), &vehicle(false)).unwrap().1,
            "invalid"
        );
        assert_eq!(check(511, &rate(1.5, 0.0), &vehicle(false)).unwrap().1, "invalid");
        assert_eq!(
            check(511, &rate(33.0, -2.0), &vehicle(false)).unwrap().1,
            "invalid"
        );
        assert_eq!(
            check(511, &rate(33.0, f32::NAN), &vehicle(false)).unwrap().1,
            "invalid"
        );
    }

    #[test]
    fn reboot_must_be_autopilot_reboot_only() {
        let disarmed = vehicle(false);
        for params in [
            [2.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0], // shutdown
            [3.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0], // reboot to bootloader
            [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
            [1.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0], // + companion computer
            [1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 20190226.0],
            [1.0, 0.0, f32::NAN, 0.0, 0.0, 0.0, 0.0],
        ] {
            let (status, code, _) = check(246, &params, &disarmed).expect("refused");
            assert_eq!((status, code), (StatusCode::BAD_REQUEST, "invalid"), "{params:?}");
        }
    }

    #[test]
    fn rate_requests_faster_than_100_hz_are_refused() {
        let disarmed = vehicle(false);
        assert_eq!(check(511, &rate(33.0, 1.0), &disarmed).unwrap().1, "invalid");
        assert_eq!(check(511, &rate(33.0, 9_999.0), &disarmed).unwrap().1, "invalid");
        assert!(check(511, &rate(33.0, 10_000.0), &disarmed).is_none());
        assert!(check(511, &rate(33.0, 0.0), &disarmed).is_none());
        assert!(check(511, &rate(33.0, -1.0), &disarmed).is_none());
    }

    #[test]
    fn reboot_only_while_disarmed() {
        assert!(check(246, &[1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0], &vehicle(false)).is_none());
        assert_eq!(
            check(246, &[1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0], &vehicle(true))
                .unwrap()
                .1,
            "vehicle_armed"
        );
    }
}
