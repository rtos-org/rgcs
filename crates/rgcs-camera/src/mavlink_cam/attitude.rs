//! Gimbal quaternion → SIYI-convention angles (yaw +left, body frame).

use mavlink::dialects::ardupilotmega::{GimbalDeviceFlags, GIMBAL_DEVICE_ATTITUDE_STATUS_DATA};

/// (roll, pitch, yaw) in degrees, ZYX, from q = [w, x, y, z]; yaw is MAVLink's +right.
pub fn quat_to_euler_deg(q: [f32; 4]) -> (f32, f32, f32) {
    let [w, x, y, z] = q;
    let roll = (2.0 * (w * x + y * z)).atan2(1.0 - 2.0 * (x * x + y * y));
    let pitch = (2.0 * (w * y - z * x)).clamp(-1.0, 1.0).asin();
    let yaw = (2.0 * (w * z + x * y)).atan2(1.0 - 2.0 * (y * y + z * z));
    (roll.to_degrees(), pitch.to_degrees(), yaw.to_degrees())
}

/// (yaw +left, pitch, roll) in degrees, relative to the vehicle. An earth-frame attitude is
/// turned into body frame with `delta_yaw` (q_earth = q_delta_yaw · q_vehicle); without a
/// finite `delta_yaw` it is `None`, which hides the map fan instead of drawing a wrong one.
pub fn to_attitude(s: &GIMBAL_DEVICE_ATTITUDE_STATUS_DATA) -> Option<(f32, f32, f32)> {
    let (roll, pitch, yaw_mav) = quat_to_euler_deg(s.q);
    let body_yaw = if s
        .flags
        .contains(GimbalDeviceFlags::GIMBAL_DEVICE_FLAGS_YAW_IN_EARTH_FRAME)
    {
        if !s.delta_yaw.is_finite() {
            return None;
        }
        wrap_180(yaw_mav - s.delta_yaw.to_degrees())
    } else {
        yaw_mav
    };
    [roll, pitch, body_yaw]
        .iter()
        .all(|v| v.is_finite())
        .then_some((-body_yaw, pitch, roll))
}

/// Degrees into (−180, 180].
fn wrap_180(deg: f32) -> f32 {
    let r = deg.rem_euclid(360.0);
    if r > 180.0 {
        r - 360.0
    } else {
        r
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use mavlink::dialects::ardupilotmega::{GimbalDeviceFlags, GIMBAL_DEVICE_ATTITUDE_STATUS_DATA};
    use std::f32::consts::FRAC_PI_6;

    fn close(a: f32, b: f32) -> bool {
        (a - b).abs() < 0.01
    }

    fn status(q: [f32; 4], flags: u16, delta_yaw: f32) -> GIMBAL_DEVICE_ATTITUDE_STATUS_DATA {
        GIMBAL_DEVICE_ATTITUDE_STATUS_DATA {
            q,
            flags: GimbalDeviceFlags::from_bits_truncate(flags),
            delta_yaw,
            ..GIMBAL_DEVICE_ATTITUDE_STATUS_DATA::DEFAULT
        }
    }

    /// q = [w, x, y, z] for a pure yaw (MAVLink +right) of `deg`.
    fn yaw_q(deg: f32) -> [f32; 4] {
        let h = deg.to_radians() / 2.0;
        [h.cos(), 0.0, 0.0, h.sin()]
    }

    #[test]
    fn quaternion_identity_is_level() {
        let (r, p, y) = quat_to_euler_deg([1.0, 0.0, 0.0, 0.0]);
        assert!(close(r, 0.0) && close(p, 0.0) && close(y, 0.0));
    }

    #[test]
    fn yaw_90_right_is_minus_90_left() {
        let (yaw, pitch, roll) =
            to_attitude(&status([0.707_106_77, 0.0, 0.0, 0.707_106_77], 0, f32::NAN)).expect("att");
        assert!(close(yaw, -90.0), "{yaw}");
        assert!(close(pitch, 0.0) && close(roll, 0.0));
    }

    #[test]
    fn pitch_down_30() {
        let (yaw, pitch, _) =
            to_attitude(&status([0.965_925_8, 0.0, -0.258_819_04, 0.0], 32, f32::NAN)).expect("att");
        assert!(close(pitch, -30.0), "{pitch}");
        assert!(close(yaw, 0.0), "{yaw}");
    }

    #[test]
    fn earth_frame_uses_delta_yaw() {
        // Earth-frame gimbal yaw 60° right, vehicle heading (delta_yaw) 30° right: the gimbal
        // is 30° right of the nose, which is −30 in the SIYI (+left) convention.
        let (yaw, _, _) = to_attitude(&status(yaw_q(60.0), 64, FRAC_PI_6)).expect("att");
        assert!(close(yaw, -30.0), "{yaw}");
        // Earth yaw 0 with the vehicle heading 30° right: the gimbal looks 30° left of the nose.
        let (yaw, _, _) = to_attitude(&status(yaw_q(0.0), 64, FRAC_PI_6)).expect("att");
        assert!(close(yaw, 30.0), "{yaw}");
        assert_eq!(to_attitude(&status(yaw_q(60.0), 64, f32::NAN)), None);
    }

    #[test]
    fn earth_frame_difference_wraps() {
        // Earth 170° right, heading 170° left → 340° right of the nose = 20° left.
        let (yaw, _, _) = to_attitude(&status(yaw_q(170.0), 64, (-170.0f32).to_radians())).expect("att");
        assert!(close(yaw, 20.0), "{yaw}");
    }
}
