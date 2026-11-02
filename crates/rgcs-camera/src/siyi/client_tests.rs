use super::*;
use crate::camera::Camera;
use crate::siyi::sim::{SimServer, Transport};
use rgcs_core::{CameraCommand, CenterMode, GimbalMode, RecordingState, VideoMode};
use std::time::Duration;
use tokio::time::timeout;

async fn wait_until(cam: &SiyiMt11, pred: impl Fn(&CameraState) -> bool, secs: u64) -> CameraState {
    let mut rx = cam.state();
    let deadline = Duration::from_secs(secs);
    timeout(deadline, async {
        loop {
            if pred(&rx.borrow()) {
                return rx.borrow().clone();
            }
            rx.changed().await.expect("state channel alive");
        }
    })
    .await
    .expect("state predicate within deadline")
}

async fn drain(sim: &mut SimServer, ms: u64) -> Vec<(Transport, u8, Vec<u8>)> {
    let mut out = Vec::new();
    while let Ok(Some(m)) = timeout(Duration::from_millis(ms), sim.received.recv()).await {
        out.push(m);
    }
    out
}

#[tokio::test]
async fn tcp_session_has_nagle_off() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let stream = super::open_tcp(listener.local_addr().unwrap()).await.unwrap();
    assert!(stream.nodelay().unwrap());
}

async fn connected_pair() -> (SiyiMt11, SimServer) {
    let sim = SimServer::start().await;
    let cam = SiyiMt11::new(sim.addr.ip().to_string().parse().unwrap(), sim.addr.port());
    cam.connect().await.unwrap();
    wait_until(
        &cam,
        |s| s.connected && s.firmware.is_some() && s.gimbal_mode.is_some() && s.video_mode.is_some(),
        3,
    )
    .await;
    (cam, sim)
}

#[tokio::test]
async fn connect_requests_firmware_zoom_mode_and_reports_connected() {
    let (cam, mut sim) = connected_pair().await;
    let s = cam.state().borrow().clone();
    assert_eq!(s.firmware.as_ref().unwrap().camera, "v1.0.1");
    assert_eq!(s.firmware.as_ref().unwrap().gimbal, "v0.1.10");
    assert_eq!(s.zoom_max, 165.0);
    assert_eq!(s.gimbal_mode, Some(GimbalMode::Follow));
    assert_eq!(s.video_mode, Some(VideoMode::Rgb));
    let cmds: Vec<u8> = drain(&mut sim, 200)
        .await
        .into_iter()
        .map(|(_, c, _)| c)
        .collect();
    for want in [0x01, 0x18, 0x10, 0x19] {
        assert!(cmds.contains(&want), "missing 0x{want:02X} in {cmds:?}");
    }
    cam.disconnect().await;
}

#[tokio::test]
async fn gimbal_rate_goes_over_udp_and_center_too() {
    let (cam, mut sim) = connected_pair().await;
    drain(&mut sim, 100).await;
    cam.send(CameraCommand::GimbalRate { yaw: 30, pitch: -10 })
        .await
        .unwrap();
    cam.send(CameraCommand::GimbalCenter {
        mode: CenterMode::OneKeyReset,
    })
    .await
    .unwrap();
    let got = drain(&mut sim, 300).await;
    assert!(got.contains(&(Transport::Udp, 0x07, vec![30, 0xF6])), "{got:?}");
    assert!(got.contains(&(Transport::Udp, 0x08, vec![1])), "{got:?}");
    cam.disconnect().await;
}

#[tokio::test]
async fn zoom_step_uses_current_zoom_then_rereads() {
    let (cam, mut sim) = connected_pair().await;
    sim.set_zoom(2, 0);
    cam.send(CameraCommand::ZoomAbsolute { zoom: 2.0 }).await.unwrap();
    wait_until(&cam, |s| s.zoom == 2.0, 2).await;
    drain(&mut sim, 100).await;
    cam.send(CameraCommand::ZoomStep { steps: 1 }).await.unwrap();
    let got = drain(&mut sim, 300).await;
    let tcp: Vec<(u8, Vec<u8>)> = got
        .into_iter()
        .filter(|(t, _, _)| *t == Transport::Tcp)
        .map(|(_, c, p)| (c, p))
        .collect();
    assert!(tcp.contains(&(0x0F, vec![3, 0])), "{tcp:?}");
    assert!(tcp.contains(&(0x18, vec![])), "{tcp:?}");
    wait_until(&cam, |s| s.zoom == 3.0, 2).await;
    cam.disconnect().await;
}

#[tokio::test]
async fn record_start_is_idempotent() {
    let (cam, mut sim) = connected_pair().await;
    drain(&mut sim, 100).await;
    cam.send(CameraCommand::RecordStart).await.unwrap();
    wait_until(&cam, |s| s.recording == RecordingState::Recording, 2).await;
    cam.send(CameraCommand::RecordStart).await.unwrap();
    tokio::time::sleep(Duration::from_millis(200)).await;
    let toggles = drain(&mut sim, 200)
        .await
        .into_iter()
        .filter(|(t, c, p)| *t == Transport::Tcp && *c == 0x0C && p == &[2])
        .count();
    assert_eq!(toggles, 1);
    cam.send(CameraCommand::RecordStop).await.unwrap();
    wait_until(&cam, |s| s.recording == RecordingState::Idle, 2).await;
    cam.disconnect().await;
}

#[tokio::test]
async fn video_mode_switch_rereads_mode() {
    let (cam, mut sim) = connected_pair().await;
    drain(&mut sim, 100).await;
    cam.send(CameraCommand::VideoMode {
        mode: VideoMode::Thermal,
    })
    .await
    .unwrap();
    let got = drain(&mut sim, 300).await;
    assert!(got.contains(&(Transport::Tcp, 0x11, vec![2, 0])), "{got:?}");
    assert!(got.contains(&(Transport::Tcp, 0x10, vec![])), "{got:?}");
    wait_until(&cam, |s| s.video_mode == Some(VideoMode::Thermal), 2).await;
    cam.disconnect().await;
}

#[tokio::test]
async fn reconnects_after_the_sim_restarts() {
    let (cam, sim) = connected_pair().await;
    let port = sim.addr.port();
    sim.stop().await;
    wait_until(&cam, |s| !s.connected, 3).await;
    assert_eq!(
        cam.send(CameraCommand::GimbalRate { yaw: 1, pitch: 1 }).await,
        Err(CameraError::NotConnected)
    );
    let sim2 = SimServer::start_on(port).await;
    wait_until(&cam, |s| s.connected, 4).await;
    sim2.stop().await;
    cam.disconnect().await;
}

#[tokio::test]
async fn a_silent_camera_is_reported_lost_within_three_seconds_and_recovers() {
    let (cam, sim) = connected_pair().await;
    sim.freeze();
    let t0 = std::time::Instant::now();
    wait_until(&cam, |s| !s.connected, 5).await;
    assert!(
        t0.elapsed() < Duration::from_millis(4_500),
        "watchdog fired at {:?}",
        t0.elapsed()
    );
    sim.thaw();
    // Reconnected and the first attitude poll answered: its age is tracked, not left at 0.
    let s = wait_until(&cam, |s| s.connected && s.gimbal.is_some(), 4).await;
    assert!(
        s.gimbal.is_some_and(|g| g.age_ms < 3_000),
        "attitude age is tracked"
    );
    cam.disconnect().await;
    sim.stop().await;
}

#[tokio::test]
async fn connect_to_a_black_hole_times_out_instead_of_hanging() {
    // 10.255.255.1 is a non-routable address: SYN never answered.
    let cam = SiyiMt11::new("10.255.255.1".parse().unwrap(), 37260);
    cam.connect().await.unwrap();
    tokio::time::sleep(Duration::from_millis(3_600)).await;
    assert!(cam
        .state()
        .borrow()
        .last_error
        .as_deref()
        .is_some_and(|e| e.contains("timed out") || e.contains("connect")));
    cam.disconnect().await;
}

#[tokio::test]
async fn format_sd_can_never_be_sent() {
    let (cam, _sim) = connected_pair().await;
    assert_eq!(
        cam.raw_send(0x48, &[], Transport::Tcp).await,
        Err(CameraError::Forbidden(0x48))
    );
    assert_eq!(
        cam.raw_send(0x48, &[], Transport::Udp).await,
        Err(CameraError::Forbidden(0x48))
    );
    cam.disconnect().await;
}

#[tokio::test]
async fn none_camera_rejects_everything() {
    let cam = crate::none::NoneCamera::default();
    assert_eq!(cam.caps().kind, rgcs_core::CameraKind::None);
    assert!(matches!(
        cam.send(CameraCommand::Photo).await,
        Err(CameraError::Unsupported(_))
    ));
    assert!(!cam.state().borrow().connected);
    assert!(matches!(
        cam.request_attitude().await,
        Err(CameraError::Unsupported(_))
    ));
    cam.connect().await.unwrap();
}

#[tokio::test]
async fn request_attitude_sends_0x0d_over_tcp() {
    let (cam, mut sim) = connected_pair().await;
    drain(&mut sim, 100).await;
    // The 1 Hz poll adds at most one 0x0D in this window; three requests must show up.
    for _ in 0..3 {
        cam.request_attitude().await.unwrap();
    }
    let got = drain(&mut sim, 500).await;
    let polls = got
        .iter()
        .filter(|m| **m == (Transport::Tcp, 0x0D, vec![]))
        .count();
    assert!(polls >= 3, "{got:?}");
    cam.disconnect().await;
}

#[path = "client_media_tests.rs"]
mod media;
