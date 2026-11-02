//! MT11 thermal, AI tracking, encoding, storage and clock types.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, rename_all = "snake_case")]
pub enum ThermalGain {
    Low,
    High,
}

impl ThermalGain {
    /// Measurable temperature span in °C.
    pub fn range_c(self) -> (f32, f32) {
        match self {
            Self::High => (-20.0, 150.0),
            Self::Low => (0.0, 550.0),
        }
    }

    /// 0x37 / 0x38 wire value: 0 = Low, 1 = High.
    pub fn wire(self) -> u8 {
        match self {
            Self::Low => 0,
            Self::High => 1,
        }
    }

    pub fn from_wire(b: u8) -> Option<Self> {
        match b {
            0 => Some(Self::Low),
            1 => Some(Self::High),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ThermalCaps {
    pub gains: Vec<ThermalGain>,
    pub palettes: Vec<u8>,
    pub point_temp: bool,
    pub frame_temp: bool,
}

/// Full-frame extremes (0x14); coordinates are main-stream pixels.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ThermalFrame {
    pub max_c: f32,
    pub min_c: f32,
    pub max_xy: (u16, u16),
    pub min_xy: (u16, u16),
}

/// Point temperature (0x12); `xy` is in main-stream pixels.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ThermalPoint {
    pub temp_c: f32,
    pub xy: (u16, u16),
    #[ts(type = "number")]
    pub age_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ThermalState {
    pub gain: Option<ThermalGain>,
    pub range_c: Option<(f32, f32)>,
    pub frame: Option<ThermalFrame>,
    pub point: Option<ThermalPoint>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AiTrackingCaps {
    pub box_select: bool,
    pub point_select: bool,
    pub candidates: bool,
}

/// Normalized 0..1 rectangle, top-left origin.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct NormRect {
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, rename_all = "snake_case")]
pub enum TrackStatus {
    Tracking,
    Searching,
    Lost,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TrackState {
    pub status: TrackStatus,
    pub rect: NormRect,
    pub target: String,
    #[ts(type = "number")]
    pub age_ms: u64,
}

/// One AI detection box (0x5F), normalized 0..1.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Detection {
    pub x0: f32,
    pub y0: f32,
    pub x1: f32,
    pub y1: f32,
    pub score: f32,
    pub class_id: u8,
    pub class_name: String,
}

/// Last 0x55 / 0x56 ACK as a fixed code; `seq` increments on every ACK so the UI can notice repeats.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AiAck {
    pub code: String,
    pub seq: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, rename_all = "snake_case")]
pub enum VideoCodec {
    H264,
    H265,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct EncodingPreset {
    pub id: String,
    pub label: String,
    pub codec: VideoCodec,
    pub width: u16,
    pub height: u16,
}

/// The five MT11 main-stream presets, in the Python app's order.
pub fn mt11_encoding_presets() -> Vec<EncodingPreset> {
    let p = |id: &str, label: &str, codec, width, height| EncodingPreset {
        id: id.into(),
        label: label.into(),
        codec,
        width,
        height,
    };
    vec![
        p("h264_720p", "H.264 1280×720", VideoCodec::H264, 1280, 720),
        p("h264_1080p", "H.264 1920×1080", VideoCodec::H264, 1920, 1080),
        p("h264_4k", "H.264 3840×2160", VideoCodec::H264, 3840, 2160),
        p("h265_1080p", "H.265 1920×1080", VideoCodec::H265, 1920, 1080),
        p("h265_4k", "H.265 3840×2160", VideoCodec::H265, 3840, 2160),
    ]
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct EncodingInfo {
    pub codec: VideoCodec,
    pub width: u16,
    pub height: u16,
    pub bitrate_kbps: u16,
    pub fps: Option<u8>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, rename_all = "snake_case")]
pub enum StorageStatus {
    NotInserted,
    MountFailed,
    Ok,
    LowSpace,
    ReadOnly,
    ReadError,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct StorageInfo {
    pub status: StorageStatus,
    pub fs: String,
    pub total_gb: f32,
    pub free_gb: f32,
    pub free_pct: Option<f32>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CameraClock {
    #[ts(type = "number | null")]
    pub camera_unix_us: Option<u64>,
    #[ts(type = "number | null")]
    pub reading_age_ms: Option<u64>,
    pub offset_ms: Option<f32>,
    pub rtt_ms: Option<f32>,
    #[ts(type = "number | null")]
    pub synced_at_unix_ms: Option<u64>,
    pub error: Option<String>,
}

pub const MT11_PALETTES: [u8; 11] = [0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
pub const AI_BOX_PX_RANGE: (u16, u16) = (32, 600);
pub const AI_BOX_PX_DEFAULT: u16 = 100;
pub const AI_CENTER_BOX_PX: u16 = 200;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn presets_are_python_order() {
        let ids: Vec<String> = mt11_encoding_presets().into_iter().map(|p| p.id).collect();
        assert_eq!(ids[0], "h264_720p");
        assert_eq!(ids.len(), 5);
        assert_eq!(MT11_PALETTES.len(), 11);
        assert_eq!(
            (AI_BOX_PX_RANGE, AI_BOX_PX_DEFAULT, AI_CENTER_BOX_PX),
            ((32, 600), 100, 200)
        );
    }
}
