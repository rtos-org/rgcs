//! GPS ROI, Native: a MAVLink gimbal manager is pointed with DO_SET_ROI_LOCATION and released
//! with DO_SET_ROI_NONE.
mod common;

use std::time::Duration;

use axum::http::{Method, StatusCode};
use common::*;
use mavlink::dialects::ardupilotmega::{MavCmd, MavFrame, MavMessage, COMMAND_INT_DATA};
use rgcs_camera::mavlink_cam::fake::{FakeConfig, FakeMav};
use rgcs_core::{RoiStatus, ServerMessage};
use rgcs_input::Gate;
use rgcs_server::app::AppState;
use serde_json::{json, Value};
use tokio::sync::broadcast;

async fn send(
    app: &axum::Router,
    cookie: &str,
    method: Method,
    path: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let (s, v, _) = call(app, req(method, path, Some(cookie), body)).await;
    (s, v)
}

fn targets() -> Value {
    let rows: Vec<Value> = (1..=10)
        .map(|i| {
            if i == 1 {
                json!({ "id": "roi_1", "name": "North", "lat": 35.009, "lon": 139.0, "alt_msl": 100.0 })
            } else {
                json!({ "id": format!("roi_{i}"), "name": "", "lat": 0.0, "lon": 0.0, "alt_msl": 0.0 })
            }
        })
        .collect();
    Value::Array(rows)
}

async fn wait_photo_caps(state: &AppState) -> rgcs_core::CameraCaps {
    for _ in 0..80 {
        let cam = state.cameras.ensure(1).await;
        if cam.state().borrow().connected && cam.caps().photo && cam.caps().gimbal.is_some() {
            return cam.caps();
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    panic!("mavlink camera never bound");
}

/// Vehicle 1 at (35.0, 139.0) with a bound MAVLink camera and `roi_1` = "North".
async fn setup(cfg: FakeConfig) -> (axum::Router, AppState, FakeMav, String) {
    let (app, state, fake) = spawn_app_with_fake_mav(cfg).await;
    seed_vehicle(&state, 1, false, false).await;
    let cookie = login(&app).await;
    let profile = json!({ "kind": "mavlink", "comp_id": 100, "host": "192.168.144.30",
        "rtsp_url": "rtsp://192.168.144.30:8554/main" });
    let (s, v) = send(
        &app,
        &cookie,
        Method::PUT,
        "/api/vehicles/1/camera/profile",
        Some(profile),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    wait_photo_caps(&state).await;
    let (s, v) = send(
        &app,
        &cookie,
        Method::PUT,
        "/api/vehicles/1/roi/targets",
        Some(targets()),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    seed_pose(&state, 1, 35.0, 139.0, 0, 0).await;
    (app, state, fake, cookie)
}

async fn start(app: &axum::Router, cookie: &str) -> (StatusCode, Value) {
    send(
        app,
        cookie,
        Method::POST,
        "/api/vehicles/1/roi/start",
        Some(json!({ "id": "roi_1" })),
    )
    .await
}

fn locations(fake: &FakeMav) -> Vec<COMMAND_INT_DATA> {
    fake.sent()
        .into_iter()
        .filter_map(|m| match m {
            MavMessage::COMMAND_INT(d) if d.command == MavCmd::MAV_CMD_DO_SET_ROI_LOCATION => Some(d),
            _ => None,
        })
        .collect()
}

fn releases(fake: &FakeMav) -> Vec<f32> {
    fake.sent()
        .into_iter()
        .filter_map(|m| match m {
            MavMessage::COMMAND_LONG(d) if d.command == MavCmd::MAV_CMD_DO_SET_ROI_NONE => Some(d.param1),
            _ => None,
        })
        .collect()
}

/// Waits up to `ms` for `pred` over the fake's log.
async fn eventually(ms: u64, mut pred: impl FnMut() -> bool) -> bool {
    for _ in 0..ms / 25 {
        if pred() {
            return true;
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    pred()
}

/// The next `roi_status` for vehicle 1 within `ms`.
async fn next_status(rx: &mut broadcast::Receiver<ServerMessage>, ms: u64) -> RoiStatus {
    tokio::time::timeout(Duration::from_millis(ms), async {
        loop {
            if let Ok(ServerMessage::RoiStatus { sysid: 1, status }) = rx.recv().await {
                return status;
            }
        }
    })
    .await
    .expect("a roi_status frame")
}

/// The first `roi_status` within `ms` that satisfies `pred`.
async fn status_where(
    rx: &mut broadcast::Receiver<ServerMessage>,
    ms: u64,
    pred: impl Fn(&RoiStatus) -> bool,
) -> RoiStatus {
    tokio::time::timeout(Duration::from_millis(ms), async {
        loop {
            let s = next_status(rx, ms).await;
            if pred(&s) {
                return s;
            }
        }
    })
    .await
    .expect("a matching roi_status frame")
}

#[tokio::test]
async fn start_sends_roi_location_with_the_gimbal_id() {
    let (app, state, fake, cookie) = setup(FakeConfig::default()).await;
    let mut rx = state.tx.subscribe();
    let (s, v) = start(&app, &cookie).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let sent = locations(&fake);
    assert_eq!(sent.len(), 1, "{sent:?}");
    assert_eq!(sent[0].param1, 1.0);
    assert_eq!(sent[0].frame, MavFrame::MAV_FRAME_GLOBAL);
    assert_eq!((sent[0].x, sent[0].y), (350_090_000, 1_390_000_000));
    assert_eq!(sent[0].z, 100.0);
    let status = next_status(&mut rx, 1_500).await;
    assert_eq!(status.active_target.as_deref(), Some("roi_1"));
    assert_eq!(status.mode, None);
    assert_eq!(status.error, None, "{status:?}");
    assert!(
        status.distance_m.is_some_and(|d| (d - 1_000.0).abs() < 20.0),
        "{status:?}"
    );
    let json = serde_json::to_value(&status).unwrap();
    assert!(json["mode"].is_null(), "{json}");
}

#[tokio::test]
async fn stop_sends_roi_none() {
    let (app, state, fake, cookie) = setup(FakeConfig::default()).await;
    let (s, v) = start(&app, &cookie).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let (s, v) = send(&app, &cookie, Method::POST, "/api/vehicles/1/roi/stop", None).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["data"]["stopped"], true);
    assert_eq!(releases(&fake), vec![1.0]);
    assert_eq!(state.roi.active_target(1), None);
}

#[tokio::test]
async fn manual_stick_releases_first() {
    let (app, state, fake, cookie) = setup(FakeConfig::default()).await;
    let (s, v) = start(&app, &cookie).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let frame = r#"{"t":"gimbal_rate","sysid":1,"yaw":50,"pitch":0,"seq":1}"#;
    rgcs_server::ws::handle_client(&Gate::default(), &state, "pilot", frame, 1_000).await;
    let order = || {
        fake.sent()
            .into_iter()
            .filter_map(|m| match m {
                MavMessage::COMMAND_LONG(d) if d.command == MavCmd::MAV_CMD_DO_SET_ROI_NONE => Some("none"),
                MavMessage::GIMBAL_MANAGER_SET_PITCHYAW(_) => Some("rate"),
                _ => None,
            })
            .collect::<Vec<_>>()
    };
    assert!(
        eventually(1_000, || order().contains(&"rate")).await,
        "{:?}",
        fake.sent()
    );
    assert_eq!(order().first(), Some(&"none"), "{:?}", order());
    assert_eq!(state.roi.active_target(1), None);
    let (_, audit) = send(&app, &cookie, Method::GET, "/api/history/audit?limit=50", None).await;
    let rows = audit["data"].as_array().cloned().unwrap_or_default();
    assert!(
        rows.iter()
            .any(|r| r["target"] == "roi" && r["command"] == "stop" && r["reason"] == "manual_input"),
        "{rows:?}"
    );
}

#[tokio::test]
async fn stick_zero_is_dropped_while_active() {
    let (app, state, fake, cookie) = setup(FakeConfig::default()).await;
    let (s, v) = start(&app, &cookie).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let frame = r#"{"t":"gimbal_rate","sysid":1,"yaw":0,"pitch":0,"seq":1}"#;
    rgcs_server::ws::handle_client(&Gate::default(), &state, "pilot", frame, 1_000).await;
    tokio::time::sleep(Duration::from_millis(300)).await;
    let rates = fake
        .sent()
        .into_iter()
        .filter(|m| matches!(m, MavMessage::GIMBAL_MANAGER_SET_PITCHYAW(_)));
    assert_eq!(rates.count(), 0, "{:?}", fake.sent());
    assert_eq!(state.roi.active_target(1).as_deref(), Some("roi_1"));
}

#[tokio::test]
async fn resends_every_5s() {
    let (app, _state, fake, cookie) = setup(FakeConfig::default()).await;
    let (s, v) = start(&app, &cookie).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let t0 = tokio::time::Instant::now();
    assert!(
        eventually(6_000, || locations(&fake).len() >= 2).await,
        "{:?}",
        fake.commands()
    );
    let gap = t0.elapsed();
    assert!(gap >= Duration::from_millis(4_500), "resent after {gap:?}");
    assert_eq!(locations(&fake)[1].x, 350_090_000);
}

#[tokio::test]
async fn refused_location_reports_send_failed() {
    let cfg = FakeConfig {
        reject: vec![MavCmd::MAV_CMD_DO_SET_ROI_LOCATION],
        ..FakeConfig::default()
    };
    let (app, state, _fake, cookie) = setup(cfg).await;
    let mut rx = state.tx.subscribe();
    let (s, v) = start(&app, &cookie).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let status = next_status(&mut rx, 1_500).await;
    assert_eq!(status.error.as_deref(), Some("send_failed"), "{status:?}");
    assert_eq!(state.roi.active_target(1).as_deref(), Some("roi_1"));
}

#[tokio::test]
async fn no_point_location_is_unsupported() {
    let cfg = FakeConfig {
        manager_caps: 32 | 256,
        ..FakeConfig::default()
    };
    let (app, state, fake, cookie) = setup(cfg).await;
    assert_eq!(state.cameras.ensure(1).await.caps().roi, rgcs_core::RoiMode::None);
    let (s, v) = start(&app, &cookie).await;
    assert_eq!(s, StatusCode::CONFLICT, "{v}");
    assert_eq!(error_code(&v), "unsupported_capability");
    assert!(locations(&fake).is_empty());
}

/// Like the computed ROI: offline keeps ROI active with `camera_offline` and sends nothing;
/// the reconnect edge re-asserts the location at once (here: coordinates changed while
/// offline, so the 5 s clock is not due and only the edge can send them).
#[tokio::test]
async fn offline_keeps_roi_and_resends_on_reconnect() {
    let (app, state, fake, cookie) = setup(FakeConfig::default()).await;
    let (s, v) = start(&app, &cookie).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let mut rx = state.tx.subscribe();
    fake.set_paused(true);
    status_where(&mut rx, 5_000, |s| s.error.as_deref() == Some("camera_offline")).await;
    assert_eq!(state.roi.active_target(1).as_deref(), Some("roi_1"));
    let mut moved = targets();
    moved[0]["lat"] = json!(35.01);
    let (s, v) = send(
        &app,
        &cookie,
        Method::PUT,
        "/api/vehicles/1/roi/targets",
        Some(moved),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert!(
        locations(&fake).iter().all(|l| l.x == 350_090_000),
        "sent while offline"
    );
    fake.set_paused(false);
    let s = status_where(&mut rx, 3_000, |s| s.error.is_none()).await;
    assert_eq!(s.active_target.as_deref(), Some("roi_1"));
    let resent = || locations(&fake).iter().any(|l| l.x == 350_100_000);
    assert!(
        eventually(500, resent).await,
        "no resend after reconnect: {:?}",
        fake.commands()
    );
}

/// A stop while offline cannot reach the manager; the release goes out once the link is back.
#[tokio::test]
async fn stop_while_offline_releases_on_reconnect() {
    let (app, state, fake, cookie) = setup(FakeConfig::default()).await;
    let (s, v) = start(&app, &cookie).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let mut rx = state.tx.subscribe();
    fake.set_paused(true);
    status_where(&mut rx, 5_000, |s| s.error.as_deref() == Some("camera_offline")).await;
    let (s, v) = send(&app, &cookie, Method::POST, "/api/vehicles/1/roi/stop", None).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["data"]["stopped"], true);
    assert_eq!(state.roi.active_target(1), None);
    assert!(releases(&fake).is_empty(), "{:?}", fake.sent());
    fake.set_paused(false);
    assert!(
        eventually(3_000, || releases(&fake) == vec![1.0]).await,
        "{:?}",
        fake.commands()
    );
}
