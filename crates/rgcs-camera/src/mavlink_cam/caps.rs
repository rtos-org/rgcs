//! Bound camera / gimbal manager → `CameraCaps` (the `mavlink` camera kind).

use rgcs_core::{CameraCaps, CameraKind, GimbalCaps, RoiMode, VideoMode, ZoomCaps, ZoomUnit};

use crate::mavlink_cam::binding::{CameraBinding, GimbalBinding};

const CAP_CAPTURE_VIDEO: u32 = 1;
const CAP_CAPTURE_IMAGE: u32 = 2;
const CAP_BASIC_ZOOM: u32 = 64;
const CAP_BASIC_FOCUS: u32 = 128;
const GIMBAL_HAS_NEUTRAL: u32 = 2;
const GIMBAL_HAS_YAW_AXIS: u32 = 256;
const GIMBAL_PITCH_OR_YAW_AXIS: u32 = 32 | GIMBAL_HAS_YAW_AXIS;
const GIMBAL_POINT_LOCATION_GLOBAL: u32 = 131_072;
/// Native ROI needs a yaw axis: firmware that ignores the gimbal-id selector (Copter ≤ 4.6)
/// yaws the whole vehicle at the target when the mount has no pan.
const GIMBAL_NATIVE_ROI: u32 = GIMBAL_POINT_LOCATION_GLOBAL | GIMBAL_HAS_YAW_AXIS;

/// MAVLink zoom is a percentage of the lens range.
pub const PERCENT_ZOOM: ZoomCaps = ZoomCaps {
    max: 100.0,
    absolute: true,
    step: true,
    continuous: true,
    unit: ZoomUnit::Percent,
};

pub fn mavlink_caps(cam: Option<&CameraBinding>, gimbal: Option<&GimbalBinding>) -> CameraCaps {
    let flags = cam.map_or(0, |c| c.flags);
    let has = |bit: u32| flags & bit != 0;
    CameraCaps {
        kind: CameraKind::Mavlink,
        gimbal: gimbal.map(gimbal_caps),
        zoom: has(CAP_BASIC_ZOOM).then_some(PERCENT_ZOOM),
        focus: has(CAP_BASIC_FOCUS),
        photo: has(CAP_CAPTURE_IMAGE),
        record: has(CAP_CAPTURE_VIDEO),
        video_modes: vec![VideoMode::Rgb],
        hfov_deg: cam.and_then(|c| c.hfov_deg),
        roi: match gimbal {
            Some(g) if g.cap_flags & GIMBAL_NATIVE_ROI == GIMBAL_NATIVE_ROI => RoiMode::Native,
            _ => RoiMode::None,
        },
        ..CameraCaps::none()
    }
}

fn gimbal_caps(g: &GimbalBinding) -> GimbalCaps {
    let moves = g.cap_flags & GIMBAL_PITCH_OR_YAW_AXIS != 0;
    GimbalCaps {
        rate: moves,
        angle: moves,
        center: g.cap_flags & GIMBAL_HAS_NEUTRAL != 0,
        modes: Vec::new(),
        attitude: true,
        pitch_range: g.pitch_range,
    }
}

/// Horizontal field of view from `CAMERA_INFORMATION` (mm); `None` unless both are finite and
/// positive (ArduPilot sends NaN, so the UI falls back to its default).
pub fn hfov_deg(focal_length: f32, sensor_size_h: f32) -> Option<f32> {
    let valid = |v: f32| v.is_finite() && v > 0.0;
    (valid(focal_length) && valid(sensor_size_h))
        .then(|| (2.0 * (sensor_size_h / (2.0 * focal_length)).atan()).to_degrees())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mavlink_cam::binding::tests::{cam_info, header, manager_info};
    use crate::mavlink_cam::binding::{bind_camera, bind_gimbal};
    use mavlink::dialects::ardupilotmega::CAMERA_INFORMATION_DATA;
    use rgcs_core::{CameraKind, GimbalCaps, RoiMode, VideoMode, ZoomCaps, ZoomUnit};

    fn bound(flags: u32, cap: Option<u32>) -> (CameraBinding, Option<GimbalBinding>) {
        let cam = bind_camera(None, &header(1), &cam_info(1, flags, 1), 100).expect("camera");
        let gimbal = cap.and_then(|c| bind_gimbal(None, Some(&cam), &header(1), &manager_info(1, c)));
        (cam, gimbal)
    }

    #[test]
    fn full_ardupilot_caps() {
        let (cam, gimbal) = bound(0xC3, Some(32 | 256 | 2 | 131072));
        let caps = mavlink_caps(Some(&cam), gimbal.as_ref());
        assert_eq!(caps.kind, CameraKind::Mavlink);
        assert!(caps.photo && caps.record && caps.focus);
        assert_eq!(
            caps.zoom,
            Some(ZoomCaps {
                max: 100.0,
                absolute: true,
                step: true,
                continuous: true,
                unit: ZoomUnit::Percent,
            })
        );
        let g: GimbalCaps = caps.gimbal.clone().expect("gimbal");
        assert!(g.rate && g.angle && g.center && g.attitude);
        assert!(g.modes.is_empty());
        assert!((g.pitch_range.0 + 90.0).abs() < 0.01 && (g.pitch_range.1 - 30.0).abs() < 0.01);
        assert_eq!(caps.roi, RoiMode::Native);
        assert_eq!(caps.video_modes, vec![VideoMode::Rgb]);
        assert_eq!(caps.thermal, None);
        assert_eq!(caps.ai_tracking, None);
        assert!(caps.encoding_presets.is_empty());
        assert!(!caps.storage_info && !caps.clock_sync);
    }

    #[test]
    fn photo_only_servo_camera() {
        let (cam, _) = bound(0x02, None);
        let caps = mavlink_caps(Some(&cam), None);
        assert!(caps.photo);
        assert!(!caps.record && !caps.focus);
        assert_eq!(caps.zoom, None);
        assert_eq!(caps.gimbal, None);
        assert_eq!(caps.roi, RoiMode::None);
    }

    #[test]
    fn no_point_location_no_roi() {
        let (cam, gimbal) = bound(0xC3, Some(32 | 256));
        let caps = mavlink_caps(Some(&cam), gimbal.as_ref());
        assert_eq!(caps.roi, RoiMode::None);
        assert!(!caps.gimbal.expect("gimbal").center);
    }

    /// On Copter ≤ 4.6 a pitch-only mount turns ROI into vehicle yaw.
    #[test]
    fn pitch_only_manager_has_no_native_roi() {
        let (cam, gimbal) = bound(0xC3, Some(32 | 2 | 131072));
        let caps = mavlink_caps(Some(&cam), gimbal.as_ref());
        assert_eq!(caps.roi, RoiMode::None);
        assert!(caps.gimbal.expect("gimbal").rate, "the pitch axis still moves");
    }

    #[test]
    fn nothing_bound_is_an_empty_mavlink_camera() {
        let caps = mavlink_caps(None, None);
        assert_eq!(caps.kind, CameraKind::Mavlink);
        assert!(!caps.photo && !caps.record && caps.gimbal.is_none() && caps.zoom.is_none());
        assert_eq!(caps.video_modes, vec![VideoMode::Rgb]);
    }

    #[test]
    fn hfov_from_sensor() {
        let hfov = hfov_deg(4.5, 6.17).expect("hfov");
        assert!((hfov - 68.87).abs() < 0.01, "{hfov}");
        assert_eq!(hfov_deg(f32::NAN, 6.17), None);
        assert_eq!(hfov_deg(4.5, f32::NAN), None);
        assert_eq!(hfov_deg(0.0, 6.17), None);
        let info = CAMERA_INFORMATION_DATA {
            focal_length: 4.5,
            sensor_size_h: 6.17,
            ..cam_info(1, 0x03, 0)
        };
        let cam = bind_camera(None, &header(1), &info, 100).expect("camera");
        let caps = mavlink_caps(Some(&cam), None);
        assert!((caps.hfov_deg.expect("hfov") - 68.87).abs() < 0.01);
    }
}
