//! GPS ROI (Computed) presets, control parameters and live status.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::camera::ProfileError;

/// Presets per vehicle (`roi_1`..`roi_10`).
pub const ROI_SLOT_COUNT: usize = 10;
const NAME_MAX_CHARS: usize = 64;

/// `"roi_3"` for the 1-based slot index 3.
pub fn roi_slot_id(index_1based: usize) -> String {
    format!("roi_{index_1based}")
}

/// How a camera can point at a ground target.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, rename_all = "snake_case")]
pub enum RoiMode {
    None,
    Computed,
    Native,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct RoiTarget {
    pub id: String,
    pub name: String,
    pub lat: f64,
    pub lon: f64,
    pub alt_msl: f64,
}

fn err(field: &str, message: &str) -> ProfileError {
    ProfileError {
        field: field.into(),
        message: message.into(),
    }
}

fn check_range(field: &str, v: f64, lo: f64, hi: f64) -> Result<(), ProfileError> {
    // `contains` is false for NaN, so NaN is rejected too.
    if (lo..=hi).contains(&v) {
        Ok(())
    } else {
        Err(err(field, &format!("must be between {lo} and {hi}")))
    }
}

impl RoiTarget {
    pub fn empty(index_1based: usize) -> Self {
        Self {
            id: roi_slot_id(index_1based),
            name: String::new(),
            lat: 0.0,
            lon: 0.0,
            alt_msl: 0.0,
        }
    }

    /// A target is "set" when it has a name and is not the (0, 0) placeholder.
    pub fn is_set(&self) -> bool {
        !self.name.trim().is_empty() && !(self.lat == 0.0 && self.lon == 0.0)
    }

    pub fn validate(&self) -> Result<(), ProfileError> {
        if self.name.chars().count() > NAME_MAX_CHARS {
            return Err(err("name", "must be at most 64 characters"));
        }
        check_range("lat", self.lat, -90.0, 90.0)?;
        check_range("lon", self.lon, -180.0, 180.0)?;
        check_range("alt_msl", self.alt_msl, -500.0, 9000.0)
    }
}

pub fn default_roi_targets() -> Vec<RoiTarget> {
    (1..=ROI_SLOT_COUNT).map(RoiTarget::empty).collect()
}

/// Exactly 10 targets, ids `roi_1`..`roi_10` in order, each valid.
pub fn validate_roi_targets(t: &[RoiTarget]) -> Result<(), ProfileError> {
    if t.len() != ROI_SLOT_COUNT {
        return Err(err("targets", "must contain exactly 10 items"));
    }
    for (i, target) in t.iter().enumerate() {
        if target.id != roi_slot_id(i + 1) {
            return Err(err(&format!("targets[{i}].id"), "must be roi_1..roi_10 in order"));
        }
        target
            .validate()
            .map_err(|e| err(&format!("targets[{i}].{}", e.field), &e.message))?;
    }
    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, rename_all = "snake_case")]
pub enum RoiControlMode {
    Rate,
    Angle,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct RoiControl {
    pub control_mode: RoiControlMode,
    pub rate_hz: f64,
    pub target_rate_hz: f64,
    pub smoothing_tau_s: f64,
    pub deadband_deg: f64,
    pub pid_kp: f64,
    pub pid_ki: f64,
    pub pid_kd: f64,
    pub max_speed: f64,
    pub yaw_offset_deg: f64,
}

impl Default for RoiControl {
    fn default() -> Self {
        Self {
            control_mode: RoiControlMode::Rate,
            rate_hz: 10.0,
            target_rate_hz: 2.0,
            smoothing_tau_s: 0.8,
            deadband_deg: 0.3,
            pid_kp: 2.0,
            pid_ki: 0.2,
            pid_kd: 0.0,
            max_speed: 60.0,
            yaw_offset_deg: 0.0,
        }
    }
}

impl RoiControl {
    /// Lowest control rate (2026-10-23): in rate mode a 0x07 speed is held for a whole
    /// period, so a slower loop would let the gimbal coast at up to `max_speed`.
    pub const RATE_HZ_MIN: f64 = 1.0;
    pub const RATE_HZ_MAX: f64 = 50.0;

    pub fn validate(&self) -> Result<(), ProfileError> {
        check_range("rate_hz", self.rate_hz, Self::RATE_HZ_MIN, Self::RATE_HZ_MAX)?;
        check_range("target_rate_hz", self.target_rate_hz, 0.2, 10.0)?;
        check_range("smoothing_tau_s", self.smoothing_tau_s, 0.0, 10.0)?;
        check_range("deadband_deg", self.deadband_deg, 0.0, 5.0)?;
        check_range("pid_kp", self.pid_kp, 0.0, 50.0)?;
        check_range("pid_ki", self.pid_ki, 0.0, 20.0)?;
        check_range("pid_kd", self.pid_kd, 0.0, 10.0)?;
        check_range("max_speed", self.max_speed, 1.0, 100.0)?;
        check_range("yaw_offset_deg", self.yaw_offset_deg, -180.0, 180.0)
    }

    /// Lifts a stored `rate_hz` below the floor (rows saved before 2026-10-23 allowed
    /// 0 < x) to [`Self::RATE_HZ_MIN`]; anything else is returned unchanged.
    pub fn clamp_rate(self) -> Self {
        if self.rate_hz < Self::RATE_HZ_MIN {
            return Self {
                rate_hz: Self::RATE_HZ_MIN,
                ..self
            };
        }
        self
    }
}

/// Live state of the ROI loop; only travels in the WS `roi_status` frame.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct RoiStatus {
    pub active_target: Option<String>,
    pub mode: Option<RoiControlMode>,
    pub bearing_deg: Option<f64>,
    pub elevation_deg: Option<f64>,
    pub distance_m: Option<f64>,
    pub yaw_cmd_deg: Option<f64>,
    pub pitch_cmd_deg: Option<f64>,
    pub gimbal_yaw_deg: Option<f64>,
    pub gimbal_pitch_deg: Option<f64>,
    pub speed_yaw: Option<i8>,
    pub speed_pitch: Option<i8>,
    pub error: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::camera::{ButtonFunction, CameraCaps};
    use crate::ws::ServerMessage;

    #[test]
    fn defaults_match_spec() {
        let c = RoiControl::default();
        assert_eq!(c.control_mode, RoiControlMode::Rate);
        assert_eq!(
            (c.rate_hz, c.target_rate_hz, c.smoothing_tau_s, c.deadband_deg),
            (10.0, 2.0, 0.8, 0.3)
        );
        assert_eq!((c.pid_kp, c.pid_ki, c.pid_kd), (2.0, 0.2, 0.0));
        assert_eq!((c.max_speed, c.yaw_offset_deg), (60.0, 0.0));
        assert!(c.validate().is_ok());
    }

    fn with(field: &str, v: f64) -> RoiControl {
        let c = RoiControl::default();
        match field {
            "rate_hz" => RoiControl { rate_hz: v, ..c },
            "target_rate_hz" => RoiControl {
                target_rate_hz: v,
                ..c
            },
            "smoothing_tau_s" => RoiControl {
                smoothing_tau_s: v,
                ..c
            },
            "deadband_deg" => RoiControl { deadband_deg: v, ..c },
            "pid_kp" => RoiControl { pid_kp: v, ..c },
            "pid_ki" => RoiControl { pid_ki: v, ..c },
            "pid_kd" => RoiControl { pid_kd: v, ..c },
            "max_speed" => RoiControl { max_speed: v, ..c },
            "yaw_offset_deg" => RoiControl {
                yaw_offset_deg: v,
                ..c
            },
            _ => unreachable!(),
        }
    }

    #[test]
    fn stored_rate_below_floor_is_clamped() {
        let low = RoiControl {
            rate_hz: 0.05,
            ..RoiControl::default()
        };
        assert_eq!(low.clamp_rate().rate_hz, RoiControl::RATE_HZ_MIN);
        let ok = RoiControl {
            rate_hz: 20.0,
            ..RoiControl::default()
        };
        assert_eq!(ok.clone().clamp_rate(), ok);
    }

    #[test]
    fn control_validation_bounds() {
        let bad: &[(&str, &[f64])] = &[
            ("rate_hz", &[0.0, 0.05, 0.99, 50.1]),
            ("target_rate_hz", &[0.1, 10.1]),
            ("smoothing_tau_s", &[-0.1, 10.1]),
            ("deadband_deg", &[5.1]),
            ("pid_kp", &[50.1]),
            ("pid_ki", &[20.1]),
            ("pid_kd", &[10.1]),
            ("max_speed", &[0.5, 100.1]),
            ("yaw_offset_deg", &[180.1, -180.1]),
        ];
        for (field, values) in bad {
            for v in *values {
                let e = with(field, *v).validate().unwrap_err();
                assert_eq!(e.field, *field, "value {v}");
            }
            let e = with(field, f64::NAN).validate().unwrap_err();
            assert_eq!(e.field, *field, "NaN");
        }
        for (field, v) in [
            ("rate_hz", 1.0),
            ("rate_hz", 50.0),
            ("max_speed", 1.0),
            ("max_speed", 100.0),
            ("yaw_offset_deg", 180.0),
            ("yaw_offset_deg", -180.0),
        ] {
            assert!(with(field, v).validate().is_ok(), "{field}={v}");
        }
    }

    fn target(f: impl FnOnce(&mut RoiTarget)) -> RoiTarget {
        let mut t = RoiTarget::empty(1);
        f(&mut t);
        t
    }

    #[test]
    fn target_validation() {
        let cases = [
            (target(|t| t.lat = 90.1), "lat"),
            (target(|t| t.lon = -180.1), "lon"),
            (target(|t| t.alt_msl = -500.1), "alt_msl"),
            (target(|t| t.alt_msl = 9000.1), "alt_msl"),
            (target(|t| t.name = "x".repeat(65)), "name"),
        ];
        for (t, field) in cases {
            assert_eq!(t.validate().unwrap_err().field, field);
        }
        assert!(target(|t| t.name = "x".repeat(64)).validate().is_ok());
    }

    #[test]
    fn targets_must_be_ten_in_order() {
        assert!(validate_roi_targets(&default_roi_targets()).is_ok());
        let nine = default_roi_targets()[..9].to_vec();
        assert!(validate_roi_targets(&nine).is_err());
        let mut swapped = default_roi_targets();
        swapped.swap(0, 1);
        assert!(validate_roi_targets(&swapped).is_err());
        let mut dup = default_roi_targets();
        dup[2].id = "roi_1".into();
        assert!(validate_roi_targets(&dup).is_err());
        let mut bad = default_roi_targets();
        bad[3].lat = 91.0;
        assert_eq!(validate_roi_targets(&bad).unwrap_err().field, "targets[3].lat");
    }

    #[test]
    fn is_set_rules() {
        assert!(!RoiTarget::empty(1).is_set());
        assert!(!target(|t| t.name = "A".into()).is_set());
        assert!(target(|t| {
            t.name = " A ".into();
            t.lat = 35.0;
            t.lon = 139.0;
        })
        .is_set());
        assert!(!target(|t| {
            t.name = "  ".into();
            t.lat = 35.0;
            t.lon = 139.0;
        })
        .is_set());
    }

    #[test]
    fn button_functions_serialize() {
        for (f, s) in [
            (ButtonFunction::Roi1, "roi_1"),
            (ButtonFunction::Roi10, "roi_10"),
            (ButtonFunction::RoiStop, "roi_stop"),
        ] {
            let v = serde_json::to_value(f).unwrap();
            assert_eq!(v, serde_json::json!(s));
            assert_eq!(serde_json::from_value::<ButtonFunction>(v).unwrap(), f);
        }
    }

    #[test]
    fn mt11_caps_roi_computed() {
        assert_eq!(CameraCaps::siyi_mt11().roi, RoiMode::Computed);
        assert_eq!(CameraCaps::none().roi, RoiMode::None);
    }

    #[test]
    fn roi_status_frame_shape() {
        let m = ServerMessage::RoiStatus {
            sysid: 1,
            status: RoiStatus::default(),
        };
        let v = serde_json::to_value(m).unwrap();
        assert_eq!(v["t"], "roi_status");
        assert_eq!(v["sysid"], 1);
        assert!(v["status"]["active_target"].is_null());
    }
}
