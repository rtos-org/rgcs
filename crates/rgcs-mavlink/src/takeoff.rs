//! Takeoff per airframe (ArduPilot 4.x):
//! - Copter and QuadPlane: GUIDED (switched to first when needed), then COMMAND_LONG
//!   MAV_CMD_NAV_TAKEOFF with param7 = altitude above home. Both refuse it unless armed in GUIDED.
//! - Plain fixed wing: NAV_TAKEOFF is not handled; the TAKEOFF flight mode climbs to TKOFF_ALT.
//! - Rover / other: no takeoff.

use mavlink::dialects::ardupilotmega::MavCmd;
use rgcs_core::VehicleKind;

use crate::command::{set_mode, simple, EncodeError, Encoded, Frame};

/// The steps of a takeoff to `alt_rel` m above home; each one waits for its own ACK.
pub fn takeoff_steps(frame: &Frame, alt_rel: f32, target: u8) -> Result<Vec<Encoded>, EncodeError> {
    let hovers = match frame.kind {
        VehicleKind::Copter => true,
        VehicleKind::Plane => frame.vtol,
        VehicleKind::Rover | VehicleKind::Other => {
            return Err(EncodeError::NotForKind("this vehicle cannot take off".into()))
        }
    };
    if !hovers {
        return Ok(vec![set_mode(target, frame.kind, "TAKEOFF")?]);
    }
    let guided = if frame.mode.eq_ignore_ascii_case("GUIDED") {
        None
    } else {
        Some(set_mode(target, frame.kind, "GUIDED")?)
    };
    let takeoff = simple(
        target,
        MavCmd::MAV_CMD_NAV_TAKEOFF,
        [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, alt_rel],
    );
    Ok(guided.into_iter().chain([takeoff]).collect())
}

#[cfg(test)]
mod tests {
    use crate::command::{encode_steps, EncodeError, Encoded, Frame};
    use mavlink::dialects::ardupilotmega::{MavCmd, MavMessage};
    use rgcs_core::{VehicleCommand, VehicleKind};

    const TAKEOFF_30: VehicleCommand = VehicleCommand::Takeoff { alt_rel: 30.0 };

    fn frame(kind: VehicleKind, vtol: bool, mode: &str) -> Frame<'_> {
        Frame { kind, vtol, mode }
    }

    /// (command, param1, param2, param7) of each step.
    fn steps(e: &[Encoded]) -> Vec<(MavCmd, f32, f32, f32)> {
        e.iter()
            .map(|s| match &s.message {
                MavMessage::COMMAND_LONG(d) => {
                    assert_eq!(s.ack_for, d.command);
                    assert_eq!((d.target_system, d.target_component), (7, 1));
                    (d.command, d.param1, d.param2, d.param7)
                }
                other => panic!("{other:?}"),
            })
            .collect()
    }

    #[test]
    fn copter_switches_to_guided_then_takes_off() {
        let e = encode_steps(&TAKEOFF_30, &frame(VehicleKind::Copter, false, "STABILIZE"), 7).unwrap();
        assert_eq!(
            steps(&e),
            vec![
                (MavCmd::MAV_CMD_DO_SET_MODE, 1.0, 4.0, 0.0),
                (MavCmd::MAV_CMD_NAV_TAKEOFF, 0.0, 0.0, 30.0),
            ]
        );
    }

    #[test]
    fn copter_already_in_guided_only_takes_off() {
        let e = encode_steps(&TAKEOFF_30, &frame(VehicleKind::Copter, false, "GUIDED"), 7).unwrap();
        assert_eq!(steps(&e), vec![(MavCmd::MAV_CMD_NAV_TAKEOFF, 0.0, 0.0, 30.0)]);
    }

    #[test]
    fn quadplane_uses_plane_guided_then_takes_off() {
        let e = encode_steps(&TAKEOFF_30, &frame(VehicleKind::Plane, true, "QLOITER"), 7).unwrap();
        assert_eq!(
            steps(&e),
            vec![
                (MavCmd::MAV_CMD_DO_SET_MODE, 1.0, 15.0, 0.0),
                (MavCmd::MAV_CMD_NAV_TAKEOFF, 0.0, 0.0, 30.0),
            ]
        );
        let e = encode_steps(&TAKEOFF_30, &frame(VehicleKind::Plane, true, "GUIDED"), 7).unwrap();
        assert_eq!(steps(&e).len(), 1);
    }

    #[test]
    fn fixed_wing_enters_takeoff_mode() {
        let e = encode_steps(&TAKEOFF_30, &frame(VehicleKind::Plane, false, "FBWA"), 7).unwrap();
        assert_eq!(steps(&e), vec![(MavCmd::MAV_CMD_DO_SET_MODE, 1.0, 13.0, 0.0)]);
    }

    #[test]
    fn rover_and_other_cannot_take_off() {
        for kind in [VehicleKind::Rover, VehicleKind::Other] {
            assert!(matches!(
                encode_steps(&TAKEOFF_30, &frame(kind, false, "HOLD"), 7),
                Err(EncodeError::NotForKind(_))
            ));
        }
    }

    #[test]
    fn other_commands_are_one_step() {
        let e = encode_steps(
            &VehicleCommand::Rtl,
            &frame(VehicleKind::Copter, false, "AUTO"),
            7,
        )
        .unwrap();
        assert_eq!(steps(&e), vec![(MavCmd::MAV_CMD_DO_SET_MODE, 1.0, 6.0, 0.0)]);
    }
}
