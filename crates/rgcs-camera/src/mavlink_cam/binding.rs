//! Which camera and gimbal manager are "ours": a native MAVLink camera at the
//! profile's component id beats a camera attached to the autopilot (device 1); the gimbal
//! manager follows the camera's `gimbal_device_id`, else the first one seen.

use mavlink::dialects::ardupilotmega::{
    CAMERA_INFORMATION_DATA, GIMBAL_DEVICE_ATTITUDE_STATUS_DATA, GIMBAL_MANAGER_INFORMATION_DATA,
};
use mavlink::MavHeader;

use crate::mavlink_cam::caps::hfov_deg;

/// `camera_device_id` of the first camera attached to an ArduPilot autopilot.
pub const AUTOPILOT_CAMERA_DEVICE: u8 = 1;
/// `camera_device_id` of a MAVLink camera with its own component id.
const NATIVE_CAMERA_DEVICE: u8 = 0;
/// Used when a manager reports a non-finite pitch limit (the MT11 range).
const FALLBACK_PITCH_RANGE: (f32, f32) = (-90.0, 30.0);

#[derive(Debug, Clone, PartialEq)]
pub struct CameraBinding {
    pub compid: u8,
    pub device_id: u8,
    /// `CAMERA_CAP_FLAGS` bits.
    pub flags: u32,
    pub gimbal_device_id: u8,
    pub firmware: Option<String>,
    pub hfov_deg: Option<f32>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct GimbalBinding {
    pub manager_compid: u8,
    pub device_id: u8,
    /// `GIMBAL_MANAGER_CAP_FLAGS` bits.
    pub cap_flags: u32,
    /// Degrees, (min, max).
    pub pitch_range: (f32, f32),
}

/// The camera binding after `info` arrived: `current` (kept), a refreshed `current`, or a new
/// binding. `None` only while nothing qualifies.
pub fn bind_camera(
    current: Option<&CameraBinding>,
    header: &MavHeader,
    info: &CAMERA_INFORMATION_DATA,
    profile_comp_id: u8,
) -> Option<CameraBinding> {
    let candidate = camera_binding(header, info);
    let native = candidate.device_id == NATIVE_CAMERA_DEVICE && candidate.compid == profile_comp_id;
    let take = match current {
        _ if native => true,
        None => candidate.device_id == AUTOPILOT_CAMERA_DEVICE,
        Some(cur) => cur.compid == candidate.compid && cur.device_id == candidate.device_id,
    };
    if take {
        Some(candidate)
    } else {
        current.cloned()
    }
}

fn camera_binding(header: &MavHeader, info: &CAMERA_INFORMATION_DATA) -> CameraBinding {
    CameraBinding {
        compid: header.component_id,
        device_id: info.camera_device_id,
        flags: info.flags.bits(),
        gimbal_device_id: info.gimbal_device_id,
        firmware: firmware_text(info.firmware_version),
        hfov_deg: hfov_deg(info.focal_length, info.sensor_size_h),
    }
}

/// The gimbal binding after `info` arrived (same contract as [`bind_camera`]).
pub fn bind_gimbal(
    current: Option<&GimbalBinding>,
    camera: Option<&CameraBinding>,
    header: &MavHeader,
    info: &GIMBAL_MANAGER_INFORMATION_DATA,
) -> Option<GimbalBinding> {
    let candidate = gimbal_binding(header, info);
    let wanted = camera.map(|c| c.gimbal_device_id).filter(|&id| id != 0);
    let take = match (wanted, current) {
        (Some(id), _) => candidate.device_id == id,
        (None, None) => true,
        (None, Some(cur)) => {
            cur.manager_compid == candidate.manager_compid && cur.device_id == candidate.device_id
        }
    };
    if take {
        Some(candidate)
    } else {
        current.cloned()
    }
}

fn gimbal_binding(header: &MavHeader, info: &GIMBAL_MANAGER_INFORMATION_DATA) -> GimbalBinding {
    let (lo, hi) = (info.pitch_min.to_degrees(), info.pitch_max.to_degrees());
    let pitch_range = if lo.is_finite() && hi.is_finite() && lo < hi {
        (lo, hi)
    } else {
        FALLBACK_PITCH_RANGE
    };
    GimbalBinding {
        manager_compid: header.component_id,
        device_id: info.gimbal_device_id,
        cap_flags: info.cap_flags.bits(),
        pitch_range,
    }
}

/// Whether an attitude status belongs to the bound gimbal: by its device id, or (device id 0,
/// a MAVLink gimbal device) by the sender's component id.
pub fn attitude_matches(
    g: &GimbalBinding,
    header: &MavHeader,
    status: &GIMBAL_DEVICE_ATTITUDE_STATUS_DATA,
) -> bool {
    match status.gimbal_device_id {
        0 => header.component_id == g.device_id,
        id => id == g.device_id,
    }
}

/// `firmware_version` bytes 0.1.2 → "major.minor.patch"; 0 = unknown.
pub fn firmware_text(v: u32) -> Option<String> {
    (v != 0).then(|| format!("{}.{}.{}", v & 0xFF, (v >> 8) & 0xFF, (v >> 16) & 0xFF))
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use mavlink::dialects::ardupilotmega::{
        CameraCapFlags, GimbalManagerCapFlags, CAMERA_INFORMATION_DATA, GIMBAL_DEVICE_ATTITUDE_STATUS_DATA,
        GIMBAL_MANAGER_INFORMATION_DATA,
    };
    use mavlink::MavHeader;
    use std::f32::consts::{FRAC_PI_2, FRAC_PI_6};

    pub(crate) fn header(compid: u8) -> MavHeader {
        MavHeader {
            system_id: 1,
            component_id: compid,
            sequence: 0,
        }
    }

    pub(crate) fn cam_info(device: u8, flags: u32, gimbal: u8) -> CAMERA_INFORMATION_DATA {
        CAMERA_INFORMATION_DATA {
            camera_device_id: device,
            flags: CameraCapFlags::from_bits_truncate(flags),
            gimbal_device_id: gimbal,
            firmware_version: 0x030201,
            focal_length: f32::NAN,
            sensor_size_h: f32::NAN,
            ..CAMERA_INFORMATION_DATA::DEFAULT
        }
    }

    pub(crate) fn manager_info(device: u8, cap: u32) -> GIMBAL_MANAGER_INFORMATION_DATA {
        GIMBAL_MANAGER_INFORMATION_DATA {
            gimbal_device_id: device,
            cap_flags: GimbalManagerCapFlags::from_bits_truncate(cap),
            pitch_min: -FRAC_PI_2,
            pitch_max: FRAC_PI_6,
            ..GIMBAL_MANAGER_INFORMATION_DATA::DEFAULT
        }
    }

    fn autopilot_camera() -> CameraBinding {
        bind_camera(None, &header(1), &cam_info(1, 0xC3, 1), 100).expect("binds")
    }

    #[test]
    fn ardupilot_camera_binds_device_1() {
        let b = autopilot_camera();
        assert_eq!(b.compid, 1);
        assert_eq!(b.device_id, 1);
        assert_eq!(b.flags, 0xC3);
        assert_eq!(b.gimbal_device_id, 1);
        assert_eq!(b.firmware.as_deref(), Some("1.2.3"));
        assert_eq!(b.hfov_deg, None);
    }

    #[test]
    fn native_camera_needs_profile_comp_id() {
        let native = cam_info(0, 0x03, 0);
        let bound = bind_camera(None, &header(100), &native, 100).expect("binds");
        assert_eq!((bound.compid, bound.device_id), (100, 0));
        assert_eq!(bind_camera(None, &header(100), &native, 101), None);
    }

    #[test]
    fn native_beats_autopilot() {
        let current = autopilot_camera();
        let native = bind_camera(Some(&current), &header(100), &cam_info(0, 0x03, 0), 100).expect("binds");
        assert_eq!((native.compid, native.device_id), (100, 0));
        let kept = bind_camera(Some(&current), &header(1), &cam_info(2, 0x03, 0), 100);
        assert_eq!(kept, Some(current.clone()));
        let kept = bind_camera(Some(&native), &header(1), &cam_info(1, 0xC3, 1), 100);
        assert_eq!(kept, Some(native));
    }

    #[test]
    fn firmware_zero_is_none() {
        assert_eq!(firmware_text(0), None);
        assert_eq!(firmware_text(0x030201).as_deref(), Some("1.2.3"));
    }

    #[test]
    fn gimbal_follows_camera_gimbal_id() {
        let cam = autopilot_camera();
        let first = bind_gimbal(None, Some(&cam), &header(1), &manager_info(2, 32 | 256));
        assert_eq!(first, None);
        let g =
            bind_gimbal(first.as_ref(), Some(&cam), &header(1), &manager_info(1, 32 | 256)).expect("binds");
        assert_eq!((g.manager_compid, g.device_id), (1, 1));
        assert!((g.pitch_range.0 + 90.0).abs() < 0.01, "{:?}", g.pitch_range);
        assert!((g.pitch_range.1 - 30.0).abs() < 0.01, "{:?}", g.pitch_range);
        let kept = bind_gimbal(Some(&g), Some(&cam), &header(1), &manager_info(2, 32 | 256));
        assert_eq!(kept, Some(g));
    }

    #[test]
    fn gimbal_without_camera_takes_first_manager() {
        let g = bind_gimbal(None, None, &header(1), &manager_info(2, 32)).expect("binds");
        assert_eq!(g.device_id, 2);
        let kept = bind_gimbal(Some(&g), None, &header(1), &manager_info(3, 32));
        assert_eq!(kept, Some(g));
    }

    #[test]
    fn attitude_matches_device_or_sender() {
        let g = GimbalBinding {
            manager_compid: 1,
            device_id: 1,
            cap_flags: 0,
            pitch_range: (-90.0, 30.0),
        };
        let status = |device: u8| GIMBAL_DEVICE_ATTITUDE_STATUS_DATA {
            gimbal_device_id: device,
            ..GIMBAL_DEVICE_ATTITUDE_STATUS_DATA::DEFAULT
        };
        assert!(attitude_matches(&g, &header(1), &status(1)));
        let device_154 = GimbalBinding {
            device_id: 154,
            ..g.clone()
        };
        assert!(attitude_matches(&device_154, &header(154), &status(0)));
        assert!(!attitude_matches(&device_154, &header(1), &status(0)));
        assert!(!attitude_matches(&g, &header(1), &status(2)));
    }
}
