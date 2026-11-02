//! MT11 AI tracking and encoding codecs: 0x20 / 0x21, 0x50 / 0x51, 0x55, 0x56, 0x5F.

use std::time::Duration;

use rgcs_core::{Detection, EncodingInfo, EncodingPreset, NormRect, TrackStatus, VideoCodec};

/// 0x50 coordinates are reported on a fixed 1280 x 720 grid.
pub const TRACK_BASE: (f32, f32) = (1280.0, 720.0);
pub const TRACK_MAX_AGE: Duration = Duration::from_secs(1);
pub const DETECTION_HISTORY: Duration = Duration::from_millis(1500);
pub const DETECTION_HISTORY_MAX: usize = 60;
pub const DETECTION_LOOKBACK: Duration = Duration::from_secs(1);
pub const DETECTION_SHOW_MAX_AGE: Duration = Duration::from_millis(500);
pub const FOLLOW_MIN_IOU: f32 = 0.1;

const U16_MAX: f32 = 65535.0;
const CANDIDATE_HEAD: usize = 11;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct StreamBox {
    pub lx: u16,
    pub ly: u16,
    pub rx: u16,
    pub ry: u16,
}

#[derive(Debug, Clone, PartialEq)]
pub struct DetectionFrame {
    pub model: u8,
    pub pts_us: u64,
    pub detections: Vec<Detection>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClickError {
    OutOfRange,
    StreamUnknown,
}

/// A span of `size` around `center`, shifted inward to stay within `[0, limit - 1]`.
/// `floor(x + 0.5)` matches JS `Math.round` (never banker's rounding).
fn axis_span(center: f32, size: u16, limit: u16) -> (u16, u16) {
    let size = i64::from(size.min(limit - 1));
    let start = (center - size as f32 / 2.0 + 0.5).floor() as i64;
    let start = start.clamp(0, i64::from(limit) - 1 - size);
    (start as u16, (start + size) as u16)
}

/// Square of `box_px` stream pixels centred on a normalized click, kept inside the frame.
pub fn click_to_stream_box(nx: f32, ny: f32, w: u16, h: u16, box_px: u16) -> Result<StreamBox, ClickError> {
    if !(0.0..=1.0).contains(&nx) || !(0.0..=1.0).contains(&ny) {
        return Err(ClickError::OutOfRange);
    }
    if w <= 1 || h <= 1 {
        return Err(ClickError::StreamUnknown);
    }
    let (lx, rx) = axis_span(nx * f32::from(w), box_px, w);
    let (ly, ry) = axis_span(ny * f32::from(h), box_px, h);
    Ok(StreamBox { lx, ly, rx, ry })
}

/// A main-stream size clicks can be mapped onto (Python keeps a 0x20 size only when > 0;
/// 1 pixel leaves nothing to select either).
pub fn usable_stream(w: u16, h: u16) -> bool {
    w > 1 && h > 1
}

/// Normalized point to stream pixels, clamped into the frame.
pub fn normalized_to_stream_point(nx: f32, ny: f32, w: u16, h: u16) -> (u16, u16) {
    let px = |n: f32, limit: u16| {
        let v = (n * f32::from(limit) + 0.5).floor() as i64;
        v.clamp(0, i64::from(limit.max(1)) - 1) as u16
    };
    (px(nx, w), px(ny, h))
}

fn select_payload(sel: u8, a: u16, b: u16, c: u16, d: u16) -> [u8; 9] {
    let mut out = [0u8; 9];
    out[0] = sel;
    for (i, v) in [a, b, c, d].into_iter().enumerate() {
        out[1 + 2 * i..3 + 2 * i].copy_from_slice(&v.to_le_bytes());
    }
    out
}

/// 0x56 payload: box selection, or cancel when `None`.
pub fn encode_ai_select(b: Option<StreamBox>) -> [u8; 9] {
    match b {
        None => select_payload(0, 0, 0, 0, 0),
        Some(b) => select_payload(1, b.lx, b.ly, b.rx, b.ry),
    }
}

/// 0x56 payload for point selection (rx = ry = 0).
pub fn encode_ai_select_point(x: u16, y: u16) -> [u8; 9] {
    select_payload(1, x, y, 0, 0)
}

/// 0x55: AI tracking mode on / off.
pub fn ai_mode(enable: bool) -> [u8; 1] {
    [u8::from(enable)]
}

/// 0x51: track push on / off.
pub fn track_push(enable: bool) -> [u8; 1] {
    [u8::from(enable)]
}

/// 0x5F: candidate box push, 5 = enable, 4 = disable.
pub fn candidate_push(enable: bool) -> [u8; 1] {
    [if enable { 5 } else { 4 }]
}

fn u16_at(p: &[u8], i: usize) -> u16 {
    u16::from_le_bytes([p[i], p[i + 1]])
}

fn target_name(id: u8) -> String {
    match id {
        255 => "any".into(),
        _ => class_name(id),
    }
}

fn class_name(id: u8) -> String {
    match id {
        0 => "person".into(),
        1 => "car".into(),
        2 => "bus".into(),
        3 => "truck".into(),
        n => format!("class_{n}"),
    }
}

/// 0x50: centre-based box on 1280 x 720 to a normalized top-left rect.
/// Status 3 (cancelled) gives `None` for the status. Short payloads give `None`.
pub fn parse_track(p: &[u8]) -> Option<(Option<TrackStatus>, NormRect, String)> {
    if p.len() < 10 {
        return None;
    }
    let (cx, cy, w, h) = (
        f32::from(u16_at(p, 0)),
        f32::from(u16_at(p, 2)),
        f32::from(u16_at(p, 4)),
        f32::from(u16_at(p, 6)),
    );
    let status = match p[9] {
        0 | 4 => Some(TrackStatus::Tracking),
        1 => Some(TrackStatus::Searching),
        2 => Some(TrackStatus::Lost),
        _ => None,
    };
    let rect = NormRect {
        x: ((cx - w / 2.0) / TRACK_BASE.0).max(0.0),
        y: ((cy - h / 2.0) / TRACK_BASE.1).max(0.0),
        w: w / TRACK_BASE.0,
        h: h / TRACK_BASE.1,
    };
    Some((status, rect, target_name(p[8])))
}

/// 0x5F push: header `<BBQB` then struct-of-arrays (lx, ly, rx, ry, score as u16[n]; class u8[n]).
pub fn parse_candidates(p: &[u8]) -> Option<DetectionFrame> {
    if p.len() < CANDIDATE_HEAD {
        return None;
    }
    let model = p[1];
    let pts_us = u64::from_le_bytes(p[2..10].try_into().ok()?);
    let n = usize::from(p[10]);
    if p.len() < CANDIDATE_HEAD + n * 11 {
        return None;
    }
    let at = |array: usize, i: usize| f32::from(u16_at(p, CANDIDATE_HEAD + 2 * (array * n + i))) / U16_MAX;
    let classes = &p[CANDIDATE_HEAD + 10 * n..];
    let detections = (0..n)
        .map(|i| Detection {
            x0: at(0, i),
            y0: at(1, i),
            x1: at(2, i),
            y1: at(3, i),
            score: at(4, i),
            class_id: classes[i],
            class_name: class_name(classes[i]),
        })
        .collect();
    Some(DetectionFrame {
        model,
        pts_us,
        detections,
    })
}

fn area(d: &Detection) -> f32 {
    (d.x1 - d.x0).max(0.0) * (d.y1 - d.y0).max(0.0)
}

fn contains(d: &Detection, nx: f32, ny: f32) -> bool {
    d.x0 <= nx && nx <= d.x1 && d.y0 <= ny && ny <= d.y1
}

fn iou(a: &Detection, b: &Detection) -> f32 {
    let ix = (a.x1.min(b.x1) - a.x0.max(b.x0)).max(0.0);
    let iy = (a.y1.min(b.y1) - a.y0.max(b.y0)).max(0.0);
    let inter = ix * iy;
    let union = area(a) + area(b) - inter;
    if union > 0.0 {
        inter / union
    } else {
        0.0
    }
}

/// Detection under a click, followed to the newest frame (`frames` is oldest first).
/// The click is tested against every recent frame (smallest box wins, newer frames break ties);
/// the match then follows to the newest frame by best IoU within the same class.
pub fn pick_detection(frames: &[&DetectionFrame], nx: f32, ny: f32) -> Option<Detection> {
    let chosen = frames
        .iter()
        .enumerate()
        .flat_map(|(i, f)| f.detections.iter().map(move |d| (i, d)))
        .filter(|(_, d)| contains(d, nx, ny))
        .min_by(|(ia, a), (ib, b)| area(a).total_cmp(&area(b)).then(ib.cmp(ia)))
        .map(|(_, d)| d)?;
    let best = frames
        .last()?
        .detections
        .iter()
        .filter(|d| d.class_id == chosen.class_id)
        .max_by(|a, b| iou(a, chosen).total_cmp(&iou(b, chosen)));
    match best {
        Some(b) if iou(b, chosen) >= FOLLOW_MIN_IOU => Some(b.clone()),
        _ => Some(chosen.clone()),
    }
}

/// 0x56 ACK byte 0.
pub fn ai_select_ack(p: &[u8]) -> Option<&'static str> {
    Some(match p.first()? {
        0 => "failed",
        1 => "ok",
        2 => "not_ai_mode",
        3 => "stream_unsupported",
        4 => "low_texture",
        5 => "stabilization_on",
        _ => "unknown",
    })
}

/// 0x55 ACK byte 1.
pub fn ai_mode_ack(p: &[u8]) -> Option<&'static str> {
    Some(match p.get(1)? {
        0 => "ok",
        1 => "night_vision_box_only",
        2 => "super_res_box_only",
        3 => "stabilization_no_ai",
        4 => "night_stab_no_ai",
        5 => "super_res_stab_no_ai",
        _ => "unknown",
    })
}

/// 0x20 ACK: stream_type, codec, width, height, bitrate (kbps), optional fps; at least 8 bytes.
pub fn parse_encoding(p: &[u8]) -> Option<(u8, EncodingInfo)> {
    if p.len() < 8 {
        return None;
    }
    let codec = match p[1] {
        1 => VideoCodec::H264,
        2 => VideoCodec::H265,
        _ => VideoCodec::Unknown,
    };
    let info = EncodingInfo {
        codec,
        width: u16_at(p, 2),
        height: u16_at(p, 4),
        bitrate_kbps: u16_at(p, 6),
        fps: p.get(8).copied(),
    };
    Some((p[0], info))
}

/// 0x21 payload for the main stream (stream 1, bitrate 0, fps 0).
pub fn encode_encoding(preset: &EncodingPreset) -> [u8; 9] {
    let codec: u8 = if preset.codec == VideoCodec::H265 { 2 } else { 1 };
    let mut out = [0u8; 9];
    out[0] = 1;
    out[1] = codec;
    out[2..4].copy_from_slice(&preset.width.to_le_bytes());
    out[4..6].copy_from_slice(&preset.height.to_le_bytes());
    out
}

/// 0x21 reply `[stream_type, sta]`: `sta == 1` means the camera took the encoding.
pub fn encoding_ack(p: &[u8]) -> Option<bool> {
    p.get(1).map(|sta| *sta == 1)
}

/// 0x20 request: main stream.
pub fn encoding_request() -> [u8; 1] {
    [1]
}

#[cfg(test)]
#[path = "ai_tests.rs"]
mod tests;
