//! Reply payload parsers for the P2 command subset.

use rgcs_core::{Firmware, GimbalMode, RecordingState, VideoMode};

fn version(bytes: &[u8]) -> String {
    // Each u32 LE carries patch, minor, major in its low three bytes.
    format!("v{}.{}.{}", bytes[2], bytes[1], bytes[0])
}

/// CMD 0x01 reply: camera, gimbal and zoom firmware versions.
pub fn firmware(payload: &[u8]) -> Option<Firmware> {
    if payload.len() < 12 {
        return None;
    }
    Some(Firmware {
        camera: version(&payload[0..4]),
        gimbal: version(&payload[4..8]),
        zoom: version(&payload[8..12]),
    })
}

fn i16_at(payload: &[u8], i: usize) -> f32 {
    f32::from(i16::from_le_bytes([payload[2 * i], payload[2 * i + 1]])) / 10.0
}

/// CMD 0x0D reply: (yaw, pitch, roll) in degrees.
pub fn attitude(payload: &[u8]) -> Option<(f32, f32, f32)> {
    if payload.len() < 6 {
        return None;
    }
    Some((i16_at(payload, 0), i16_at(payload, 1), i16_at(payload, 2)))
}

/// CMD 0x18 reply: integer part and tenths.
pub fn zoom(payload: &[u8]) -> Option<f32> {
    if payload.len() < 2 {
        return None;
    }
    Some(f32::from(payload[0]) + f32::from(payload[1]) / 10.0)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VideoModeReply {
    Known(VideoMode),
    Custom(u8, u8),
}

/// CMD 0x10 / 0x11 reply: (main, sub) → named mode when it is one of ours.
pub fn video_mode(payload: &[u8]) -> Option<VideoModeReply> {
    if payload.len() < 2 {
        return None;
    }
    let pair = (payload[0], payload[1]);
    Some(match pair {
        (0, 2) | (1, 2) => VideoModeReply::Known(VideoMode::Rgb),
        (2, 0) | (2, 1) => VideoModeReply::Known(VideoMode::Thermal),
        (3, 2) | (4, 2) => VideoModeReply::Known(VideoMode::SideBySide),
        (m, s) => VideoModeReply::Custom(m, s),
    })
}

/// CMD 0x0A reply, byte 3: 0 idle, 1 recording, 2 no card, 3 data loss.
pub fn record_status(payload: &[u8]) -> Option<RecordingState> {
    match payload.get(3)? {
        0 => Some(RecordingState::Idle),
        1 => Some(RecordingState::Recording),
        2 => Some(RecordingState::NoCard),
        3 => Some(RecordingState::CardError),
        _ => None,
    }
}

/// CMD 0x0B feedback: 5 = recording started, 6 = stopped; everything else is not about recording.
pub fn record_feedback(payload: &[u8]) -> Option<RecordingState> {
    match payload.first()? {
        5 => Some(RecordingState::Recording),
        6 => Some(RecordingState::Idle),
        _ => None,
    }
}

/// CMD 0x19 reply.
pub fn gimbal_mode(payload: &[u8]) -> Option<GimbalMode> {
    match payload.first()? {
        0 => Some(GimbalMode::Lock),
        1 => Some(GimbalMode::Follow),
        2 => Some(GimbalMode::Fpv),
        _ => None,
    }
}

/// CMD 0x30 reply: byte 0 == 1 means the camera accepted the time.
pub fn utc_ack(p: &[u8]) -> Option<bool> {
    p.first().map(|b| *b == 1)
}

/// CMD 0x40 reply: UTC microseconds in the first 8 bytes (u64 LE).
pub fn camera_time(p: &[u8]) -> Option<u64> {
    Some(u64::from_le_bytes(p.get(..8)?.try_into().ok()?))
}

#[cfg(test)]
mod tests {
    use super::*;
    use rgcs_core::{Firmware, GimbalMode, RecordingState, VideoMode};

    #[test]
    fn utc_and_readback() {
        let mut p = 1_790_000_000_000_000u64.to_le_bytes().to_vec();
        p.extend(5000u32.to_le_bytes());
        assert_eq!(camera_time(&p), Some(1_790_000_000_000_000));
        assert_eq!(camera_time(&p[..7]), None);
        assert_eq!(utc_ack(&[1]), Some(true));
        assert_eq!(utc_ack(&[0]), Some(false));
        assert_eq!(utc_ack(&[]), None);
    }

    #[test]
    fn firmware_sdk_example() {
        let p = [0x01, 0x00, 0x01, 0x89, 0x0A, 0x01, 0x00, 0x8A, 0, 0, 0, 0];
        assert_eq!(
            firmware(&p),
            Some(Firmware {
                camera: "v1.0.1".into(),
                gimbal: "v0.1.10".into(),
                zoom: "v0.0.0".into()
            })
        );
        assert_eq!(firmware(&[1, 2]), None);
    }

    #[test]
    fn attitude_tenths() {
        let mut p = Vec::new();
        for v in [905i16, -300, 5, 0, 0, 0] {
            p.extend(v.to_le_bytes());
        }
        assert_eq!(attitude(&p), Some((90.5, -30.0, 0.5)));
        assert_eq!(attitude(&[0, 0]), None);
    }

    #[test]
    fn zoom_reply() {
        assert_eq!(zoom(&[2, 5]), Some(2.5));
        assert_eq!(zoom(&[2]), None);
    }

    #[test]
    fn video_mode_replies() {
        assert_eq!(video_mode(&[0, 2]), Some(VideoModeReply::Known(VideoMode::Rgb)));
        assert_eq!(video_mode(&[1, 2]), Some(VideoModeReply::Known(VideoMode::Rgb)));
        assert_eq!(
            video_mode(&[2, 0]),
            Some(VideoModeReply::Known(VideoMode::Thermal))
        );
        assert_eq!(
            video_mode(&[2, 1]),
            Some(VideoModeReply::Known(VideoMode::Thermal))
        );
        assert_eq!(
            video_mode(&[3, 2]),
            Some(VideoModeReply::Known(VideoMode::SideBySide))
        );
        assert_eq!(
            video_mode(&[4, 2]),
            Some(VideoModeReply::Known(VideoMode::SideBySide))
        );
        assert_eq!(video_mode(&[9, 9]), Some(VideoModeReply::Custom(9, 9)));
        assert_eq!(video_mode(&[1]), None);
    }

    #[test]
    fn record_status_and_feedback() {
        assert_eq!(record_status(&[0, 0, 0, 0]), Some(RecordingState::Idle));
        assert_eq!(record_status(&[0, 0, 0, 1]), Some(RecordingState::Recording));
        assert_eq!(record_status(&[0, 0, 0, 2]), Some(RecordingState::NoCard));
        assert_eq!(record_status(&[0, 0, 0, 3]), Some(RecordingState::CardError));
        assert_eq!(record_status(&[0, 0, 0]), None);
        assert_eq!(record_feedback(&[5]), Some(RecordingState::Recording));
        assert_eq!(record_feedback(&[6]), Some(RecordingState::Idle));
        assert_eq!(record_feedback(&[1]), None);
    }

    #[test]
    fn gimbal_mode_replies() {
        assert_eq!(gimbal_mode(&[0]), Some(GimbalMode::Lock));
        assert_eq!(gimbal_mode(&[1]), Some(GimbalMode::Follow));
        assert_eq!(gimbal_mode(&[2]), Some(GimbalMode::Fpv));
        assert_eq!(gimbal_mode(&[7]), None);
        assert_eq!(gimbal_mode(&[]), None);
    }
}
