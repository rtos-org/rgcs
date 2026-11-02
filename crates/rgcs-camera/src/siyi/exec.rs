//! One `CameraCommand` → wire frames, with the capability refusals.

use std::time::{Duration, Instant};

use rgcs_core::{
    mt11_encoding_presets, CameraCommand, CameraState, RecordingState, ThermalGain, VideoMode,
    AI_BOX_PX_DEFAULT,
};
use tokio::sync::watch;

use crate::siyi::ai::{self, ClickError, DETECTION_LOOKBACK};
use crate::siyi::apply::{Media, PendingEncoding};
use crate::siyi::client::Link;
use crate::siyi::encode;
use crate::CameraError;

/// 0x55 (AI mode on) needs this long before a 0x56 select is accepted (`video_routes.py`).
const AI_MODE_SETTLE: Duration = Duration::from_millis(100);

/// One command → one or more wire frames; re-reads what the camera changed.
/// `Encoding` leaves the 0x20 re-reads to the session (300 ms later, then every poll second
/// while the stream is unknown) and records the size it waits for.
pub(crate) async fn exec(
    link: &mut Link<'_>,
    state: &watch::Sender<CameraState>,
    media: &Media,
    cmd: CameraCommand,
) -> Result<Media, CameraError> {
    use CameraCommand::*;
    let snap = state.borrow().clone();
    match cmd {
        GimbalRate { yaw, pitch } => link.udp(0x07, &encode::gimbal_rate(yaw, pitch)).await,
        GimbalAngle { yaw_deg, pitch_deg } => link.udp(0x0E, &encode::gimbal_angle(yaw_deg, pitch_deg)).await,
        GimbalCenter { mode } => link.udp(0x08, &encode::center(mode)).await,
        GimbalMode { mode } => two(link, (0x0C, &encode::gimbal_mode(mode)), (0x19, &[])).await,
        ZoomAbsolute { zoom } => zoom_to(link, zoom, snap.zoom_max).await,
        ZoomStep { steps } => zoom_to(link, snap.zoom + f32::from(steps), snap.zoom_max).await,
        ZoomReset => zoom_to(link, 1.0, snap.zoom_max).await,
        ZoomSpeed { dir } => link.tcp(0x05, &encode::zoom_speed(dir)).await,
        Focus { dir } => link.tcp(0x06, &encode::focus(dir)).await,
        Photo => link.tcp(0x0C, &encode::photo()).await,
        RecordStart => record(link, snap.recording != RecordingState::Recording).await,
        RecordStop => record(link, snap.recording == RecordingState::Recording).await,
        VideoMode { mode } => video_mode(link, &snap, mode).await,
        ThermalGain { gain } => thermal_gain(link, gain).await,
        ThermalPalette { palette } => link.tcp(0x1B, &encode::thermal_palette(palette)).await,
        MeasurePoint { x, y } => measure_point(link, &snap, x, y).await,
        AiSelectBox { x, y, box_px } => ai_select_box(link, &snap, x, y, box_px).await,
        AiSelectPoint { x, y } => ai_select_point(link, &snap, media, x, y).await,
        AiCancel => link.tcp(0x56, &ai::encode_ai_select(None)).await,
        Encoding { preset } => {
            let size = set_encoding(link, state, &preset).await?;
            let pending_encoding = Some(PendingEncoding {
                size,
                since: Instant::now(),
            });
            return Ok(Media {
                pending_encoding,
                ..media.clone()
            });
        }
        SyncClock => {
            return Ok(Media {
                clock: media.clock.request(),
                ..media.clone()
            })
        }
    }?;
    Ok(media.clone())
}

async fn two(link: &mut Link<'_>, a: (u8, &[u8]), b: (u8, &[u8])) -> Result<(), CameraError> {
    link.tcp(a.0, a.1).await?;
    link.tcp(b.0, b.1).await
}

pub(crate) async fn zoom_to(link: &mut Link<'_>, zoom: f32, max: f32) -> Result<(), CameraError> {
    link.tcp(0x0F, &encode::zoom_absolute(zoom, max)).await?;
    link.tcp(0x18, &[]).await
}

/// The SDK only has a toggle; send it only when the current state differs (Review Focus 5).
pub(crate) async fn record(link: &mut Link<'_>, toggle: bool) -> Result<(), CameraError> {
    if toggle {
        link.tcp(0x0C, &encode::record_toggle()).await?;
    }
    link.tcp(0x0A, &[]).await
}

/// IR / 2画面 cannot track (40 §3.1): an active track is cancelled first.
async fn video_mode(link: &mut Link<'_>, snap: &CameraState, mode: VideoMode) -> Result<(), CameraError> {
    if mode != VideoMode::Rgb && snap.track.is_some() {
        link.tcp(0x56, &ai::encode_ai_select(None)).await?;
    }
    two(link, (0x11, &encode::video_mode(mode)), (0x10, &[])).await
}

async fn thermal_gain(link: &mut Link<'_>, gain: ThermalGain) -> Result<(), CameraError> {
    two(link, (0x38, &encode::thermal_gain(gain)), (0x37, &[])).await
}

fn stream_of(snap: &CameraState) -> Result<(u16, u16), CameraError> {
    snap.stream
        .filter(|&(w, h)| ai::usable_stream(w, h))
        .ok_or(CameraError::Refused("stream_unknown"))
}

fn require_mode(snap: &CameraState, mode: VideoMode, code: &'static str) -> Result<(), CameraError> {
    if snap.video_mode == Some(mode) {
        Ok(())
    } else {
        Err(CameraError::Refused(code))
    }
}

async fn measure_point(link: &mut Link<'_>, snap: &CameraState, x: f32, y: f32) -> Result<(), CameraError> {
    require_mode(snap, VideoMode::Thermal, "thermal_only")?;
    let (w, h) = stream_of(snap)?;
    let (px, py) = ai::normalized_to_stream_point(x, y, w, h);
    link.tcp(0x12, &encode::point_temp(px, py)).await
}

/// 0x55 on, a short settle, then the 0x56 selection.
async fn ai_select(link: &mut Link<'_>, payload: [u8; 9]) -> Result<(), CameraError> {
    link.tcp(0x55, &ai::ai_mode(true)).await?;
    tokio::time::sleep(AI_MODE_SETTLE).await;
    link.tcp(0x56, &payload).await
}

async fn ai_select_box(
    link: &mut Link<'_>,
    snap: &CameraState,
    x: f32,
    y: f32,
    box_px: Option<u16>,
) -> Result<(), CameraError> {
    ai_select(link, box_payload(snap, x, y, box_px)?).await
}

/// Ctrl+click: the detection under the click in the last second, else the click itself.
async fn ai_select_point(
    link: &mut Link<'_>,
    snap: &CameraState,
    media: &Media,
    x: f32,
    y: f32,
) -> Result<(), CameraError> {
    ai_select(link, point_payload(snap, media, x, y)?).await
}

/// The 0x56 payload of a box select, or the refusal (RGB only, stream known, box in frame).
fn box_payload(snap: &CameraState, x: f32, y: f32, box_px: Option<u16>) -> Result<[u8; 9], CameraError> {
    require_mode(snap, VideoMode::Rgb, "rgb_only")?;
    let (w, h) = stream_of(snap)?;
    let b = ai::click_to_stream_box(x, y, w, h, box_px.unwrap_or(AI_BOX_PX_DEFAULT)).map_err(click_error)?;
    Ok(ai::encode_ai_select(Some(b)))
}

/// The 0x56 payload of a point select, or the refusal (RGB only, stream known, a detection).
fn point_payload(snap: &CameraState, media: &Media, x: f32, y: f32) -> Result<[u8; 9], CameraError> {
    require_mode(snap, VideoMode::Rgb, "rgb_only")?;
    let (w, h) = stream_of(snap)?;
    let (nx, ny) = point_target(media, Instant::now(), x, y)?;
    let (px, py) = ai::normalized_to_stream_point(nx, ny, w, h);
    Ok(ai::encode_ai_select_point(px, py))
}

/// The refusal `exec` would return for `cmd`, without sending anything (so
/// the server stops ROI for an AI select only once the select can go out).
pub(crate) fn check(snap: &CameraState, media: &Media, cmd: &CameraCommand) -> Result<(), CameraError> {
    match *cmd {
        CameraCommand::AiSelectBox { x, y, box_px } => box_payload(snap, x, y, box_px).map(|_| ()),
        CameraCommand::AiSelectPoint { x, y } => point_payload(snap, media, x, y).map(|_| ()),
        CameraCommand::MeasurePoint { .. } => {
            require_mode(snap, VideoMode::Thermal, "thermal_only")?;
            stream_of(snap).map(|_| ())
        }
        _ => Ok(()),
    }
}

/// The normalized point a Ctrl+click selects: a recent detection's centre, or the click.
pub(crate) fn point_target(media: &Media, now: Instant, x: f32, y: f32) -> Result<(f32, f32), CameraError> {
    let recent: Vec<&ai::DetectionFrame> = media
        .history
        .iter()
        .filter(|(t, _)| now.saturating_duration_since(*t) <= DETECTION_LOOKBACK)
        .map(|(_, f)| f)
        .collect();
    if recent.is_empty() {
        return Ok((x, y));
    }
    let d = ai::pick_detection(&recent, x, y).ok_or(CameraError::Refused("no_detection"))?;
    Ok(((d.x0 + d.x1) / 2.0, (d.y0 + d.y1) / 2.0))
}

fn click_error(e: ClickError) -> CameraError {
    match e {
        ClickError::StreamUnknown => CameraError::Refused("stream_unknown"),
        ClickError::OutOfRange => CameraError::Protocol("click outside the frame".into()),
    }
}

/// 0x21 for a preset; returns the requested size. The resolution is unknown until 0x20
/// reports that size (Review Focus 4).
async fn set_encoding(
    link: &mut Link<'_>,
    state: &watch::Sender<CameraState>,
    preset: &str,
) -> Result<(u16, u16), CameraError> {
    let p = mt11_encoding_presets()
        .into_iter()
        .find(|p| p.id == preset)
        .ok_or(CameraError::Unsupported("encoding preset"))?;
    state.send_modify(|s| {
        *s = CameraState {
            stream: None,
            encoding: None,
            ..s.clone()
        }
    });
    link.tcp(0x21, &ai::encode_encoding(&p)).await?;
    Ok((p.width, p.height))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rgb(stream: Option<(u16, u16)>) -> CameraState {
        CameraState {
            connected: true,
            video_mode: Some(VideoMode::Rgb),
            stream,
            ..CameraState::disconnected(30.0)
        }
    }

    const BOX: CameraCommand = CameraCommand::AiSelectBox {
        x: 0.5,
        y: 0.5,
        box_px: None,
    };

    #[test]
    fn check_reports_the_refusals_send_would_give() {
        let media = Media::default();
        assert_eq!(check(&rgb(Some((1920, 1080))), &media, &BOX), Ok(()));
        assert_eq!(
            check(&rgb(None), &media, &BOX),
            Err(CameraError::Refused("stream_unknown"))
        );
        let ir = CameraState {
            video_mode: Some(VideoMode::Thermal),
            ..rgb(Some((1920, 1080)))
        };
        assert_eq!(check(&ir, &media, &BOX), Err(CameraError::Refused("rgb_only")));
        let point = CameraCommand::AiSelectPoint { x: 0.5, y: 0.5 };
        assert_eq!(check(&ir, &media, &point), Err(CameraError::Refused("rgb_only")));
        assert_eq!(check(&rgb(None), &media, &CameraCommand::ZoomReset), Ok(()));
    }

    /// A degenerate size never maps a click onto pixel (0, 0).
    #[test]
    fn degenerate_stream_is_unknown() {
        let media = Media::default();
        let point = CameraCommand::AiSelectPoint { x: 0.5, y: 0.5 };
        for s in [(0, 1080), (1920, 0), (1, 1)] {
            assert_eq!(
                check(&rgb(Some(s)), &media, &point),
                Err(CameraError::Refused("stream_unknown")),
                "{s:?}"
            );
            let ir = CameraState {
                video_mode: Some(VideoMode::Thermal),
                ..rgb(Some(s))
            };
            let measure = CameraCommand::MeasurePoint { x: 0.5, y: 0.5 };
            assert_eq!(
                check(&ir, &media, &measure),
                Err(CameraError::Refused("stream_unknown")),
                "{s:?}"
            );
        }
    }

    #[tokio::test]
    async fn offline_driver_check_is_not_connected() {
        use crate::{siyi::client::SiyiMt11, Camera};
        let cam = SiyiMt11::new(std::net::Ipv4Addr::LOCALHOST, 9);
        assert_eq!(cam.check(&BOX).await, Err(CameraError::NotConnected));
    }
}
