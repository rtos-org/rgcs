//! What the AI may propose. A proposal passes the same checks a direct command
//! would (`invalid`, `precheck`, `vtol_unknown`) plus proposal-only rules: the mode must exist on
//! this airframe, the speed must be sane, and `other` / `change_alt` are never proposed.

use axum::http::StatusCode;
use rgcs_core::{VehicleCommand, VehicleState};

use crate::commands::{precheck, vtol_unknown};
use crate::other_guard::Refusal;

/// Speeds (m/s) the AI may propose for `change_speed`.
pub const SPEED_RANGE: std::ops::RangeInclusive<f32> = 0.5..=40.0;

/// The proposal as it will be shown and later executed (mode upper-cased), or why it is refused.
/// `vtol_seen`: whether EXTENDED_SYS_STATE has been received (see `commands::vtol_unknown`).
pub fn validate_proposal(
    cmd: VehicleCommand,
    v: &VehicleState,
    vtol_seen: bool,
) -> Result<VehicleCommand, Refusal> {
    let cmd = proposal_rules(cmd, v)?;
    if let Some(reason) = cmd.invalid() {
        return Err((StatusCode::BAD_REQUEST, "invalid", reason));
    }
    match precheck(&cmd, v).or_else(|| vtol_unknown(&cmd, v, vtol_seen)) {
        Some(refusal) => Err(refusal),
        None => Ok(cmd),
    }
}

/// Rules that only proposals have; the command path itself accepts these commands.
fn proposal_rules(cmd: VehicleCommand, v: &VehicleState) -> Result<VehicleCommand, Refusal> {
    match cmd {
        VehicleCommand::Other { .. } => Err((
            StatusCode::UNPROCESSABLE_ENTITY,
            "not_allowed",
            "raw MAV_CMDs are never proposed".into(),
        )),
        VehicleCommand::ChangeAlt { .. } => Err((
            StatusCode::UNPROCESSABLE_ENTITY,
            "not_implemented",
            "altitude change is not implemented yet".into(),
        )),
        VehicleCommand::SetMode { mode } => known_mode(&mode, v).map(|mode| VehicleCommand::SetMode { mode }),
        VehicleCommand::ChangeSpeed { mps } if !SPEED_RANGE.contains(&mps) => Err((
            StatusCode::BAD_REQUEST,
            "invalid",
            format!(
                "speed must be {} to {} m/s",
                SPEED_RANGE.start(),
                SPEED_RANGE.end()
            ),
        )),
        other => Ok(other),
    }
}

/// `mode` upper-cased when this airframe has it (`modes_for(kind, vtol)`).
fn known_mode(mode: &str, v: &VehicleState) -> Result<String, Refusal> {
    let upper = mode.trim().to_uppercase();
    if rgcs_mavlink::modes::modes_for(v.kind, v.vtol).contains(&upper.as_str()) {
        return Ok(upper);
    }
    Err((
        StatusCode::BAD_REQUEST,
        "invalid_mode",
        format!("{upper} is not a mode of this vehicle"),
    ))
}

#[cfg(test)]
mod tests {
    use rgcs_core::{LinkStatus, VehicleCommand, VehicleKind, VehicleState};

    use super::*;

    fn vehicle(kind: VehicleKind, vtol: bool) -> VehicleState {
        VehicleState {
            kind,
            vtol,
            ..VehicleState::new(3, "UAV-03")
        }
    }

    fn copter() -> VehicleState {
        vehicle(VehicleKind::Copter, false)
    }

    fn code(r: Result<VehicleCommand, crate::other_guard::Refusal>) -> &'static str {
        r.expect_err("refused").1
    }

    fn set_mode(mode: &str) -> VehicleCommand {
        VehicleCommand::SetMode { mode: mode.into() }
    }

    #[test]
    fn modes_are_normalised_and_checked_per_airframe() {
        assert_eq!(
            validate_proposal(set_mode(" loiter "), &copter(), true),
            Ok(set_mode("LOITER"))
        );
        assert_eq!(
            code(validate_proposal(set_mode("QLOITER"), &copter(), true)),
            "invalid_mode"
        );
        let vtol = vehicle(VehicleKind::Plane, true);
        assert_eq!(
            validate_proposal(set_mode("qloiter"), &vtol, true),
            Ok(set_mode("QLOITER"))
        );
        let plane = vehicle(VehicleKind::Plane, false);
        assert_eq!(
            code(validate_proposal(set_mode("QLOITER"), &plane, true)),
            "invalid_mode"
        );
    }

    #[test]
    fn speed_must_be_in_range() {
        for mps in [0.4, 40.5, f32::NAN, f32::INFINITY] {
            let r = validate_proposal(VehicleCommand::ChangeSpeed { mps }, &copter(), true);
            assert_eq!(code(r), "invalid", "{mps}");
        }
        let ok = VehicleCommand::ChangeSpeed { mps: 12.0 };
        assert_eq!(validate_proposal(ok.clone(), &copter(), true), Ok(ok));
        assert!(SPEED_RANGE.contains(&0.5) && SPEED_RANGE.contains(&40.0));
    }

    #[test]
    fn change_alt_and_other_are_never_proposed() {
        let alt = VehicleCommand::ChangeAlt { alt_rel: 50.0 };
        assert_eq!(code(validate_proposal(alt, &copter(), true)), "not_implemented");
        let other = VehicleCommand::Other {
            mav_cmd: 224,
            params: [0.0; 7],
        };
        assert_eq!(code(validate_proposal(other, &copter(), true)), "not_allowed");
    }

    #[test]
    fn the_command_path_prechecks_apply() {
        let takeoff = VehicleCommand::Takeoff { alt_rel: 30.0 };
        let (_, c, reason) = validate_proposal(takeoff.clone(), &copter(), true).unwrap_err();
        assert_eq!((c, reason.as_str()), ("rejected", "arm first"));
        let too_high = VehicleCommand::Takeoff { alt_rel: 1500.0 };
        let armed = VehicleState {
            armed: true,
            ..copter()
        };
        assert_eq!(code(validate_proposal(too_high, &armed, true)), "invalid");
        assert_eq!(
            validate_proposal(takeoff.clone(), &armed, true),
            Ok(takeoff.clone())
        );
        assert_eq!(
            code(validate_proposal(VehicleCommand::Arm, &armed, true)),
            "rejected"
        );
        let lost = VehicleState {
            link: LinkStatus::Lost,
            ..copter()
        };
        for cmd in [VehicleCommand::Rtl, VehicleCommand::Arm, set_mode("LOITER")] {
            assert_eq!(code(validate_proposal(cmd, &lost, true)), "link_lost");
        }
    }

    #[test]
    fn a_plane_takeoff_waits_for_the_vtol_state() {
        let plane = VehicleState {
            armed: true,
            ..vehicle(VehicleKind::Plane, false)
        };
        let takeoff = VehicleCommand::Takeoff { alt_rel: 30.0 };
        assert_eq!(
            code(validate_proposal(takeoff.clone(), &plane, false)),
            "vtol_unknown"
        );
        assert_eq!(validate_proposal(takeoff.clone(), &plane, true), Ok(takeoff));
    }
}
