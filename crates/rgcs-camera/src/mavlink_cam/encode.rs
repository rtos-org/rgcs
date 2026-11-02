//! `CameraCommand` → MAVLink frames (plan "Fixed values"). Camera commands and ROI wait for a
//! COMMAND_ACK (`Encoded::Command`); `GIMBAL_MANAGER_SET_PITCHYAW` has none (`Message`).

use mavlink::dialects::ardupilotmega::{
    GimbalManagerFlags, MavCmd, MavFrame, MavMessage, COMMAND_INT_DATA, COMMAND_LONG_DATA,
    GIMBAL_MANAGER_SET_PITCHYAW_DATA,
};
use rgcs_core::{CameraCommand, CenterMode, SysId, VideoMode};

use crate::CameraError;

/// Full-stick gimbal rate (°/s) for `GimbalRate` ±100.
pub const MAVLINK_GIMBAL_MAX_RATE_DPS: f32 = 90.0;
/// One `ZoomStep` moves the zoom by this many percent of the range.
pub const ZOOM_STEP_PCT: f32 = 10.0;
const ZOOM_TYPE_CONTINUOUS: f32 = 1.0;
const ZOOM_TYPE_RANGE: f32 = 2.0;
const FOCUS_TYPE_CONTINUOUS: f32 = 1.0;
const ALL_COMPONENTS: u8 = 0;

/// Where commands go: the camera as (compid, camera device id), the gimbal manager as
/// (compid, gimbal device id, pitch range in degrees).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Targets {
    pub sysid: SysId,
    pub camera: Option<(u8, u8)>,
    pub gimbal: Option<(u8, u8, (f32, f32))>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Encoded {
    /// Fire and forget.
    Message(MavMessage),
    /// Sent once; the caller waits for the COMMAND_ACK of `ack_for`.
    Command { message: MavMessage, ack_for: MavCmd },
}

/// `zoom_pct` is the current zoom (%), the base of a `ZoomStep`.
pub fn encode(cmd: &CameraCommand, t: &Targets, zoom_pct: f32) -> Result<Vec<Encoded>, CameraError> {
    use CameraCommand as C;
    match cmd {
        C::GimbalRate { yaw, pitch } => gimbal_rate(cmd, t, *yaw, *pitch),
        C::GimbalAngle { yaw_deg, pitch_deg } => gimbal_angle(cmd, t, *yaw_deg, *pitch_deg),
        C::GimbalCenter { mode } => center(cmd, t, *mode),
        C::VideoMode { mode: VideoMode::Rgb } => Ok(Vec::new()),
        C::Photo | C::RecordStart | C::RecordStop | C::Focus { .. } => capture(cmd, t),
        C::ZoomAbsolute { .. } | C::ZoomStep { .. } | C::ZoomSpeed { .. } | C::ZoomReset => {
            zoom(cmd, t, zoom_pct)
        }
        _ => Err(CameraError::Unsupported(cmd.name())),
    }
}

fn capture(cmd: &CameraCommand, t: &Targets) -> Result<Vec<Encoded>, CameraError> {
    let (compid, dev) = camera(cmd, t)?;
    let d = f32::from(dev);
    let (command, params) = match cmd {
        CameraCommand::Photo => (MavCmd::MAV_CMD_IMAGE_START_CAPTURE, [d, 0.0, 1.0, 0.0]),
        CameraCommand::RecordStart => (MavCmd::MAV_CMD_VIDEO_START_CAPTURE, [0.0, 0.0, d, 0.0]),
        CameraCommand::RecordStop => (MavCmd::MAV_CMD_VIDEO_STOP_CAPTURE, [0.0, d, 0.0, 0.0]),
        CameraCommand::Focus { dir } => (
            MavCmd::MAV_CMD_SET_CAMERA_FOCUS,
            [FOCUS_TYPE_CONTINUOUS, f32::from(dir.signum()), d, 0.0],
        ),
        _ => return Err(CameraError::Unsupported(cmd.name())),
    };
    Ok(vec![acked_long(t.sysid, compid, command, params)])
}

fn zoom(cmd: &CameraCommand, t: &Targets, zoom_pct: f32) -> Result<Vec<Encoded>, CameraError> {
    let (compid, dev) = camera(cmd, t)?;
    let current = if zoom_pct.is_finite() { zoom_pct } else { 0.0 };
    let (kind, value) = match cmd {
        CameraCommand::ZoomAbsolute { zoom } => (ZOOM_TYPE_RANGE, clamp_pct(*zoom)),
        CameraCommand::ZoomStep { steps } => (
            ZOOM_TYPE_RANGE,
            clamp_pct(current + ZOOM_STEP_PCT * f32::from(steps.signum())),
        ),
        CameraCommand::ZoomSpeed { dir } => (ZOOM_TYPE_CONTINUOUS, f32::from(dir.signum())),
        CameraCommand::ZoomReset => (ZOOM_TYPE_RANGE, 0.0),
        _ => return Err(CameraError::Unsupported(cmd.name())),
    };
    let params = [kind, value, f32::from(dev), 0.0];
    Ok(vec![acked_long(
        t.sysid,
        compid,
        MavCmd::MAV_CMD_SET_CAMERA_ZOOM,
        params,
    )])
}

fn clamp_pct(v: f32) -> f32 {
    if v.is_finite() {
        v.clamp(0.0, 100.0)
    } else {
        0.0
    }
}

fn gimbal_rate(cmd: &CameraCommand, t: &Targets, yaw: i8, pitch: i8) -> Result<Vec<Encoded>, CameraError> {
    let g = gimbal(cmd, t)?;
    let rate = |v: i8| (f32::from(v.clamp(-100, 100)) / 100.0 * MAVLINK_GIMBAL_MAX_RATE_DPS).to_radians();
    Ok(vec![pitchyaw(
        t.sysid,
        g,
        f32::NAN,
        f32::NAN,
        rate(pitch),
        rate(yaw),
    )])
}

/// `yaw_deg` is SIYI +left; MAVLink yaw is +right.
fn gimbal_angle(
    cmd: &CameraCommand,
    t: &Targets,
    yaw_deg: f32,
    pitch_deg: f32,
) -> Result<Vec<Encoded>, CameraError> {
    let g = gimbal(cmd, t)?;
    let (lo, hi) = g.2;
    let pitch = pitch_deg.clamp(lo, hi).to_radians();
    Ok(vec![pitchyaw(
        t.sysid,
        g,
        pitch,
        (-yaw_deg).to_radians(),
        f32::NAN,
        f32::NAN,
    )])
}

fn center(cmd: &CameraCommand, t: &Targets, mode: CenterMode) -> Result<Vec<Encoded>, CameraError> {
    let (_, _, (pitch_min, _)) = gimbal(cmd, t)?;
    let pitch = match mode {
        CenterMode::Center | CenterMode::OneKeyReset => 0.0,
        CenterMode::FaceDown | CenterMode::CenterFaceDown => pitch_min,
    };
    gimbal_angle(cmd, t, 0.0, pitch)
}

/// Native ROI location: COMMAND_INT, MSL, p1 = the gimbal device id (never 0, which
/// would turn the whole vehicle).
pub fn roi_location(t: &Targets, lat: f64, lon: f64, alt_msl: f64) -> Result<Encoded, CameraError> {
    let (compid, dev) = roi_gimbal(t)?;
    let message = MavMessage::COMMAND_INT(COMMAND_INT_DATA {
        param1: f32::from(dev),
        param2: 0.0,
        param3: 0.0,
        param4: 0.0,
        x: (lat * 1e7).round() as i32,
        y: (lon * 1e7).round() as i32,
        z: alt_msl as f32,
        command: MavCmd::MAV_CMD_DO_SET_ROI_LOCATION,
        target_system: t.sysid,
        target_component: compid,
        frame: MavFrame::MAV_FRAME_GLOBAL,
        current: 0,
        autocontinue: 0,
    });
    Ok(Encoded::Command {
        message,
        ack_for: MavCmd::MAV_CMD_DO_SET_ROI_LOCATION,
    })
}

pub fn roi_none(t: &Targets) -> Result<Encoded, CameraError> {
    let (compid, dev) = roi_gimbal(t)?;
    let params = [f32::from(dev), 0.0, 0.0, 0.0];
    Ok(acked_long(
        t.sysid,
        compid,
        MavCmd::MAV_CMD_DO_SET_ROI_NONE,
        params,
    ))
}

fn roi_gimbal(t: &Targets) -> Result<(u8, u8), CameraError> {
    match t.gimbal {
        Some((compid, dev, _)) if dev != 0 => Ok((compid, dev)),
        _ => Err(CameraError::Unsupported("roi")),
    }
}

/// `MAV_CMD_REQUEST_MESSAGE` to every component of `sysid` (fire and forget).
pub fn request_message(sysid: SysId, msg_id: u32) -> MavMessage {
    command_long(
        sysid,
        ALL_COMPONENTS,
        MavCmd::MAV_CMD_REQUEST_MESSAGE,
        [msg_id as f32, 0.0, 0.0, 0.0],
    )
}

pub fn message_interval(sysid: SysId, compid: u8, msg_id: u32, interval_us: u32) -> MavMessage {
    let params = [msg_id as f32, interval_us as f32, 0.0, 0.0];
    command_long(sysid, compid, MavCmd::MAV_CMD_SET_MESSAGE_INTERVAL, params)
}

fn camera(cmd: &CameraCommand, t: &Targets) -> Result<(u8, u8), CameraError> {
    t.camera.ok_or(CameraError::Unsupported(cmd.name()))
}

fn gimbal(cmd: &CameraCommand, t: &Targets) -> Result<(u8, u8, (f32, f32)), CameraError> {
    t.gimbal.ok_or(CameraError::Unsupported(cmd.name()))
}

/// A COMMAND_LONG that waits for its ACK.
fn acked_long(sysid: SysId, compid: u8, command: MavCmd, p: [f32; 4]) -> Encoded {
    Encoded::Command {
        message: command_long(sysid, compid, command, p),
        ack_for: command,
    }
}

fn command_long(sysid: SysId, compid: u8, command: MavCmd, p: [f32; 4]) -> MavMessage {
    MavMessage::COMMAND_LONG(COMMAND_LONG_DATA {
        param1: p[0],
        param2: p[1],
        param3: p[2],
        param4: p[3],
        param5: 0.0,
        param6: 0.0,
        param7: 0.0,
        command,
        target_system: sysid,
        target_component: compid,
        confirmation: 0,
    })
}

fn pitchyaw(
    sysid: SysId,
    g: (u8, u8, (f32, f32)),
    pitch: f32,
    yaw: f32,
    pitch_rate: f32,
    yaw_rate: f32,
) -> Encoded {
    Encoded::Message(MavMessage::GIMBAL_MANAGER_SET_PITCHYAW(
        GIMBAL_MANAGER_SET_PITCHYAW_DATA {
            flags: GimbalManagerFlags::empty(),
            pitch,
            yaw,
            pitch_rate,
            yaw_rate,
            target_system: sysid,
            target_component: g.0,
            gimbal_device_id: g.1,
        },
    ))
}

#[cfg(test)]
#[path = "encode_tests.rs"]
mod tests;
