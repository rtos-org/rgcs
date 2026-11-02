//! MT11 simulator: replies and pushes for the thermal, AI, encoding, clock and SD commands.

use std::time::Instant;

pub type SimDetection = (f32, f32, f32, f32, f32, u8);

#[derive(Debug, Clone)]
pub struct SimMedia {
    pub gain: u8,
    pub palette: u8,
    /// Codec (1 = H.264, 2 = H.265), width, height.
    pub encoding: (u8, u16, u16),
    /// Status, file system, total x100, free x100.
    pub tf: (u8, u8, u16, u16),
    pub clock_offset_us: i64,
    /// Unix µs the camera was told with 0x30, and when.
    pub utc_set_at: Option<(u64, Instant)>,
    pub ai_mode: bool,
    pub track_push: bool,
    pub candidate_push: bool,
    /// Centre x, centre y, w, h on the 1280 x 720 grid.
    pub track: Option<(u16, u16, u16, u16)>,
    /// 0x50 status byte pushed with the track (0 tracking, 2 lost).
    pub track_status: u8,
    pub frame_temps: [u16; 6],
    pub detections: Vec<SimDetection>,
    /// How many 0x20 replies after a 0x21 still report the previous size (a slow encoder).
    pub stale_encoding_replies: u8,
    /// The previous encoding and how many stale replies are left.
    pub stale: Option<((u8, u16, u16), u8)>,
    /// Refuse every 0x21 (`[1, 0]`) and keep the current encoding.
    pub reject_encoding: bool,
}

impl Default for SimMedia {
    fn default() -> Self {
        Self {
            gain: 1,
            palette: 0,
            encoding: (1, 1920, 1080),
            tf: (2, 2, 12800, 5630),
            clock_offset_us: 0,
            utc_set_at: None,
            ai_mode: false,
            track_push: false,
            candidate_push: false,
            track: None,
            track_status: 0,
            frame_temps: [0x086a, 0x03e6, 0x063e, 0x0020, 0x01f4, 0x0362],
            detections: vec![(0.40, 0.40, 0.50, 0.60, 0.9, 0), (0.70, 0.55, 0.85, 0.70, 0.8, 1)],
            stale_encoding_replies: 0,
            stale: None,
            reject_encoding: false,
        }
    }
}

const GRID: (f32, f32) = (1280.0, 720.0);
const POINT_BOX_PX: f32 = 100.0;
const POINT_TEMP_X100: u16 = 1604;

fn u16_at(p: &[u8], i: usize) -> Option<u16> {
    Some(u16::from_le_bytes([*p.get(i)?, *p.get(i + 1)?]))
}

fn le(values: &[u16]) -> Vec<u8> {
    values.iter().flat_map(|v| v.to_le_bytes()).collect()
}

fn sim_unix_us(m: &SimMedia, now: Instant, unix_now_us: u64) -> u64 {
    match m.utc_set_at {
        Some((set_us, at)) => set_us + now.saturating_duration_since(at).as_micros() as u64,
        None => unix_now_us.saturating_add_signed(m.clock_offset_us),
    }
}

fn stream_reply(m: &mut SimMedia, payload: &[u8]) -> Option<(u8, Vec<u8>)> {
    if *payload.first()? != 1 {
        return None;
    }
    let (codec, w, h) = match m.stale {
        Some((old, left)) if left > 0 => {
            m.stale = Some((old, left - 1));
            old
        }
        _ => m.encoding,
    };
    let mut data = vec![1, codec];
    data.extend(le(&[w, h, 4000]));
    data.push(30);
    Some((0x20, data))
}

fn set_encoding(m: &mut SimMedia, payload: &[u8]) -> Option<(u8, Vec<u8>)> {
    if m.reject_encoding {
        return Some((0x21, vec![1, 0]));
    }
    m.stale = Some((m.encoding, m.stale_encoding_replies));
    m.encoding = (*payload.get(1)?, u16_at(payload, 2)?, u16_at(payload, 4)?);
    Some((0x21, vec![1, 1]))
}

fn set_clock(m: &mut SimMedia, payload: &[u8], now: Instant) -> Option<(u8, Vec<u8>)> {
    let us = u64::from_le_bytes(payload.get(..8)?.try_into().ok()?);
    m.utc_set_at = Some((us, now));
    Some((0x30, vec![1]))
}

/// 0x56: a box or a point starts the sim tracker, a cancel stops it.
fn select_track(m: &mut SimMedia, payload: &[u8]) -> Option<(u8, Vec<u8>)> {
    let (w, h) = (f32::from(m.encoding.1.max(1)), f32::from(m.encoding.2.max(1)));
    let v = |i| u16_at(payload, i).map(f32::from);
    let (sel, a, b, c, d) = (*payload.first()?, v(1)?, v(3)?, v(5)?, v(7)?);
    m.track_status = 0;
    m.track = match sel {
        0 => None,
        _ if c > 0.0 && d > 0.0 => Some(grid_box(
            (a + c) / 2.0 / w,
            (b + d) / 2.0 / h,
            (c - a) / w,
            (d - b) / h,
        )),
        _ => Some(point_track(m, a / w, b / h)),
    };
    Some((0x56, vec![1]))
}

fn point_track(m: &SimMedia, nx: f32, ny: f32) -> (u16, u16, u16, u16) {
    let hit = m
        .detections
        .iter()
        .find(|d| d.0 <= nx && nx <= d.2 && d.1 <= ny && ny <= d.3);
    match hit {
        Some(d) => grid_box((d.0 + d.2) / 2.0, (d.1 + d.3) / 2.0, d.2 - d.0, d.3 - d.1),
        None => grid_box(nx, ny, POINT_BOX_PX / GRID.0, POINT_BOX_PX / GRID.1),
    }
}

/// Normalized centre and size to the centre-based 1280 x 720 box of 0x50.
fn grid_box(cx: f32, cy: f32, w: f32, h: f32) -> (u16, u16, u16, u16) {
    let g = |n: f32, s: f32| (n * s).round().max(0.0) as u16;
    (g(cx, GRID.0), g(cy, GRID.1), g(w, GRID.0), g(h, GRID.1))
}

fn point_reply(payload: &[u8]) -> Option<(u8, Vec<u8>)> {
    Some((
        0x12,
        le(&[POINT_TEMP_X100, u16_at(payload, 0)?, u16_at(payload, 2)?]),
    ))
}

/// Reply (cmd, data) for the new commands; `None` when the sim does not answer.
pub fn media_reply(
    m: &mut SimMedia,
    cmd: u8,
    payload: &[u8],
    now: Instant,
    unix_now_us: u64,
) -> Option<(u8, Vec<u8>)> {
    match cmd {
        0x12 => point_reply(payload),
        0x14 => Some((0x14, le(&m.frame_temps))),
        0x37 => Some((0x37, vec![m.gain])),
        0x38 => {
            m.gain = u8::from(*payload.first()? != 0);
            Some((0x38, vec![m.gain]))
        }
        0x1B => {
            m.palette = *payload.first()?;
            Some((0x1B, vec![m.palette]))
        }
        0x20 => stream_reply(m, payload),
        0x21 => set_encoding(m, payload),
        0x30 => set_clock(m, payload, now),
        0x40 => {
            let mut data = sim_unix_us(m, now, unix_now_us).to_le_bytes().to_vec();
            data.extend(0u32.to_le_bytes());
            Some((0x40, data))
        }
        0x49 => Some((
            0x49,
            [
                le(&[u16::from(m.tf.0) | u16::from(m.tf.1) << 8]),
                le(&[m.tf.2, m.tf.3]),
            ]
            .concat(),
        )),
        0x51 => {
            m.track_push = *payload.first()? != 0;
            Some((0x51, vec![u8::from(m.track_push)]))
        }
        0x55 => {
            m.ai_mode = *payload.first()? != 0;
            Some((0x55, vec![u8::from(m.ai_mode), 0]))
        }
        0x56 => select_track(m, payload),
        0x5F => {
            let e = *payload.first()?;
            m.candidate_push = e == 5;
            Some((0x5F, vec![e, 0]))
        }
        _ => None,
    }
}

/// 0x50 push payload while AI mode and the track push are on and a target is tracked.
pub fn track_frame(m: &SimMedia) -> Option<Vec<u8>> {
    let (cx, cy, w, h) = m.track.filter(|_| m.ai_mode && m.track_push)?;
    let mut data = le(&[cx, cy, w, h]);
    data.extend([0, m.track_status]);
    Some(data)
}

/// 0x5F push payload while the candidate push is on.
pub fn candidate_frame(m: &SimMedia, pts_us: u64) -> Option<Vec<u8>> {
    if !m.candidate_push {
        return None;
    }
    let to_u16 = |v: f32| (v.clamp(0.0, 1.0) * 65535.0).round() as u16;
    let mut data = vec![0, 0];
    data.extend(pts_us.to_le_bytes());
    data.push(m.detections.len() as u8);
    for field in 0..5 {
        let pick = |d: &SimDetection| to_u16([d.0, d.1, d.2, d.3, d.4][field]);
        data.extend(m.detections.iter().flat_map(|d| pick(d).to_le_bytes()));
    }
    data.extend(m.detections.iter().map(|d| d.5));
    Some(data)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::siyi::{ai, encode, parse, thermal};
    use rgcs_core::{StorageStatus, ThermalGain, TrackStatus};
    use std::time::Duration;

    const GPS_US: u64 = 1_760_000_000_000_000;

    fn ask(m: &mut SimMedia, cmd: u8, payload: &[u8]) -> Option<Vec<u8>> {
        media_reply(m, cmd, payload, Instant::now(), GPS_US).map(|(_, d)| d)
    }

    #[test]
    fn sim_point_temperature_reply() {
        let mut m = SimMedia::default();
        let data = ask(&mut m, 0x12, &encode::point_temp(960, 540)).unwrap();
        assert_eq!(thermal::parse_point(&data), Some((16.04, (960, 540))));
    }

    #[test]
    fn sim_frame_reply_is_the_hardware_sample() {
        let mut m = SimMedia::default();
        let f = thermal::parse_full_frame(&ask(&mut m, 0x14, &[1]).unwrap()).unwrap();
        assert_eq!(f.max_c, 21.54);
        assert_eq!(f.min_c, 9.98);
    }

    #[test]
    fn sim_gain_set_and_get() {
        let mut m = SimMedia::default();
        ask(&mut m, 0x38, &[0]);
        assert_eq!(
            thermal::parse_gain(&ask(&mut m, 0x37, &[]).unwrap()),
            Some(ThermalGain::Low)
        );
        ask(&mut m, 0x38, &[1]);
        assert_eq!(
            thermal::parse_gain(&ask(&mut m, 0x37, &[]).unwrap()),
            Some(ThermalGain::High)
        );
    }

    #[test]
    fn sim_encoding_set_then_read() {
        let mut m = SimMedia::default();
        let preset = rgcs_core::mt11_encoding_presets()
            .into_iter()
            .find(|p| p.id == "h264_4k")
            .unwrap();
        assert_eq!(ask(&mut m, 0x21, &ai::encode_encoding(&preset)), Some(vec![1, 1]));
        let (stream, info) = ai::parse_encoding(&ask(&mut m, 0x20, &[1]).unwrap()).unwrap();
        assert_eq!((stream, info.width, info.height), (1, 3840, 2160));
        assert!(ask(&mut m, 0x20, &[0]).is_none());
    }

    #[test]
    fn sim_clock_follows_utc_set() {
        let mut m = SimMedia::default();
        ask(&mut m, 0x30, &encode::utc_time(GPS_US));
        std::thread::sleep(Duration::from_millis(20));
        let us = parse::camera_time(&ask(&mut m, 0x40, &[]).unwrap()).unwrap();
        assert!(us >= GPS_US && us - GPS_US < 60_000, "{}", us - GPS_US);
    }

    #[test]
    fn sim_select_box_starts_track_push() {
        let mut m = SimMedia::default();
        ask(&mut m, 0x55, &[1]);
        ask(&mut m, 0x51, &[1]);
        let b = ai::StreamBox {
            lx: 885,
            ly: 465,
            rx: 1035,
            ry: 615,
        };
        assert_eq!(ask(&mut m, 0x56, &ai::encode_ai_select(Some(b))), Some(vec![1]));
        let (status, rect, _) = ai::parse_track(&track_frame(&m).unwrap()).unwrap();
        assert_eq!(status, Some(TrackStatus::Tracking));
        assert!((rect.x + rect.w / 2.0 - 0.5).abs() < 0.01 && (rect.y + rect.h / 2.0 - 0.5).abs() < 0.01);
        ask(&mut m, 0x56, &ai::encode_ai_select(None));
        assert!(track_frame(&m).is_none());
    }

    #[test]
    fn sim_select_point_picks_the_detection() {
        let mut m = SimMedia::default();
        ask(&mut m, 0x55, &[1]);
        ask(&mut m, 0x51, &[1]);
        ask(&mut m, 0x56, &ai::encode_ai_select_point(864, 540));
        let (_, rect, _) = ai::parse_track(&track_frame(&m).unwrap()).unwrap();
        assert!((rect.w - 0.1).abs() < 0.01 && (rect.x - 0.4).abs() < 0.01);
    }

    #[test]
    fn sim_candidate_frame_roundtrip() {
        let mut m = SimMedia::default();
        assert!(candidate_frame(&m, 7).is_none());
        assert_eq!(ask(&mut m, 0x5F, &[5]), Some(vec![5, 0]));
        let f = ai::parse_candidates(&candidate_frame(&m, 7).unwrap()).unwrap();
        assert_eq!((f.detections.len(), f.pts_us), (2, 7));
        assert_eq!(f.detections[0].class_name, "person");
        assert!((f.detections[1].x0 - 0.70).abs() < 0.001);
    }

    #[test]
    fn sim_tf_card_default() {
        let mut m = SimMedia::default();
        let i = crate::siyi::tf_card::parse_tf_card(&ask(&mut m, 0x49, &[]).unwrap()).unwrap();
        assert_eq!(
            (i.status, i.total_gb, i.free_gb),
            (StorageStatus::Ok, 128.0, 56.3)
        );
    }

    #[test]
    fn sim_never_answers_0x48() {
        assert!(ask(&mut SimMedia::default(), 0x48, &[1]).is_none());
    }
}
