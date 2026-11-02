//! `RoiHub`: one ROI task per vehicle driving the MT11 simulator.
mod common;

use std::time::Duration;

use common::*;
use rgcs_camera::siyi::sim::{SimServer, Transport};
use rgcs_core::{CameraKind, CameraProfile, RoiStatus, RoiTarget, ServerMessage};
use rgcs_server::app::AppState;
use rgcs_server::roi::{ManualVerdict, RoiError, StopReason};
use tokio::sync::broadcast;
use tokio::time::Instant;

type Frame = (Transport, u8, Vec<u8>);

async fn install_mt11(state: &AppState, sysid: u8, port: u16) {
    let profile = CameraProfile {
        kind: CameraKind::SiyiMt11,
        host: "127.0.0.1".into(),
        port,
        ..CameraProfile::default_for(sysid)
    };
    state.store.put_camera_profile(&profile).await.unwrap();
    state.cameras.reload(sysid).await;
}

async fn wait_connected(state: &AppState, sysid: u8, want: bool) {
    for _ in 0..80 {
        let cam = state.cameras.ensure(sysid).await;
        if cam.state().borrow().connected == want {
            return;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    panic!("camera connected never became {want}");
}

fn targets_with_north() -> Vec<RoiTarget> {
    let mut t: Vec<RoiTarget> = rgcs_core::default_roi_targets();
    t[0] = RoiTarget {
        name: "North".into(),
        lat: 35.009,
        lon: 139.0,
        alt_msl: 0.0,
        ..t[0].clone()
    };
    t
}

/// Vehicle 1 with an MT11 (sim), `roi_1` = "North" 1 km ahead-left, heading 90°.
async fn setup() -> (AppState, SimServer) {
    let (_app, state, mut sim) = spawn_app_with_sim().await;
    seed_vehicle(&state, 1, false, false).await;
    install_mt11(&state, 1, sim.addr.port()).await;
    wait_connected(&state, 1, true).await;
    state
        .store
        .put_roi_targets(1, &targets_with_north())
        .await
        .unwrap();
    seed_pose(&state, 1, 35.0, 139.0, 0, 9000).await;
    collect(&mut sim, 300).await;
    (state, sim)
}

async fn collect(sim: &mut SimServer, ms: u64) -> Vec<Frame> {
    let deadline = Instant::now() + Duration::from_millis(ms);
    let mut out = Vec::new();
    while let Ok(Some(f)) = tokio::time::timeout_at(deadline, sim.received.recv()).await {
        out.push(f);
    }
    out
}

async fn wait_frame(sim: &mut SimServer, ms: u64, pred: impl Fn(&Frame) -> bool) -> bool {
    let deadline = Instant::now() + Duration::from_millis(ms);
    while let Ok(Some(f)) = tokio::time::timeout_at(deadline, sim.received.recv()).await {
        if pred(&f) {
            return true;
        }
    }
    false
}

fn is_zero_rate(f: &Frame) -> bool {
    f.0 == Transport::Udp && f.1 == 0x07 && f.2 == [0, 0]
}

async fn statuses(rx: &mut broadcast::Receiver<ServerMessage>, ms: u64) -> Vec<RoiStatus> {
    let deadline = Instant::now() + Duration::from_millis(ms);
    let mut out = Vec::new();
    while let Ok(Ok(m)) = tokio::time::timeout_at(deadline, rx.recv()).await {
        if let ServerMessage::RoiStatus { sysid: 1, status } = m {
            out.push(status);
        }
    }
    out
}

#[tokio::test]
async fn start_sends_follow_then_rate_frames() {
    let (state, mut sim) = setup().await;
    let mut rx = state.tx.subscribe();
    let target = state.roi.start(1, "roi_1").await.unwrap();
    assert_eq!(target.name, "North");
    let frames = collect(&mut sim, 1000).await;
    assert!(
        frames
            .iter()
            .any(|f| f.0 == Transport::Tcp && f.1 == 0x0C && f.2 == [4]),
        "{frames:?}"
    );
    assert!(
        frames
            .iter()
            .any(|f| f.0 == Transport::Udp && f.1 == 0x07 && f.2 != [0, 0]),
        "{frames:?}"
    );
    let st = statuses(&mut rx, 100).await;
    assert!(
        st.iter().any(|s| s.active_target.as_deref() == Some("roi_1")),
        "{st:?}"
    );
    assert_eq!(state.roi.active_target(1).as_deref(), Some("roi_1"));
}

#[tokio::test]
async fn stop_sends_zero_and_final_status() {
    let (state, mut sim) = setup().await;
    state.roi.start(1, "roi_1").await.unwrap();
    collect(&mut sim, 400).await;
    let mut rx = state.tx.subscribe();
    assert!(state.roi.stop(1, StopReason::Operator).await);
    assert!(wait_frame(&mut sim, 300, is_zero_rate).await);
    let st = statuses(&mut rx, 200).await;
    assert_eq!(st.last().map(|s| s.active_target.clone()), Some(None), "{st:?}");
    assert_eq!(state.roi.active_target(1), None);
    assert!(!state.roi.stop(1, StopReason::Operator).await);
}

#[tokio::test]
async fn status_broadcast_2hz() {
    let (state, _sim) = setup().await;
    state.roi.start(1, "roi_1").await.unwrap();
    tokio::time::sleep(Duration::from_millis(100)).await;
    let mut rx = state.tx.subscribe();
    let st = statuses(&mut rx, 1250).await;
    assert!((2..=3).contains(&st.len()), "{} frames: {st:?}", st.len());
    assert!(st.iter().all(|s| s.active_target.as_deref() == Some("roi_1")));
}

#[tokio::test]
async fn manual_rate_small_dropped_large_cancels() {
    let (state, mut sim) = setup().await;
    state.roi.start(1, "roi_1").await.unwrap();
    collect(&mut sim, 300).await;
    assert_eq!(state.roi.on_manual_rate(1, 3, -4).await, ManualVerdict::Drop);
    assert_eq!(state.roi.active_target(1).as_deref(), Some("roi_1"));
    assert_eq!(state.roi.on_manual_rate(1, 0, 6).await, ManualVerdict::Forward);
    assert_eq!(state.roi.active_target(1), None);
    assert!(wait_frame(&mut sim, 300, is_zero_rate).await);
    assert_eq!(state.roi.on_manual_rate(1, 0, 6).await, ManualVerdict::Forward);
}

#[tokio::test]
async fn zero_dropped_while_active() {
    let (state, _sim) = setup().await;
    assert_eq!(state.roi.on_zero(1), ManualVerdict::Forward);
    state.roi.start(1, "roi_1").await.unwrap();
    assert_eq!(state.roi.on_zero(1), ManualVerdict::Drop);
    state.roi.stop(1, StopReason::Operator).await;
    assert_eq!(state.roi.on_zero(1), ManualVerdict::Forward);
}

#[tokio::test]
async fn start_errors() {
    let (state, sim) = setup().await;
    assert_eq!(state.roi.start(1, "roi_9").await, Err(RoiError::Unset));
    assert_eq!(state.roi.start(1, "roi_x").await, Err(RoiError::NotFound));
    state
        .store
        .put_roi_targets(2, &targets_with_north())
        .await
        .unwrap();
    assert_eq!(state.roi.start(2, "roi_1").await, Err(RoiError::Unsupported));
    sim.stop().await;
    wait_connected(&state, 1, false).await;
    assert_eq!(state.roi.start(1, "roi_1").await, Err(RoiError::CameraOffline));
    assert_eq!(state.roi.active_target(1), None);
}

#[tokio::test]
async fn targets_put_unsetting_active_stops() {
    let (state, _sim) = setup().await;
    state.roi.start(1, "roi_1").await.unwrap();
    let moved = {
        let mut t = targets_with_north();
        t[0] = RoiTarget {
            lat: 35.01,
            ..t[0].clone()
        };
        t
    };
    state.roi.set_targets(1, moved).await;
    assert_eq!(state.roi.active_target(1).as_deref(), Some("roi_1"));
    state.roi.set_targets(1, rgcs_core::default_roi_targets()).await;
    let deadline = Instant::now() + Duration::from_millis(300);
    while state.roi.active_target(1).is_some() && Instant::now() < deadline {
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert_eq!(state.roi.active_target(1), None);
}

#[tokio::test]
async fn boot_zero_sent_once_on_first_connect() {
    let (_app, state, mut sim) = spawn_app_with_sim().await;
    install_mt11(&state, 1, sim.addr.port()).await;
    let frames = collect(&mut sim, 1500).await;
    let zeros = frames.iter().filter(|f| is_zero_rate(f)).count();
    assert_eq!(zeros, 1, "{frames:?}");
}

#[tokio::test]
async fn shutdown_all_stops_every_vehicle() {
    let (state, mut sim) = setup().await;
    state.roi.start(1, "roi_1").await.unwrap();
    collect(&mut sim, 300).await;
    state.roi.shutdown_all().await;
    assert_eq!(state.roi.active_target(1), None);
    assert!(wait_frame(&mut sim, 300, is_zero_rate).await);
}

/// Drops the simulator, waits for the driver to notice, and returns the port to restart on.
async fn take_camera_offline(state: &AppState, sim: SimServer) -> u16 {
    let port = sim.addr.port();
    sim.stop().await;
    wait_connected(state, 1, false).await;
    port
}

#[tokio::test]
async fn stop_while_offline_is_zeroed_on_reconnect() {
    let (state, mut sim) = setup().await;
    state.roi.start(1, "roi_1").await.unwrap();
    assert!(wait_frame(&mut sim, 1000, |f| f.1 == 0x07 && f.2 != [0, 0]).await);
    let port = take_camera_offline(&state, sim).await;
    assert!(state.roi.stop(1, StopReason::Operator).await);
    let mut sim = SimServer::start_on(port).await;
    wait_connected(&state, 1, true).await;
    assert!(
        wait_frame(&mut sim, 1000, is_zero_rate).await,
        "reconnect must zero the gimbal"
    );
}

#[tokio::test]
async fn reconnect_does_not_zero_while_roi_owns_the_gimbal() {
    let (state, sim) = setup().await;
    let angle = rgcs_core::RoiControl {
        control_mode: rgcs_core::RoiControlMode::Angle,
        ..rgcs_core::RoiControl::default()
    };
    state.store.put_roi_control(1, &angle).await.unwrap();
    state.roi.start(1, "roi_1").await.unwrap();
    tokio::time::sleep(Duration::from_millis(300)).await;
    let port = take_camera_offline(&state, sim).await;
    let mut sim = SimServer::start_on(port).await;
    wait_connected(&state, 1, true).await;
    let frames = collect(&mut sim, 800).await;
    assert!(!frames.iter().any(is_zero_rate), "{frames:?}");
    assert_eq!(state.roi.active_target(1).as_deref(), Some("roi_1"));
}
