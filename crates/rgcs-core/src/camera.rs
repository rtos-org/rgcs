//! Camera / gimbal abstraction shared by the drivers, the server and the UI.
//! P2 carries the MT11 subset (gimbal, zoom, photo, record, video type); thermal, AI, ROI
//! and encoding caps arrive with their drivers.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::camera_media::{
    mt11_encoding_presets, AiAck, AiTrackingCaps, CameraClock, Detection, EncodingInfo, EncodingPreset,
    StorageInfo, ThermalCaps, ThermalGain, ThermalState, TrackState, AI_BOX_PX_RANGE, MT11_PALETTES,
};
use crate::vehicle::SysId;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, rename_all = "snake_case")]
pub enum CameraKind {
    None,
    Mavlink,
    SiyiMt11,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, rename_all = "snake_case")]
pub enum VideoMode {
    Rgb,
    Thermal,
    SideBySide,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, rename_all = "snake_case")]
pub enum GimbalMode {
    Lock,
    Follow,
    Fpv,
}

/// SIYI 0x08 centre variants (1..4 on the wire).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, rename_all = "snake_case")]
pub enum CenterMode {
    OneKeyReset,
    CenterFaceDown,
    Center,
    FaceDown,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct GimbalCaps {
    pub rate: bool,
    pub angle: bool,
    pub center: bool,
    pub modes: Vec<GimbalMode>,
    pub attitude: bool,
    pub pitch_range: (f32, f32),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum ZoomUnit {
    #[default]
    Times,
    Percent,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ZoomCaps {
    pub max: f32,
    pub absolute: bool,
    pub step: bool,
    pub continuous: bool,
    /// What `max` and `CameraState.zoom` count: a multiplier or a percentage of the range.
    #[serde(default)]
    pub unit: ZoomUnit,
}

/// What a camera can do; the UI hides (not disables) everything absent.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CameraCaps {
    pub kind: CameraKind,
    pub gimbal: Option<GimbalCaps>,
    pub zoom: Option<ZoomCaps>,
    pub focus: bool,
    pub photo: bool,
    pub record: bool,
    pub video_modes: Vec<VideoMode>,
    /// Horizontal field of view at 1× zoom (degrees), for the map's gimbal fan / footprint.
    #[ts(type = "number | null")]
    pub hfov_deg: Option<f32>,
    /// GPS ROI support: `Computed` = the server aims the gimbal itself.
    pub roi: crate::roi::RoiMode,
    pub thermal: Option<ThermalCaps>,
    pub ai_tracking: Option<AiTrackingCaps>,
    pub encoding_presets: Vec<EncodingPreset>,
    pub storage_info: bool,
    pub clock_sync: bool,
}

impl CameraCaps {
    pub fn none() -> Self {
        Self {
            kind: CameraKind::None,
            gimbal: None,
            zoom: None,
            focus: false,
            photo: false,
            record: false,
            video_modes: Vec::new(),
            hfov_deg: None,
            roi: crate::roi::RoiMode::None,
            thermal: None,
            ai_tracking: None,
            encoding_presets: Vec::new(),
            storage_info: false,
            clock_sync: false,
        }
    }

    /// SIYI MT11: zoom to 165×, pitch −90..30, Lock / Follow / FPV.
    pub fn siyi_mt11() -> Self {
        Self {
            kind: CameraKind::SiyiMt11,
            gimbal: Some(GimbalCaps {
                rate: true,
                angle: true,
                center: true,
                modes: vec![GimbalMode::Lock, GimbalMode::Follow, GimbalMode::Fpv],
                attitude: true,
                pitch_range: (-90.0, 30.0),
            }),
            zoom: Some(ZoomCaps {
                max: 165.0,
                absolute: true,
                step: true,
                continuous: true,
                unit: ZoomUnit::Times,
            }),
            focus: true,
            photo: true,
            record: true,
            video_modes: vec![VideoMode::Rgb, VideoMode::Thermal, VideoMode::SideBySide],
            // The prototype's CAM_HFOV until the MT11 is measured.
            hfov_deg: Some(62.0),
            roi: crate::roi::RoiMode::Computed,
            thermal: Some(ThermalCaps {
                gains: vec![ThermalGain::Low, ThermalGain::High],
                palettes: MT11_PALETTES.to_vec(),
                point_temp: true,
                frame_temp: true,
            }),
            ai_tracking: Some(AiTrackingCaps {
                box_select: true,
                point_select: true,
                candidates: true,
            }),
            encoding_presets: mt11_encoding_presets(),
            storage_info: true,
            clock_sync: true,
        }
    }

    /// The server refuses commands the caps do not cover.
    pub fn supports(&self, cmd: &CameraCommand) -> bool {
        use CameraCommand::*;
        let gimbal = self.gimbal.as_ref();
        let zoom = self.zoom.as_ref();
        match cmd {
            GimbalRate { .. } => gimbal.is_some_and(|g| g.rate),
            GimbalAngle { .. } => gimbal.is_some_and(|g| g.angle),
            GimbalCenter { .. } => gimbal.is_some_and(|g| g.center),
            GimbalMode { mode } => gimbal.is_some_and(|g| g.modes.contains(mode)),
            ZoomAbsolute { .. } | ZoomReset => zoom.is_some_and(|z| z.absolute),
            ZoomStep { .. } => zoom.is_some_and(|z| z.step),
            ZoomSpeed { .. } => zoom.is_some_and(|z| z.continuous),
            Focus { .. } => self.focus,
            Photo => self.photo,
            RecordStart | RecordStop => self.record,
            VideoMode { mode } => self.video_modes.contains(mode),
            ThermalGain { gain } => self.thermal.as_ref().is_some_and(|t| t.gains.contains(gain)),
            ThermalPalette { palette } => self
                .thermal
                .as_ref()
                .is_some_and(|t| t.palettes.contains(palette)),
            MeasurePoint { .. } => self.thermal.as_ref().is_some_and(|t| t.point_temp),
            AiSelectBox { .. } => self.ai_tracking.as_ref().is_some_and(|a| a.box_select),
            AiSelectPoint { .. } => self.ai_tracking.as_ref().is_some_and(|a| a.point_select),
            AiCancel => self.ai_tracking.is_some(),
            Encoding { preset } => self.encoding_presets.iter().any(|p| &p.id == preset),
            SyncClock => self.clock_sync,
        }
    }
}

/// Commands to a camera (P2 subset). JSON: `{"cmd": "...", "args": {...}}`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "cmd", content = "args", rename_all = "snake_case")]
#[ts(export, rename_all = "snake_case")]
pub enum CameraCommand {
    /// −100..100, +yaw = right, +pitch = up.
    GimbalRate {
        yaw: i8,
        pitch: i8,
    },
    GimbalAngle {
        yaw_deg: f32,
        pitch_deg: f32,
    },
    GimbalCenter {
        mode: CenterMode,
    },
    GimbalMode {
        mode: GimbalMode,
    },
    ZoomAbsolute {
        zoom: f32,
    },
    ZoomStep {
        steps: i8,
    },
    /// 1 in, 0 stop, −1 out.
    ZoomSpeed {
        dir: i8,
    },
    ZoomReset,
    Focus {
        dir: i8,
    },
    Photo,
    RecordStart,
    RecordStop,
    VideoMode {
        mode: VideoMode,
    },
    ThermalGain {
        gain: ThermalGain,
    },
    ThermalPalette {
        palette: u8,
    },
    /// x / y normalized 0..1 over the main stream.
    MeasurePoint {
        x: f32,
        y: f32,
    },
    /// x / y normalized 0..1; `box_px: None` = the profile's `ai_box_px`.
    AiSelectBox {
        x: f32,
        y: f32,
        box_px: Option<u16>,
    },
    AiSelectPoint {
        x: f32,
        y: f32,
    },
    AiCancel,
    Encoding {
        preset: String,
    },
    SyncClock,
}

impl CameraCommand {
    /// The serde tag, used in the audit log.
    pub fn name(&self) -> &'static str {
        match self {
            Self::GimbalRate { .. } => "gimbal_rate",
            Self::GimbalAngle { .. } => "gimbal_angle",
            Self::GimbalCenter { .. } => "gimbal_center",
            Self::GimbalMode { .. } => "gimbal_mode",
            Self::ZoomAbsolute { .. } => "zoom_absolute",
            Self::ZoomStep { .. } => "zoom_step",
            Self::ZoomSpeed { .. } => "zoom_speed",
            Self::ZoomReset => "zoom_reset",
            Self::Focus { .. } => "focus",
            Self::Photo => "photo",
            Self::RecordStart => "record_start",
            Self::RecordStop => "record_stop",
            Self::VideoMode { .. } => "video_mode",
            Self::ThermalGain { .. } => "thermal_gain",
            Self::ThermalPalette { .. } => "thermal_palette",
            Self::MeasurePoint { .. } => "measure_point",
            Self::AiSelectBox { .. } => "ai_select_box",
            Self::AiSelectPoint { .. } => "ai_select_point",
            Self::AiCancel => "ai_cancel",
            Self::Encoding { .. } => "encoding",
            Self::SyncClock => "sync_clock",
        }
    }

    /// Range checks on the payload (the server answers 400 with the field name).
    pub fn validate(&self) -> Result<(), ProfileError> {
        let unit = |field: &str, v: f32| {
            if v.is_finite() && (0.0..=1.0).contains(&v) {
                Ok(())
            } else {
                Err(ProfileError {
                    field: field.into(),
                    message: "must be 0-1".into(),
                })
            }
        };
        match self {
            Self::MeasurePoint { x, y } | Self::AiSelectPoint { x, y } => {
                unit("x", *x)?;
                unit("y", *y)
            }
            Self::AiSelectBox { x, y, box_px } => {
                unit("x", *x)?;
                unit("y", *y)?;
                match box_px {
                    Some(b) if !(AI_BOX_PX_RANGE.0..=AI_BOX_PX_RANGE.1).contains(b) => Err(ProfileError {
                        field: "box_px".into(),
                        message: "must be 32-600".into(),
                    }),
                    _ => Ok(()),
                }
            }
            Self::ThermalPalette { palette } if !MT11_PALETTES.contains(palette) => Err(ProfileError {
                field: "palette".into(),
                message: "must be 0 or 2-11".into(),
            }),
            _ => Ok(()),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, rename_all = "snake_case")]
pub enum RecordingState {
    Idle,
    Recording,
    NoCard,
    CardError,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct GimbalAttitude {
    pub yaw: f32,
    pub pitch: f32,
    pub roll: f32,
    #[ts(type = "number")]
    pub age_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Firmware {
    pub camera: String,
    pub gimbal: String,
    pub zoom: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CameraState {
    pub connected: bool,
    pub last_error: Option<String>,
    pub firmware: Option<Firmware>,
    pub recording: RecordingState,
    pub zoom: f32,
    pub zoom_max: f32,
    pub video_mode: Option<VideoMode>,
    pub gimbal: Option<GimbalAttitude>,
    pub gimbal_mode: Option<GimbalMode>,
    /// Main-stream resolution once known (0x20); UI normalises pixel coordinates with it.
    pub stream: Option<(u16, u16)>,
    pub encoding: Option<EncodingInfo>,
    pub thermal: Option<ThermalState>,
    pub track: Option<TrackState>,
    pub candidates: Vec<Detection>,
    pub ai_ack: Option<AiAck>,
    pub storage: Option<StorageInfo>,
    pub clock: Option<CameraClock>,
}

impl CameraState {
    pub fn disconnected(zoom_max: f32) -> Self {
        Self {
            connected: false,
            last_error: None,
            firmware: None,
            recording: RecordingState::Idle,
            zoom: 1.0,
            zoom_max,
            video_mode: None,
            gimbal: None,
            gimbal_mode: None,
            stream: None,
            encoding: None,
            thermal: None,
            track: None,
            candidates: Vec::new(),
            ai_ack: None,
            storage: None,
            clock: None,
        }
    }
}

/// One entry of the WebSocket snapshot.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CameraSnapshot {
    pub sysid: SysId,
    pub caps: CameraCaps,
    pub state: CameraState,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, rename_all = "snake_case")]
pub enum VideoSource {
    Mt11,
    None,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, rename_all = "snake_case")]
pub enum VideoSourceMode {
    Auto,
    Mt11,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct VideoSourceStatus {
    pub mode: VideoSourceMode,
    pub source: VideoSource,
    pub scanning: bool,
    pub probe_ok: bool,
    /// MediaMTX path the WHEP relay forwards to.
    pub whep_path: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, rename_all = "snake_case")]
pub enum Deadman {
    Ok,
    Lost,
}

/// Per-vehicle camera configuration. Stored as one row per sysid.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CameraProfile {
    pub sysid: SysId,
    pub kind: CameraKind,
    /// IPv4 dotted address (also used to build the RTSP URL).
    pub host: String,
    pub port: u16,
    /// `{host}` is expanded for MT11; arbitrary for MAVLink cameras.
    pub rtsp_url: String,
    pub comp_id: u8,
    pub video_source_mode: VideoSourceMode,
    pub android_url: String,
    pub encoding_preset: String,
    pub thermal_palette: u8,
    pub thermal_overlay: bool,
    pub ai_box_px: u16,
    pub clock_sync: bool,
    pub auto_record: bool,
}

/// The RTSP host must be the camera itself. Parsed with the same `url` parser the probe uses
/// (no hand-rolled authority splitting), with userinfo refused outright.
fn rtsp_targets_camera(resolved_url: &str, host: &str) -> bool {
    let Ok(u) = url::Url::parse(resolved_url) else {
        return false;
    };
    u.scheme() == "rtsp" && u.username().is_empty() && u.password().is_none() && u.host_str() == Some(host)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProfileError {
    pub field: String,
    pub message: String,
}

impl std::fmt::Display for ProfileError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.field, self.message)
    }
}

impl CameraProfile {
    pub fn default_for(sysid: SysId) -> Self {
        Self {
            sysid,
            kind: CameraKind::None,
            host: "192.168.144.25".into(),
            port: 37260,
            rtsp_url: "rtsp://{host}:8554/video1".into(),
            comp_id: 100,
            video_source_mode: VideoSourceMode::Auto,
            android_url: "http://127.0.0.1:8080".into(),
            encoding_preset: "h264_1080p".into(),
            thermal_palette: 3,
            thermal_overlay: true,
            ai_box_px: 100,
            clock_sync: true,
            auto_record: true,
        }
    }

    /// True when a connection field differs: only those need the driver rebuilt.
    pub fn needs_reload(&self, other: &Self) -> bool {
        self.kind != other.kind
            || self.host != other.host
            || self.port != other.port
            || self.rtsp_url != other.rtsp_url
            || self.comp_id != other.comp_id
            || self.video_source_mode != other.video_source_mode
            || self.android_url != other.android_url
            || self.clock_sync != other.clock_sync
    }

    pub fn rtsp_url_resolved(&self) -> String {
        self.rtsp_url.replace("{host}", &self.host)
    }

    /// Range / format checks; the first failing field is reported.
    pub fn validate(&self) -> Result<(), ProfileError> {
        let err = |field: &str, message: &str| {
            Err(ProfileError {
                field: field.into(),
                message: message.into(),
            })
        };
        if self.host.parse::<std::net::Ipv4Addr>().is_err() {
            return err("host", "must be an IPv4 address");
        }
        if self.port == 0 {
            return err("port", "must be 1-65535");
        }
        if !self.rtsp_url.starts_with("rtsp://") {
            return err("rtsp_url", "must start with rtsp://");
        }
        if !rtsp_targets_camera(&self.rtsp_url_resolved(), &self.host) {
            return err("rtsp_url", "host must be {host} or the camera's address");
        }
        if self.comp_id == 0 {
            return err("comp_id", "must be 1-255");
        }
        if !(32..=600).contains(&self.ai_box_px) {
            return err("ai_box_px", "must be 32-600");
        }
        if !(self.thermal_palette == 0 || (2..=11).contains(&self.thermal_palette)) {
            return err("thermal_palette", "must be 0 or 2-11");
        }
        Ok(())
    }
}

/// Joystick axis functions for the gimbal profile (zoom functions arrive with P3).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, rename_all = "snake_case")]
pub enum AxisFunction {
    None,
    Pan,
    Tilt,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, rename_all = "snake_case")]
pub enum ButtonFunction {
    None,
    Shutter,
    RecordToggle,
    CenterGimbal,
    ThermalToggle,
    GimbalStop,
    ZoomInStep,
    ZoomOutStep,
    #[serde(rename = "zoom_1x")]
    #[ts(rename = "zoom_1x")]
    Zoom1x,
    ModeLock,
    ModeFollow,
    ModeFpv,
    ModeCycle,
    #[serde(rename = "roi_1")]
    #[ts(rename = "roi_1")]
    Roi1,
    #[serde(rename = "roi_2")]
    #[ts(rename = "roi_2")]
    Roi2,
    #[serde(rename = "roi_3")]
    #[ts(rename = "roi_3")]
    Roi3,
    #[serde(rename = "roi_4")]
    #[ts(rename = "roi_4")]
    Roi4,
    #[serde(rename = "roi_5")]
    #[ts(rename = "roi_5")]
    Roi5,
    #[serde(rename = "roi_6")]
    #[ts(rename = "roi_6")]
    Roi6,
    #[serde(rename = "roi_7")]
    #[ts(rename = "roi_7")]
    Roi7,
    #[serde(rename = "roi_8")]
    #[ts(rename = "roi_8")]
    Roi8,
    #[serde(rename = "roi_9")]
    #[ts(rename = "roi_9")]
    Roi9,
    #[serde(rename = "roi_10")]
    #[ts(rename = "roi_10")]
    Roi10,
    RoiStop,
    ThermalGainToggle,
    AiTrackingToggle,
    FocusNear,
    FocusFar,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AxisMapping {
    pub axis: u8,
    #[serde(rename = "fn")]
    #[ts(rename = "fn")]
    pub func: AxisFunction,
    /// 0–0.5
    pub deadzone: f32,
    pub invert: bool,
    /// 0.1–2
    pub scale: f32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ButtonMapping {
    pub button: u8,
    #[serde(rename = "fn")]
    #[ts(rename = "fn")]
    pub func: ButtonFunction,
}

/// Browser-side gamepad → gimbal profile.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct GimbalInputProfile {
    pub device_id: Option<String>,
    pub axes: Vec<AxisMapping>,
    pub buttons: Vec<ButtonMapping>,
    /// 1–100, yaw rate at full deflection.
    pub max_pan_speed: f32,
    /// 1–100, pitch rate at full deflection.
    pub max_tilt_speed: f32,
}

impl Default for GimbalInputProfile {
    fn default() -> Self {
        let axis = |axis: u8, func: AxisFunction, invert: bool| AxisMapping {
            axis,
            func,
            deadzone: 0.08,
            invert,
            scale: 1.0,
        };
        let button = |button: u8, func: ButtonFunction| ButtonMapping { button, func };
        Self {
            device_id: None,
            axes: vec![
                axis(0, AxisFunction::Pan, false),
                axis(1, AxisFunction::Tilt, true),
            ],
            buttons: vec![
                button(0, ButtonFunction::RecordToggle),
                button(1, ButtonFunction::Shutter),
                button(2, ButtonFunction::CenterGimbal),
                button(3, ButtonFunction::ThermalToggle),
            ],
            max_pan_speed: 30.0,
            max_tilt_speed: 20.0,
        }
    }
}

impl GimbalInputProfile {
    pub fn validate(&self) -> Result<(), ProfileError> {
        let err = |field: String, message: &str| {
            Err(ProfileError {
                field,
                message: message.into(),
            })
        };
        for (name, v) in [
            ("max_pan_speed", self.max_pan_speed),
            ("max_tilt_speed", self.max_tilt_speed),
        ] {
            if !(1.0..=100.0).contains(&v) {
                return err(name.into(), "must be 1-100");
            }
        }
        for (i, a) in self.axes.iter().enumerate() {
            if !(0.0..=0.5).contains(&a.deadzone) {
                return err(format!("axes[{i}].deadzone"), "must be 0-0.5");
            }
            if !(0.1..=2.0).contains(&a.scale) {
                return err(format!("axes[{i}].scale"), "must be 0.1-2");
            }
        }
        Ok(())
    }
}

#[cfg(test)]
#[path = "camera_tests.rs"]
mod tests;
