//! Vehicle commands accepted by `POST /api/vehicles/{sysid}/command` and their results.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::vehicle::SysId;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "cmd", content = "args", rename_all = "snake_case")]
#[ts(export, rename_all = "snake_case")]
pub enum VehicleCommand {
    Pause,
    Resume,
    Rtl,
    Land,
    ChangeAlt {
        alt_rel: f32,
    },
    ChangeSpeed {
        mps: f32,
    },
    SetMode {
        mode: String,
    },
    MissionStart,
    MissionResume,
    /// Leave the ground: Copter / QuadPlane climb to `alt_rel` (GUIDED + NAV_TAKEOFF); a plain
    /// fixed wing switches to TAKEOFF mode and climbs to its TKOFF_ALT (`alt_rel` unused).
    Takeoff {
        alt_rel: f32,
    },
    Arm,
    Disarm,
    /// Any other MAV_CMD, sent as COMMAND_LONG.
    Other {
        mav_cmd: u16,
        params: [f32; 7],
    },
}

impl VehicleCommand {
    /// Commands that need a confirm token. Mode change, RTL and land do not.
    pub fn requires_confirm(&self) -> bool {
        matches!(
            self,
            Self::Arm | Self::Disarm | Self::MissionStart | Self::Takeoff { .. }
        )
    }

    /// Why the arguments are out of range (HTTP 400), if they are.
    pub fn invalid(&self) -> Option<String> {
        match self {
            Self::Takeoff { alt_rel } if !(alt_rel.is_finite() && (1.0..=1000.0).contains(alt_rel)) => {
                Some("takeoff altitude must be 1 to 1000 m".into())
            }
            _ => None,
        }
    }

    /// Stable name used in the audit log and in `CommandResult.cmd`.
    pub fn name(&self) -> &'static str {
        match self {
            Self::Pause => "pause",
            Self::Resume => "resume",
            Self::Rtl => "rtl",
            Self::Land => "land",
            Self::ChangeAlt { .. } => "change_alt",
            Self::ChangeSpeed { .. } => "change_speed",
            Self::SetMode { .. } => "set_mode",
            Self::MissionStart => "mission_start",
            Self::MissionResume => "mission_resume",
            Self::Takeoff { .. } => "takeoff",
            Self::Arm => "arm",
            Self::Disarm => "disarm",
            Self::Other { .. } => "other",
        }
    }

    /// The MAV_CMD of an `other` command (it tells e.g. 224 go-to-WP from 511 message rate apart).
    pub fn mav_cmd(&self) -> Option<u16> {
        match self {
            Self::Other { mav_cmd, .. } => Some(*mav_cmd),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CommandResult {
    #[ts(type = "number")]
    pub id: u64,
    pub sysid: SysId,
    pub cmd: String,
    pub ok: bool,
    pub reason: Option<String>,
    /// Unix time in milliseconds.
    #[ts(type = "number")]
    pub ts: u64,
    /// The MAV_CMD of an `other` command; absent for every named command.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub mav_cmd: Option<u16>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dangerous_commands_require_confirmation() {
        assert!(VehicleCommand::Arm.requires_confirm());
        assert!(VehicleCommand::Disarm.requires_confirm());
        assert!(VehicleCommand::MissionStart.requires_confirm());
        assert!(!VehicleCommand::SetMode { mode: "AUTO".into() }.requires_confirm());
        assert!(!VehicleCommand::Rtl.requires_confirm());
        assert!(!VehicleCommand::Land.requires_confirm());
        assert!(!VehicleCommand::Pause.requires_confirm());
        assert!(!VehicleCommand::ChangeAlt { alt_rel: 50.0 }.requires_confirm());
    }

    #[test]
    fn takeoff_needs_confirmation_and_carries_its_altitude() {
        let t: VehicleCommand = serde_json::from_str(r#"{"cmd":"takeoff","args":{"alt_rel":30}}"#).unwrap();
        assert_eq!(t, VehicleCommand::Takeoff { alt_rel: 30.0 });
        assert!(t.requires_confirm());
        assert_eq!(t.name(), "takeoff");
        assert_eq!(t.mav_cmd(), None);
    }

    #[test]
    fn takeoff_altitude_must_be_1_to_1000_m() {
        assert_eq!(VehicleCommand::Takeoff { alt_rel: 1.0 }.invalid(), None);
        assert_eq!(VehicleCommand::Takeoff { alt_rel: 1000.0 }.invalid(), None);
        for bad in [0.5, 1000.5, -10.0, f32::NAN, f32::INFINITY] {
            assert!(
                VehicleCommand::Takeoff { alt_rel: bad }.invalid().is_some(),
                "{bad}"
            );
        }
        assert_eq!(VehicleCommand::Arm.invalid(), None);
    }

    #[test]
    fn other_commands_carry_their_mav_cmd() {
        let goto = VehicleCommand::Other {
            mav_cmd: 224,
            params: [3.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
        };
        assert_eq!(goto.mav_cmd(), Some(224));
        assert_eq!(VehicleCommand::Arm.mav_cmd(), None);
    }

    #[test]
    fn result_mav_cmd_is_optional_on_the_wire() {
        let r = CommandResult {
            id: 1,
            sysid: 1,
            cmd: "arm".into(),
            ok: true,
            reason: None,
            ts: 5,
            mav_cmd: None,
        };
        let json = serde_json::to_value(&r).unwrap();
        assert!(json.get("mav_cmd").is_none(), "{json}");
        let back: CommandResult = serde_json::from_str(
            r#"{"id":2,"sysid":1,"cmd":"other","ok":false,"reason":null,"ts":5,"mav_cmd":511}"#,
        )
        .unwrap();
        assert_eq!(back.mav_cmd, Some(511));
        let old: CommandResult =
            serde_json::from_str(r#"{"id":2,"sysid":1,"cmd":"arm","ok":true,"reason":null,"ts":5}"#).unwrap();
        assert_eq!(old.mav_cmd, None);
    }

    #[test]
    fn json_shape_matches_the_api() {
        let v: VehicleCommand =
            serde_json::from_str(r#"{"cmd":"change_alt","args":{"alt_rel":80}}"#).unwrap();
        assert_eq!(v, VehicleCommand::ChangeAlt { alt_rel: 80.0 });
        let a: VehicleCommand = serde_json::from_str(r#"{"cmd":"arm"}"#).unwrap();
        assert_eq!(a, VehicleCommand::Arm);
        assert_eq!(a.name(), "arm");
    }
}
