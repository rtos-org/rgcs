//! The `mavlink` camera kind runs the MAVLink camera driver on the FC link.
mod common;

use std::time::Duration;

use axum::http::{Method, StatusCode};
use common::*;
use mavlink::dialects::ardupilotmega::{MavCmd, MavMessage};
use rgcs_camera::mavlink_cam::fake::{FakeConfig, FakeMav};
use rgcs_core::ServerMessage;
use rgcs_input::Gate;
use serde_json::{json, Value};

async fn put_mavlink_profile(app: &axum::Router, cookie: &str) {
    let body = json!({
        "kind": "mavlink",
        "comp_id": 100,
        "host": "192.168.144.30",
        "rtsp_url": "rtsp://192.168.144.30:8554/main",
    });
    let (s, v, _) = call(
        app,
        req(
            Method::PUT,
            "/api/vehicles/1/camera/profile",
            Some(cookie),
            Some(body),
        ),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
}

async fn camera_json(app: &axum::Router, cookie: &str) -> Value {
    let (s, v, _) = call(
        app,
        req(Method::GET, "/api/vehicles/1/camera", Some(cookie), None),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    v["data"].clone()
}

/// Polls `GET …/camera` for up to 3 s until the driver is bound and connected.
async fn wait_bound(app: &axum::Router, cookie: &str) -> Value {
    for _ in 0..60 {
        let c = camera_json(app, cookie).await;
        if c["state"]["connected"] == true && c["caps"]["photo"] == true && c["caps"]["roi"] == "native" {
            return c;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    panic!("mavlink camera never bound: {}", camera_json(app, cookie).await);
}

/// A logged-in app with a bound MAVLink camera.
async fn bound_app(cfg: FakeConfig) -> (axum::Router, rgcs_server::app::AppState, FakeMav, String) {
    let (app, state, fake) = spawn_app_with_fake_mav(cfg).await;
    seed_vehicle(&state, 1, false, false).await;
    let cookie = login(&app).await;
    put_mavlink_profile(&app, &cookie).await;
    wait_bound(&app, &cookie).await;
    (app, state, fake, cookie)
}

async fn post_command(app: &axum::Router, cookie: &str, body: Value) -> (StatusCode, Value) {
    let (s, v, _) = call(
        app,
        req(
            Method::POST,
            "/api/vehicles/1/camera/command",
            Some(cookie),
            Some(body),
        ),
    )
    .await;
    (s, v)
}

async fn last_audit(app: &axum::Router, cookie: &str) -> Value {
    let (_, audit, _) = call(
        app,
        req(Method::GET, "/api/history/audit?limit=1", Some(cookie), None),
    )
    .await;
    audit["data"][0].clone()
}

/// Waits up to `ms` for the fake to have received `cmd`.
async fn saw_command(fake: &FakeMav, cmd: MavCmd, ms: u64) -> bool {
    for _ in 0..ms / 50 {
        if fake.commands().contains(&cmd) {
            return true;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    false
}

fn yaw_rates(fake: &FakeMav) -> Vec<f32> {
    fake.sent()
        .iter()
        .filter_map(|m| match m {
            MavMessage::GIMBAL_MANAGER_SET_PITCHYAW(d) => Some(d.yaw_rate),
            _ => None,
        })
        .collect()
}

#[tokio::test]
async fn mavlink_profile_builds_the_driver() {
    let (app, state, _fake) = spawn_app_with_fake_mav(FakeConfig::default()).await;
    seed_vehicle(&state, 1, false, false).await;
    let cookie = login(&app).await;
    put_mavlink_profile(&app, &cookie).await;
    let c = wait_bound(&app, &cookie).await;
    assert_eq!(c["caps"]["kind"], "mavlink");
    assert_eq!(c["caps"]["photo"], true);
    assert_eq!(c["caps"]["zoom"]["unit"], "percent");
    assert_eq!(c["caps"]["roi"], "native");
    assert_eq!(c["state"]["connected"], true);
}

#[tokio::test]
async fn caps_reach_the_websocket() {
    let (app, state, _fake) = spawn_app_with_fake_mav(FakeConfig::default()).await;
    seed_vehicle(&state, 1, false, false).await;
    let cookie = login(&app).await;
    let mut rx = state.tx.subscribe();
    put_mavlink_profile(&app, &cookie).await;
    let photos = tokio::time::timeout(Duration::from_secs(3), async {
        let mut photos = Vec::new();
        loop {
            if let Ok(ServerMessage::CameraState { sysid: 1, caps, .. }) = rx.recv().await {
                if caps.kind == rgcs_core::CameraKind::Mavlink {
                    photos.push(caps.photo);
                    if caps.photo {
                        return photos;
                    }
                }
            }
        }
    })
    .await
    .expect("a camera_state frame with photo caps");
    assert_eq!(photos.first(), Some(&false), "{photos:?}");
    assert_eq!(photos.last(), Some(&true), "{photos:?}");
}

#[tokio::test]
async fn photo_goes_out_as_image_start_capture() {
    let (app, _state, fake, cookie) = bound_app(FakeConfig::default()).await;
    let (s, v) = post_command(&app, &cookie, json!({ "cmd": "photo" })).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert!(fake.commands().contains(&MavCmd::MAV_CMD_IMAGE_START_CAPTURE));
    let row = last_audit(&app, &cookie).await;
    assert_eq!(row["target"], "camera", "{row}");
    assert_eq!(row["command"], "photo", "{row}");
    assert_eq!(row["result"], "ok", "{row}");
}

#[tokio::test]
async fn thermal_is_unsupported() {
    let (app, _state, _fake, cookie) = bound_app(FakeConfig::default()).await;
    let (s, v) = post_command(
        &app,
        &cookie,
        json!({ "cmd": "thermal_gain", "args": { "gain": "high" } }),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT, "{v}");
    assert_eq!(error_code(&v), "unsupported_capability");
}

#[tokio::test]
async fn rejected_zoom_is_409_camera_rejected() {
    let cfg = FakeConfig {
        reject: vec![MavCmd::MAV_CMD_SET_CAMERA_ZOOM],
        ..FakeConfig::default()
    };
    let (app, _state, _fake, cookie) = bound_app(cfg).await;
    let (s, v) = post_command(
        &app,
        &cookie,
        json!({ "cmd": "zoom_absolute", "args": { "zoom": 40.0 } }),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT, "{v}");
    assert_eq!(error_code(&v), "camera_rejected");
    let row = last_audit(&app, &cookie).await;
    assert_eq!(row["result"], "rejected", "{row}");
    assert_eq!(row["reason"], "camera_rejected", "{row}");
}

#[tokio::test]
async fn no_link_up_zero_for_mavlink() {
    let (_app, _state, fake, _cookie) = bound_app(FakeConfig::default()).await;
    tokio::time::sleep(Duration::from_secs(3)).await;
    assert!(yaw_rates(&fake).is_empty(), "{:?}", fake.sent());
}

#[tokio::test]
async fn ws_gimbal_rate_reaches_the_manager() {
    let (_app, state, fake, _cookie) = bound_app(FakeConfig::default()).await;
    let frame = r#"{"t":"gimbal_rate","sysid":1,"yaw":50,"pitch":0,"seq":1}"#;
    let (_, replies) = rgcs_server::ws::handle_client(&Gate::default(), &state, "pilot", frame, 1_000).await;
    assert!(replies.is_empty(), "{replies:?}");
    let mut rates = Vec::new();
    for _ in 0..20 {
        rates = yaw_rates(&fake);
        if !rates.is_empty() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    assert!(
        rates
            .iter()
            .any(|r| (r - std::f32::consts::FRAC_PI_4).abs() < 1e-6),
        "{rates:?}"
    );
}

/// A page load / tab close / deadman with no stick never cancels FC pointing.
#[tokio::test]
async fn ws_zeros_without_movement_send_nothing() {
    use rgcs_server::ws::{close_session, deadman_tick, handle_client};
    let (_app, state, fake, _cookie) = bound_app(FakeConfig::default()).await;
    let select = r#"{"t":"select","sysid":1}"#;
    let (gate, _) = handle_client(&Gate::default(), &state, "pilot", select, 1_000).await;
    let other = r#"{"t":"select","sysid":2}"#;
    let (gate, _) = handle_client(&gate, &state, "pilot", other, 1_100).await;
    let (gate, _) = handle_client(&gate, &state, "pilot", select, 1_200).await;
    let hb = r#"{"t":"input_hb","sysid":1}"#;
    let (gate, _) = handle_client(&gate, &state, "pilot", hb, 1_300).await;
    let (gate, _) = deadman_tick(&gate, &state, "pilot", 3_000).await;
    close_session(&gate, &state, "pilot").await;
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert!(yaw_rates(&fake).is_empty(), "{:?}", fake.sent());
}

#[tokio::test]
async fn ws_close_after_movement_stops_the_gimbal() {
    use rgcs_server::ws::{close_session, handle_client};
    let (_app, state, fake, _cookie) = bound_app(FakeConfig::default()).await;
    let frame = r#"{"t":"gimbal_rate","sysid":1,"yaw":50,"pitch":0,"seq":1}"#;
    let (gate, _) = handle_client(&Gate::default(), &state, "pilot", frame, 1_000).await;
    close_session(&gate, &state, "pilot").await;
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert_eq!(yaw_rates(&fake).last(), Some(&0.0), "{:?}", yaw_rates(&fake));
}

#[tokio::test]
async fn auto_record_starts_on_arm() {
    let (_app, state, fake, _cookie) = bound_app(FakeConfig::default()).await;
    let runner = rgcs_server::auto_record::spawn(state.clone());
    tokio::time::sleep(Duration::from_millis(700)).await;
    seed_vehicle(&state, 1, true, false).await;
    let started = saw_command(&fake, MavCmd::MAV_CMD_VIDEO_START_CAPTURE, 3_000).await;
    runner.abort();
    assert!(started, "{:?}", fake.commands());
}
