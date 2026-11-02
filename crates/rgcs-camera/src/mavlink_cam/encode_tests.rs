use super::*;
use mavlink::dialects::ardupilotmega::{
    GimbalManagerFlags, MavFrame, COMMAND_INT_DATA, COMMAND_LONG_DATA, GIMBAL_MANAGER_SET_PITCHYAW_DATA,
};
use rgcs_core::{CameraCommand as C, CenterMode, GimbalMode, ThermalGain, VideoMode};
use std::f32::consts::{FRAC_PI_2, FRAC_PI_4, FRAC_PI_6};

const T: Targets = Targets {
    sysid: 1,
    camera: Some((1, 1)),
    gimbal: Some((1, 1, (-90.0, 30.0))),
};

fn one(cmd: &C, zoom: f32) -> Encoded {
    let mut out = encode(cmd, &T, zoom).expect("encodes");
    assert_eq!(out.len(), 1, "{out:?}");
    out.remove(0)
}

fn long(e: Encoded) -> (COMMAND_LONG_DATA, MavCmd) {
    match e {
        Encoded::Command {
            message: MavMessage::COMMAND_LONG(d),
            ack_for,
        } => (d, ack_for),
        other => panic!("not a COMMAND_LONG command: {other:?}"),
    }
}

fn pitchyaw(e: Encoded) -> GIMBAL_MANAGER_SET_PITCHYAW_DATA {
    match e {
        Encoded::Message(MavMessage::GIMBAL_MANAGER_SET_PITCHYAW(d)) => d,
        other => panic!("not SET_PITCHYAW: {other:?}"),
    }
}

fn params(d: &COMMAND_LONG_DATA) -> [f32; 4] {
    [d.param1, d.param2, d.param3, d.param4]
}

fn near(a: f32, b: f32) -> bool {
    (a - b).abs() < 1e-6
}

#[test]
fn photo() {
    let (d, ack) = long(one(&C::Photo, 0.0));
    assert_eq!(d.command, MavCmd::MAV_CMD_IMAGE_START_CAPTURE);
    assert_eq!(ack, MavCmd::MAV_CMD_IMAGE_START_CAPTURE);
    assert_eq!((d.target_system, d.target_component), (1, 1));
    assert_eq!(params(&d), [1.0, 0.0, 1.0, 0.0]);
}

#[test]
fn record_start_stop() {
    let (d, ack) = long(one(&C::RecordStart, 0.0));
    assert_eq!(
        (d.command, ack),
        (
            MavCmd::MAV_CMD_VIDEO_START_CAPTURE,
            MavCmd::MAV_CMD_VIDEO_START_CAPTURE
        )
    );
    assert_eq!([d.param1, d.param2, d.param3], [0.0, 0.0, 1.0]);
    let (d, ack) = long(one(&C::RecordStop, 0.0));
    assert_eq!(
        (d.command, ack),
        (
            MavCmd::MAV_CMD_VIDEO_STOP_CAPTURE,
            MavCmd::MAV_CMD_VIDEO_STOP_CAPTURE
        )
    );
    assert_eq!([d.param1, d.param2], [0.0, 1.0]);
}

#[test]
fn zoom_absolute_clamps() {
    let (d, ack) = long(one(&C::ZoomAbsolute { zoom: 40.0 }, 0.0));
    assert_eq!(
        (d.command, ack),
        (MavCmd::MAV_CMD_SET_CAMERA_ZOOM, MavCmd::MAV_CMD_SET_CAMERA_ZOOM)
    );
    assert_eq!([d.param1, d.param2, d.param3], [2.0, 40.0, 1.0]);
    assert_eq!(long(one(&C::ZoomAbsolute { zoom: 140.0 }, 0.0)).0.param2, 100.0);
    assert_eq!(long(one(&C::ZoomAbsolute { zoom: -5.0 }, 0.0)).0.param2, 0.0);
}

#[test]
fn zoom_step_is_range() {
    let step = |steps: i8, at: f32| long(one(&C::ZoomStep { steps }, at)).0;
    let d = step(1, 40.0);
    assert_eq!([d.param1, d.param2, d.param3], [2.0, 50.0, 1.0]);
    assert_eq!(step(-1, 5.0).param2, 0.0);
    assert_eq!(step(3, 95.0).param2, 100.0);
    assert_eq!(step(1, f32::NAN).param2, 10.0);
}

#[test]
fn zoom_speed_and_reset() {
    let (d, _) = long(one(&C::ZoomSpeed { dir: -1 }, 40.0));
    assert_eq!([d.param1, d.param2, d.param3], [1.0, -1.0, 1.0]);
    let (d, _) = long(one(&C::ZoomReset, 40.0));
    assert_eq!([d.param1, d.param2, d.param3], [2.0, 0.0, 1.0]);
}

#[test]
fn focus_continuous() {
    let (d, ack) = long(one(&C::Focus { dir: 1 }, 0.0));
    assert_eq!(
        (d.command, ack),
        (MavCmd::MAV_CMD_SET_CAMERA_FOCUS, MavCmd::MAV_CMD_SET_CAMERA_FOCUS)
    );
    assert_eq!([d.param1, d.param2, d.param3], [1.0, 1.0, 1.0]);
}

#[test]
fn gimbal_rate() {
    let d = pitchyaw(one(&C::GimbalRate { yaw: 50, pitch: -100 }, 0.0));
    assert_eq!(
        (d.target_system, d.target_component, d.gimbal_device_id),
        (1, 1, 1)
    );
    assert_eq!(d.flags, GimbalManagerFlags::empty());
    assert!(d.pitch.is_nan() && d.yaw.is_nan());
    assert!(near(d.yaw_rate, FRAC_PI_4), "{}", d.yaw_rate);
    assert!(near(d.pitch_rate, -FRAC_PI_2), "{}", d.pitch_rate);
}

#[test]
fn gimbal_angle_negates_yaw_and_clamps_pitch() {
    let d = pitchyaw(one(
        &C::GimbalAngle {
            yaw_deg: 30.0,
            pitch_deg: -120.0,
        },
        0.0,
    ));
    assert!(near(d.yaw, -FRAC_PI_6), "{}", d.yaw);
    assert!(near(d.pitch, -FRAC_PI_2), "{}", d.pitch);
    assert!(d.yaw_rate.is_nan() && d.pitch_rate.is_nan());
    assert_eq!(d.flags, GimbalManagerFlags::empty());
}

#[test]
fn center_modes() {
    for mode in [CenterMode::Center, CenterMode::OneKeyReset] {
        let d = pitchyaw(one(&C::GimbalCenter { mode }, 0.0));
        assert!(near(d.yaw, 0.0) && near(d.pitch, 0.0), "{mode:?}");
    }
    for mode in [CenterMode::FaceDown, CenterMode::CenterFaceDown] {
        let d = pitchyaw(one(&C::GimbalCenter { mode }, 0.0));
        assert!(near(d.yaw, 0.0) && near(d.pitch, -FRAC_PI_2), "{mode:?}");
    }
}

#[test]
fn video_mode_rgb_is_noop() {
    assert_eq!(
        encode(&C::VideoMode { mode: VideoMode::Rgb }, &T, 0.0),
        Ok(vec![])
    );
    assert_eq!(
        encode(
            &C::VideoMode {
                mode: VideoMode::Thermal
            },
            &T,
            0.0
        ),
        Err(CameraError::Unsupported("video_mode"))
    );
}

#[test]
fn unsupported() {
    let cmds = [
        C::GimbalMode {
            mode: GimbalMode::Lock,
        },
        C::ThermalGain {
            gain: ThermalGain::High,
        },
        C::AiCancel,
        C::Encoding { preset: "x".into() },
        C::SyncClock,
    ];
    for cmd in cmds {
        assert_eq!(encode(&cmd, &T, 0.0), Err(CameraError::Unsupported(cmd.name())));
    }
}

#[test]
fn no_camera_binding() {
    let t = Targets { camera: None, ..T };
    assert_eq!(encode(&C::Photo, &t, 0.0), Err(CameraError::Unsupported("photo")));
    let t = Targets { gimbal: None, ..T };
    assert_eq!(
        encode(&C::GimbalRate { yaw: 1, pitch: 0 }, &t, 0.0),
        Err(CameraError::Unsupported("gimbal_rate"))
    );
}

#[test]
fn roi_location_command_int() {
    let e = roi_location(&T, 36.2509, 137.6385, 1600.0).expect("roi");
    let Encoded::Command {
        message: MavMessage::COMMAND_INT(d),
        ack_for,
    } = e
    else {
        panic!("not COMMAND_INT: {e:?}");
    };
    let want = COMMAND_INT_DATA {
        command: MavCmd::MAV_CMD_DO_SET_ROI_LOCATION,
        frame: MavFrame::MAV_FRAME_GLOBAL,
        target_system: 1,
        target_component: 1,
        param1: 1.0,
        x: 362_509_000,
        y: 1_376_385_000,
        z: 1600.0,
        current: 0,
        autocontinue: 0,
        ..d.clone()
    };
    assert_eq!(d, want);
    assert_eq!(ack_for, MavCmd::MAV_CMD_DO_SET_ROI_LOCATION);
}

#[test]
fn roi_never_uses_device_0() {
    let t = Targets {
        gimbal: Some((1, 0, (-90.0, 30.0))),
        ..T
    };
    assert_eq!(
        roi_location(&t, 1.0, 2.0, 3.0),
        Err(CameraError::Unsupported("roi"))
    );
    assert_eq!(roi_none(&t), Err(CameraError::Unsupported("roi")));
    let t = Targets { gimbal: None, ..T };
    assert_eq!(roi_none(&t), Err(CameraError::Unsupported("roi")));
}

#[test]
fn roi_none_long() {
    let (d, ack) = long(roi_none(&T).expect("roi none"));
    assert_eq!(
        (d.command, ack),
        (MavCmd::MAV_CMD_DO_SET_ROI_NONE, MavCmd::MAV_CMD_DO_SET_ROI_NONE)
    );
    assert_eq!((d.target_component, d.param1), (1, 1.0));
}

#[test]
fn requests() {
    let MavMessage::COMMAND_LONG(d) = request_message(1, 259) else {
        panic!("not COMMAND_LONG");
    };
    assert_eq!(d.command, MavCmd::MAV_CMD_REQUEST_MESSAGE);
    assert_eq!((d.target_system, d.target_component, d.param1), (1, 0, 259.0));
    let MavMessage::COMMAND_LONG(d) = message_interval(1, 1, 285, 100_000) else {
        panic!("not COMMAND_LONG");
    };
    assert_eq!(d.command, MavCmd::MAV_CMD_SET_MESSAGE_INTERVAL);
    assert_eq!((d.target_component, d.param1, d.param2), (1, 285.0, 100_000.0));
}
