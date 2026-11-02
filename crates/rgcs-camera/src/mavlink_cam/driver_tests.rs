use std::time::Duration;

use mavlink::dialects::ardupilotmega::{MavCmd, MavMessage, CAMERA_CAPTURE_STATUS_DATA};
use mavlink::MavHeader;
use rgcs_core::roi::RoiMode;
use rgcs_core::{CameraCommand, RecordingState, ZoomUnit};
use rgcs_mavlink::{MavPort, PayloadFrame, PAYLOAD_CAPACITY};
use tokio::sync::{broadcast, mpsc};
use tokio::time::{sleep, timeout};

use super::*;
use crate::mavlink_cam::binding::tests::{cam_info, manager_info};
use crate::mavlink_cam::fake::{FakeConfig, FakeMav};
use crate::{Camera, CameraError};

async fn started(cfg: FakeConfig) -> (FakeMav, MavlinkCamera) {
    let fake = FakeMav::start(1, cfg);
    let cam = MavlinkCamera::new(1, 100, fake.port());
    cam.connect().await.expect("connect");
    (fake, cam)
}

/// Waits (in 250 ms steps, at most `limit`) until `ok` holds.
async fn wait_for(limit: Duration, ok: impl Fn() -> bool) -> bool {
    let steps = limit.as_millis() / 250;
    for _ in 0..steps {
        if ok() {
            return true;
        }
        sleep(Duration::from_millis(250)).await;
    }
    ok()
}

async fn bound(cfg: FakeConfig) -> (FakeMav, MavlinkCamera) {
    let (fake, cam) = started(cfg).await;
    let st = cam.state();
    assert!(wait_for(Duration::from_secs(3), || st.borrow().connected).await);
    (fake, cam)
}

fn long_params(m: &MavMessage) -> Option<(MavCmd, f32, f32, u8)> {
    match m {
        MavMessage::COMMAND_LONG(d) => Some((d.command, d.param1, d.param2, d.target_component)),
        _ => None,
    }
}

fn info_requests(fake: &FakeMav) -> Vec<(f32, u8)> {
    fake.sent()
        .iter()
        .filter_map(long_params)
        .filter(|(c, ..)| *c == MavCmd::MAV_CMD_REQUEST_MESSAGE)
        .map(|(_, p1, _, tc)| (p1, tc))
        .collect()
}

fn interval_requests(fake: &FakeMav, msg_id: f32) -> Vec<(f32, u8)> {
    fake.sent()
        .iter()
        .filter_map(long_params)
        .filter(|(c, p1, ..)| *c == MavCmd::MAV_CMD_SET_MESSAGE_INTERVAL && *p1 == msg_id)
        .map(|(_, _, p2, tc)| (p2, tc))
        .collect()
}

fn count(fake: &FakeMav, cmd: MavCmd) -> usize {
    fake.commands().iter().filter(|c| **c == cmd).count()
}

#[tokio::test(start_paused = true)]
async fn binds_from_the_fake_within_3s() {
    let (_fake, cam) = bound(FakeConfig::default()).await;
    let caps = cam.caps();
    assert!(caps.photo && caps.record);
    assert_eq!(caps.zoom.expect("zoom").unit, ZoomUnit::Percent);
    let (pmin, pmax) = caps.gimbal.expect("gimbal").pitch_range;
    assert!(
        (pmin + 90.0).abs() < 1e-3 && (pmax - 30.0).abs() < 1e-3,
        "{pmin} {pmax}"
    );
    assert_eq!(caps.roi, RoiMode::Native);
    let st = cam.state().borrow().clone();
    assert!(st.connected);
    assert_eq!(st.firmware.expect("firmware").camera, "1.2.3");
}

#[tokio::test(start_paused = true)]
async fn asks_info_on_compid_0_until_bound() {
    let (fake, _cam) = bound(FakeConfig::default()).await;
    let asked = info_requests(&fake);
    assert!(asked.contains(&(259.0, 0)), "{asked:?}");
    assert!(asked.contains(&(280.0, 0)), "{asked:?}");
    sleep(Duration::from_secs(10)).await;
    assert_eq!(info_requests(&fake), asked);
}

#[tokio::test(start_paused = true)]
async fn requests_attitude_stream_when_missing() {
    let (fake, _cam) = bound(FakeConfig::default()).await;
    sleep(Duration::from_secs(10)).await;
    assert_eq!(interval_requests(&fake, 285.0), vec![(100_000.0, 1)]);

    let cfg = FakeConfig {
        stream_unasked: true,
        ..FakeConfig::default()
    };
    let (fake, _cam) = bound(cfg).await;
    sleep(Duration::from_secs(10)).await;
    assert!(interval_requests(&fake, 285.0).is_empty());
}

/// ArduPilot (SITL, 2026-10-23) answers REQUEST_MESSAGE once and streams 260 / 262 / 285 only
/// when asked: the driver must keep asking after the info frames age out, or it never connects.
#[tokio::test(start_paused = true)]
async fn connects_when_streams_come_only_on_request() {
    let cfg = FakeConfig {
        camera_streams_unasked: false,
        ..FakeConfig::default()
    };
    let (fake, cam) = started(cfg).await;
    sleep(Duration::from_secs(12)).await;
    assert!(!interval_requests(&fake, 260.0).is_empty());
    assert!(!interval_requests(&fake, 285.0).is_empty());
    let st = cam.state();
    assert!(st.borrow().connected);
    sleep(Duration::from_secs(5)).await;
    assert!(st.borrow().connected, "stays connected on the requested streams");
}

#[tokio::test(start_paused = true)]
async fn photo_once() {
    let (fake, cam) = bound(FakeConfig::default()).await;
    assert_eq!(cam.send(CameraCommand::Photo).await, Ok(()));
    assert_eq!(count(&fake, MavCmd::MAV_CMD_IMAGE_START_CAPTURE), 1);
}

#[tokio::test(start_paused = true)]
async fn rejected_zoom_is_camera_rejected() {
    let cfg = FakeConfig {
        reject: vec![MavCmd::MAV_CMD_SET_CAMERA_ZOOM],
        ..FakeConfig::default()
    };
    let (_fake, cam) = bound(cfg).await;
    let r = cam.send(CameraCommand::ZoomAbsolute { zoom: 40.0 }).await;
    assert_eq!(r, Err(CameraError::Refused("camera_rejected")));
}

#[tokio::test(start_paused = true)]
async fn mute_record_is_io_error() {
    let cfg = FakeConfig {
        mute: vec![MavCmd::MAV_CMD_VIDEO_START_CAPTURE],
        ..FakeConfig::default()
    };
    let (fake, cam) = bound(cfg).await;
    let started = tokio::time::Instant::now();
    let r = cam.send(CameraCommand::RecordStart).await;
    assert!(matches!(r, Err(CameraError::Io(_))), "{r:?}");
    assert!(started.elapsed() >= Duration::from_millis(1_500));
    assert_eq!(count(&fake, MavCmd::MAV_CMD_VIDEO_START_CAPTURE), 1);
    assert_eq!(cam.state().borrow().recording, RecordingState::Idle);
}

#[tokio::test(start_paused = true)]
async fn zoom_and_recording_follow_the_camera() {
    let (_fake, cam) = bound(FakeConfig::default()).await;
    let st = cam.state();
    cam.send(CameraCommand::ZoomAbsolute { zoom: 40.0 })
        .await
        .expect("zoom");
    assert!(wait_for(Duration::from_millis(1_500), || st.borrow().zoom == 40.0).await);
    cam.send(CameraCommand::RecordStart).await.expect("record");
    assert_eq!(st.borrow().recording, RecordingState::Recording);
    sleep(Duration::from_millis(1_100)).await;
    assert_eq!(st.borrow().recording, RecordingState::Recording);
    cam.send(CameraCommand::RecordStop).await.expect("stop");
    assert_eq!(st.borrow().recording, RecordingState::Idle);
}

#[tokio::test(start_paused = true)]
async fn angle_round_trip_keeps_the_sign() {
    let cfg = FakeConfig {
        stream_unasked: true,
        ..FakeConfig::default()
    };
    let (_fake, cam) = bound(cfg).await;
    let cmd = CameraCommand::GimbalAngle {
        yaw_deg: 30.0,
        pitch_deg: -20.0,
    };
    cam.send(cmd).await.expect("angle");
    sleep(Duration::from_millis(200)).await;
    let g = cam.state().borrow().gimbal.clone().expect("attitude");
    assert!((g.yaw - 30.0).abs() < 0.1, "{g:?}");
    assert!((g.pitch + 20.0).abs() < 0.1, "{g:?}");
}

#[tokio::test(start_paused = true)]
async fn link_loss_disconnects_and_rebinds() {
    let (fake, cam) = bound(FakeConfig::default()).await;
    sleep(Duration::from_secs(4)).await;
    let st = cam.state();
    fake.set_paused(true);
    sleep(Duration::from_millis(3_250)).await;
    assert!(!st.borrow().connected);
    assert_eq!(
        cam.send(CameraCommand::Photo).await,
        Err(CameraError::NotConnected)
    );
    assert!(cam.caps().photo && cam.caps().gimbal.is_some());

    let before = info_requests(&fake).len();
    fake.set_paused(false);
    assert!(wait_for(Duration::from_secs(3), || st.borrow().connected).await);
    // The camera stream marks it connected at once, but the driver re-asks for its info on the
    // first tick after the FC HEARTBEAT is back (1 Hz in the fake): up to ~1.25 s later.
    let reasked = || info_requests(&fake)[before..].contains(&(259.0, 0));
    assert!(
        wait_for(Duration::from_secs(2), reasked).await,
        "{:?}",
        info_requests(&fake)
    );
}

#[tokio::test(start_paused = true)]
async fn roi_location_and_none_wait_for_acks() {
    let (fake, cam) = bound(FakeConfig::default()).await;
    assert_eq!(cam.roi_location(35.0, 139.0, 120.0).await, Ok(()));
    assert_eq!(cam.roi_none().await, Ok(()));
    let cmds = fake.commands();
    assert_eq!(
        cmds[cmds.len() - 2..],
        [
            MavCmd::MAV_CMD_DO_SET_ROI_LOCATION,
            MavCmd::MAV_CMD_DO_SET_ROI_NONE
        ]
    );

    let cfg = FakeConfig {
        reject: vec![MavCmd::MAV_CMD_DO_SET_ROI_LOCATION],
        ..FakeConfig::default()
    };
    let (_fake, cam) = bound(cfg).await;
    assert_eq!(
        cam.roi_location(35.0, 139.0, 120.0).await,
        Err(CameraError::Refused("camera_rejected"))
    );
}

#[tokio::test(start_paused = true)]
async fn request_attitude_is_ok() {
    let (_fake, cam) = bound(FakeConfig::default()).await;
    assert_eq!(cam.request_attitude().await, Ok(()));
}

#[tokio::test(start_paused = true)]
async fn frames_from_other_systems_are_ignored() {
    let (port, payload) = manual_port();
    let cam = MavlinkCamera::new(1, 100, port);
    cam.connect().await.expect("connect");
    let info = MavMessage::CAMERA_INFORMATION(cam_info(1, 0xC3, 1));
    payload.send(frame(2, info)).expect("send");
    sleep(Duration::from_millis(300)).await;
    assert!(!cam.caps().photo);
    assert!(!cam.state().borrow().connected);
}

#[tokio::test(start_paused = true)]
async fn caps_change_notifies_the_state_watch() {
    let (port, payload) = manual_port();
    let cam = MavlinkCamera::new(1, 100, port);
    cam.connect().await.expect("connect");
    let mut rx = cam.state();
    let capture = MavMessage::CAMERA_CAPTURE_STATUS(CAMERA_CAPTURE_STATUS_DATA {
        camera_device_id: 1,
        ..CAMERA_CAPTURE_STATUS_DATA::DEFAULT
    });
    payload
        .send(frame(1, MavMessage::CAMERA_INFORMATION(cam_info(1, 0xC3, 1))))
        .expect("send");
    payload.send(frame(1, capture)).expect("send");
    sleep(Duration::from_millis(50)).await;
    assert!(rx.borrow_and_update().connected);
    let before = rx.borrow().clone();

    let manager = MavMessage::GIMBAL_MANAGER_INFORMATION(manager_info(1, 32 | 256 | 131_072));
    payload.send(frame(1, manager)).expect("send");
    let changed = timeout(Duration::from_millis(100), rx.changed()).await;
    assert!(matches!(changed, Ok(Ok(()))));
    assert_eq!(*rx.borrow(), before);
    assert!(cam.caps().gimbal.is_some());
}

fn pitchyaw_count(fake: &FakeMav) -> usize {
    fake.sent()
        .iter()
        .filter(|m| matches!(m, MavMessage::GIMBAL_MANAGER_SET_PITCHYAW(_)))
        .count()
}

const STOP: CameraCommand = CameraCommand::GimbalRate { yaw: 0, pitch: 0 };

/// A zero with nothing moving would end mission / RC pointing on ArduPilot.
#[tokio::test(start_paused = true)]
async fn zero_without_a_prior_non_zero_sends_nothing() {
    let (fake, cam) = bound(FakeConfig::default()).await;
    cam.send(STOP).await.expect("a dropped zero is still Ok");
    sleep(Duration::from_millis(100)).await;
    assert_eq!(pitchyaw_count(&fake), 0, "{:?}", fake.sent());
}

#[tokio::test(start_paused = true)]
async fn zero_after_movement_goes_out_and_may_repeat_for_2s() {
    let (fake, cam) = bound(FakeConfig::default()).await;
    cam.send(CameraCommand::GimbalRate { yaw: 40, pitch: 0 })
        .await
        .expect("rate");
    cam.send(STOP).await.expect("stop");
    sleep(Duration::from_millis(1_500)).await;
    cam.send(STOP).await.expect("repeat");
    sleep(Duration::from_millis(100)).await;
    assert_eq!(pitchyaw_count(&fake), 3, "rate, stop and one retry");
    sleep(Duration::from_millis(1_000)).await;
    cam.send(STOP).await.expect("late zero");
    sleep(Duration::from_millis(100)).await;
    assert_eq!(pitchyaw_count(&fake), 3, "2 s after the last movement: dropped");
}

#[tokio::test(start_paused = true)]
async fn zero_after_an_angle_or_roi_is_dropped() {
    let (fake, cam) = bound(FakeConfig::default()).await;
    cam.send(CameraCommand::GimbalRate { yaw: 40, pitch: 0 })
        .await
        .expect("rate");
    let angle = CameraCommand::GimbalAngle {
        yaw_deg: 10.0,
        pitch_deg: -10.0,
    };
    cam.send(angle).await.expect("angle");
    cam.send(STOP).await.expect("stop");
    sleep(Duration::from_millis(100)).await;
    assert_eq!(pitchyaw_count(&fake), 2, "the angle ended the movement");
    cam.send(CameraCommand::GimbalRate { yaw: 40, pitch: 0 })
        .await
        .expect("rate");
    cam.roi_location(35.0, 139.0, 50.0).await.expect("roi");
    cam.send(STOP).await.expect("stop");
    sleep(Duration::from_millis(100)).await;
    assert_eq!(pitchyaw_count(&fake), 3, "the ROI ended the movement");
}

fn frame(sysid: u8, message: MavMessage) -> PayloadFrame {
    PayloadFrame {
        header: MavHeader {
            system_id: sysid,
            component_id: 1,
            sequence: 0,
        },
        message,
    }
}

/// A port whose payload frames the test injects; outgoing frames are drained and dropped.
fn manual_port() -> (MavPort, broadcast::Sender<PayloadFrame>) {
    let (out_tx, mut out_rx) = mpsc::channel(64);
    tokio::spawn(async move { while out_rx.recv().await.is_some() {} });
    let (acks, _) = broadcast::channel(8);
    let (payload, _) = broadcast::channel(PAYLOAD_CAPACITY);
    (MavPort::new(out_tx, acks, payload.clone()), payload)
}
