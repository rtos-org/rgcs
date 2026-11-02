//! MT11 thermal replies: 0x12 point, 0x14 full frame, 0x37 / 0x38 gain.

use std::time::Duration;

use rgcs_core::{ThermalFrame, ThermalGain};

/// Raw values above this many °C wrap around to negative temperatures.
pub const NEGATIVE_THRESHOLD_C: f32 = 600.0;
/// Full-frame readings older than this are not shown.
pub const FRAME_MAX_AGE: Duration = Duration::from_secs(3);
/// Point readings older than this are not shown.
pub const POINT_MAX_AGE: Duration = Duration::from_secs(15);

/// Raw u16 (°C x100, wrapped when negative) to °C, rounded to 0.01.
pub fn decode_temp(raw: u16) -> f32 {
    let c = f32::from(raw) / 100.0;
    let c = if c > NEGATIVE_THRESHOLD_C {
        (i32::from(raw) - 65536) as f32 / 100.0
    } else {
        c
    };
    (c * 100.0).round() / 100.0
}

fn u16_at(p: &[u8], i: usize) -> u16 {
    u16::from_le_bytes([p[i], p[i + 1]])
}

/// CMD 0x14 reply: max, min (u16 each), max xy, min xy; at least 12 bytes.
pub fn parse_full_frame(p: &[u8]) -> Option<ThermalFrame> {
    if p.len() < 12 {
        return None;
    }
    Some(ThermalFrame {
        max_c: decode_temp(u16_at(p, 0)),
        min_c: decode_temp(u16_at(p, 2)),
        max_xy: (u16_at(p, 4), u16_at(p, 6)),
        min_xy: (u16_at(p, 8), u16_at(p, 10)),
    })
}

/// CMD 0x12 reply: temperature then x, y in stream pixels; at least 6 bytes.
pub fn parse_point(p: &[u8]) -> Option<(f32, (u16, u16))> {
    if p.len() < 6 {
        return None;
    }
    Some((decode_temp(u16_at(p, 0)), (u16_at(p, 2), u16_at(p, 4))))
}

/// CMD 0x37 / 0x38 reply: byte 0, 0 = Low, 1 = High.
pub fn parse_gain(p: &[u8]) -> Option<ThermalGain> {
    match p.first()? {
        0 => Some(ThermalGain::Low),
        1 => Some(ThermalGain::High),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::siyi::encode;
    use rgcs_core::ThermalGain;

    fn hex(s: &str) -> Vec<u8> {
        (0..s.len())
            .step_by(2)
            .map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap())
            .collect()
    }

    #[test]
    fn point_request_matches_sdk_example() {
        assert_eq!(encode::point_temp(960, 540).to_vec(), hex("c0031c0201"));
    }

    #[test]
    fn full_frame_request() {
        assert_eq!(encode::full_frame_temp(), [0x01]);
    }

    #[test]
    fn decode_temp_cases() {
        assert_eq!(decode_temp(1604), 16.04);
        assert_eq!(decode_temp(55000), 550.0);
        assert_eq!(decode_temp(64036), -15.0);
    }

    #[test]
    fn parse_hardware_samples() {
        let f = parse_full_frame(&hex("6a08e6033e062000f4016203")).unwrap();
        assert_eq!(f.max_c, 21.54);
        assert_eq!(f.min_c, 9.98);
        assert_eq!(f.max_xy, (1598, 32));
        assert_eq!(f.min_xy, (500, 866));
        assert_eq!(parse_point(&hex("4406c0031c02")), Some((16.04, (960, 540))));
    }

    #[test]
    fn short_payloads() {
        assert_eq!(parse_full_frame(&[0; 11]), None);
        assert_eq!(parse_point(&[0; 5]), None);
    }

    #[test]
    fn gain_bytes() {
        assert_eq!(parse_gain(&[1]), Some(ThermalGain::High));
        assert_eq!(parse_gain(&[0]), Some(ThermalGain::Low));
        assert_eq!(parse_gain(&[]), None);
        assert_eq!(encode::thermal_gain(ThermalGain::High), [1]);
        assert_eq!(encode::thermal_gain(ThermalGain::Low), [0]);
        assert_eq!(encode::thermal_palette(3), [3]);
    }
}
