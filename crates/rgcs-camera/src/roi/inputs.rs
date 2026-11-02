//! Pure helpers turning the router's `VehicleState` and the camera's `CameraState` into
//! ROI controller inputs.

use rgcs_core::{CameraState, VehicleState};

pub use crate::roi::controller::{AttitudeSample, VehicleFix};

/// The vehicle position for the controller; `None` before the first GLOBAL_POSITION_INT
/// (`position_age_ms` is `None`) or while the position is the (0, 0) placeholder.
pub fn vehicle_fix(v: &VehicleState, position_age_ms: Option<u64>) -> Option<VehicleFix> {
    let age_ms = position_age_ms?;
    if v.lat == 0.0 && v.lon == 0.0 {
        return None;
    }
    Some(VehicleFix {
        lat: v.lat,
        lon: v.lon,
        alt_msl: f64::from(v.alt_msl),
        hdg: v.hdg.map(f64::from),
        age_ms,
    })
}

/// Monotonic ms at which the attitude in `state` was measured, given the time this change was seen.
pub fn attitude_stamp(state: &CameraState, seen_ms: u64) -> Option<u64> {
    state.gimbal.as_ref().map(|g| seen_ms.saturating_sub(g.age_ms))
}

/// The attitude in `state` aged against `now_ms`; `None` without a gimbal or a stamp.
pub fn attitude_sample(state: &CameraState, stamp_ms: Option<u64>, now_ms: u64) -> Option<AttitudeSample> {
    let g = state.gimbal.as_ref()?;
    let stamp = stamp_ms?;
    Some(AttitudeSample {
        yaw: f64::from(g.yaw),
        pitch: f64::from(g.pitch),
        age_ms: now_ms.saturating_sub(stamp),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use rgcs_core::{CameraState, GimbalAttitude, VehicleState};

    fn vehicle(lat: f64, lon: f64, hdg: Option<f32>) -> VehicleState {
        VehicleState {
            lat,
            lon,
            alt_msl: 120.5,
            hdg,
            ..VehicleState::new(1, "UAV-01")
        }
    }

    fn camera(gimbal: Option<GimbalAttitude>) -> CameraState {
        CameraState {
            connected: true,
            gimbal,
            ..CameraState::disconnected(30.0)
        }
    }

    fn attitude(age_ms: u64) -> GimbalAttitude {
        GimbalAttitude {
            yaw: 12.5,
            pitch: -40.0,
            roll: 0.0,
            age_ms,
        }
    }

    #[test]
    fn fix_none_without_position_or_at_null_island() {
        assert_eq!(vehicle_fix(&vehicle(35.6, 139.7, Some(90.0)), None), None);
        assert_eq!(vehicle_fix(&vehicle(0.0, 0.0, Some(90.0)), Some(100)), None);
        assert!(vehicle_fix(&vehicle(0.0, 139.7, Some(90.0)), Some(100)).is_some());
    }

    #[test]
    fn fix_maps_heading() {
        let fix = vehicle_fix(&vehicle(35.6, 139.7, Some(90.0)), Some(250)).unwrap();
        assert_eq!(
            fix,
            VehicleFix {
                lat: 35.6,
                lon: 139.7,
                alt_msl: 120.5,
                hdg: Some(90.0),
                age_ms: 250,
            }
        );
        let unknown = vehicle_fix(&vehicle(35.6, 139.7, None), Some(250)).unwrap();
        assert_eq!(unknown.hdg, None);
    }

    #[test]
    fn attitude_stamp_subtracts_age() {
        assert_eq!(attitude_stamp(&camera(Some(attitude(50))), 1_000), Some(950));
        assert_eq!(attitude_stamp(&camera(Some(attitude(5_000))), 1_000), Some(0));
    }

    #[test]
    fn attitude_sample_age_grows_without_changes() {
        let s = attitude_sample(&camera(Some(attitude(50))), Some(950), 1_600).unwrap();
        assert_eq!(
            s,
            AttitudeSample {
                yaw: 12.5,
                pitch: -40.0,
                age_ms: 650,
            }
        );
        assert_eq!(attitude_sample(&camera(Some(attitude(50))), None, 1_600), None);
    }

    #[test]
    fn no_attitude_when_gimbal_none() {
        assert_eq!(attitude_stamp(&camera(None), 1_000), None);
        assert_eq!(attitude_sample(&camera(None), Some(950), 1_600), None);
    }
}
