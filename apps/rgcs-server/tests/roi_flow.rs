//! ROI REST API, manual-input cancel and audit.
mod common;

use std::time::Duration;

use axum::http::{Method, StatusCode};
use common::*;
use rgcs_camera::siyi::sim::SimServer;
use rgcs_server::app::AppState;
use serde_json::{json, Value};

async fn put_mt11(app: &axum::Router, cookie: &str, port: u16) {
    let body = json!({ "kind": "siyi_mt11", "host": "127.0.0.1", "port": port });
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

async fn wait_connected(state: &AppState) {
    for _ in 0..80 {
        if state.cameras.ensure(1).await.state().borrow().connected {
            return;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    panic!("camera never connected");
}

fn targets(first_name: &str) -> Value {
    let rows: Vec<Value> = (1..=10)
        .map(|i| {
            if i == 1 && !first_name.is_empty() {
                json!({ "id": "roi_1", "name": first_name, "lat": 35.009, "lon": 139.0, "alt_msl": 12.5 })
            } else {
                json!({ "id": format!("roi_{i}"), "name": "", "lat": 0.0, "lon": 0.0, "alt_msl": 0.0 })
            }
        })
        .collect();
    Value::Array(rows)
}

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

/// Vehicle 1 with an MT11 (sim) and `roi_1` = "North"; returns the logged-in cookie.
async fn setup() -> (axum::Router, AppState, SimServer, String) {
    let (app, state, sim) = spawn_app_with_sim().await;
    seed_vehicle(&state, 1, false, false).await;
    let cookie = login(&app).await;
    put_mt11(&app, &cookie, sim.addr.port()).await;
    wait_connected(&state).await;
    let (s, v) = send(
        &app,
        &cookie,
        Method::PUT,
        "/api/vehicles/1/roi/targets",
        Some(targets("North")),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    seed_pose(&state, 1, 35.0, 139.0, 0, 9000).await;
    (app, state, sim, cookie)
}

async fn audit_rows(app: &axum::Router, cookie: &str) -> Vec<Value> {
    let (_, v) = send(app, cookie, Method::GET, "/api/history/audit?limit=50", None).await;
    v["data"].as_array().cloned().unwrap_or_default()
}

fn has_roi_row(rows: &[Value], command: &str, reason: Option<&str>) -> bool {
    rows.iter().any(|r| {
        r["target"] == "roi" && r["command"] == command && reason.is_none_or(|want| r["reason"] == want)
    })
}

#[tokio::test]
async fn targets_default_and_round_trip() {
    let (app, state) = spawn_app().await;
    seed_vehicle(&state, 1, false, false).await;
    let cookie = login(&app).await;
    let (s, v) = send(&app, &cookie, Method::GET, "/api/vehicles/1/roi/targets", None).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let list = v["data"].as_array().unwrap();
    assert_eq!(list.len(), 10);
    assert_eq!(list[9]["id"], "roi_10");
    assert_eq!(list[0]["name"], "");
    let (s, v) = send(
        &app,
        &cookie,
        Method::PUT,
        "/api/vehicles/1/roi/targets",
        Some(targets("Tower")),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["data"][0]["name"], "Tower");
    let (_, v) = send(&app, &cookie, Method::GET, "/api/vehicles/1/roi/targets", None).await;
    assert_eq!(v["data"][0]["name"], "Tower");
    assert_eq!(v["data"][0]["alt_msl"], 12.5);
    assert!(has_roi_row(&audit_rows(&app, &cookie).await, "targets", None));
}

#[tokio::test]
async fn targets_put_rejects_bad_rows() {
    let (app, state) = spawn_app().await;
    seed_vehicle(&state, 1, false, false).await;
    let cookie = login(&app).await;
    let mut bad = targets("Tower");
    bad[0]["lat"] = json!(91.0);
    let (s, v) = send(
        &app,
        &cookie,
        Method::PUT,
        "/api/vehicles/1/roi/targets",
        Some(bad),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "{v}");
    assert_eq!(error_code(&v), "validation");
    assert!(
        v["error"]["message"].as_str().unwrap().contains("targets[0].lat"),
        "{v}"
    );
    let nine = Value::Array(targets("").as_array().unwrap()[..9].to_vec());
    let (s, v) = send(
        &app,
        &cookie,
        Method::PUT,
        "/api/vehicles/1/roi/targets",
        Some(nine),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "{v}");
    assert_eq!(error_code(&v), "validation");
}

#[tokio::test]
async fn control_round_trip_and_validation() {
    let (app, state) = spawn_app().await;
    seed_vehicle(&state, 1, false, false).await;
    let cookie = login(&app).await;
    let (s, v) = send(&app, &cookie, Method::GET, "/api/vehicles/1/roi/control", None).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["data"]["control_mode"], "rate");
    assert_eq!(v["data"]["max_speed"], 60.0);
    let mut c = v["data"].clone();
    c["max_speed"] = json!(0.5);
    let (s, v) = send(
        &app,
        &cookie,
        Method::PUT,
        "/api/vehicles/1/roi/control",
        Some(c.clone()),
    )
    .await;
    assert_eq!(s, StatusCode::BAD_REQUEST, "{v}");
    assert!(
        v["error"]["message"].as_str().unwrap().contains("max_speed"),
        "{v}"
    );
    c["max_speed"] = json!(40.0);
    c["control_mode"] = json!("angle");
    let (s, v) = send(&app, &cookie, Method::PUT, "/api/vehicles/1/roi/control", Some(c)).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let (_, v) = send(&app, &cookie, Method::GET, "/api/vehicles/1/roi/control", None).await;
    assert_eq!(v["data"]["max_speed"], 40.0);
    assert_eq!(v["data"]["control_mode"], "angle");
    assert!(has_roi_row(&audit_rows(&app, &cookie).await, "control", None));
}

#[tokio::test]
async fn start_stop_with_sim() {
    let (app, state, _sim, cookie) = setup().await;
    let (s, v) = send(
        &app,
        &cookie,
        Method::POST,
        "/api/vehicles/1/roi/start",
        Some(json!({ "id": "roi_1" })),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(state.roi.active_target(1).as_deref(), Some("roi_1"));
    let (s, v) = send(&app, &cookie, Method::POST, "/api/vehicles/1/roi/stop", None).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["data"]["stopped"], true);
    assert_eq!(state.roi.active_target(1), None);
    let (_, v) = send(&app, &cookie, Method::POST, "/api/vehicles/1/roi/stop", None).await;
    assert_eq!(v["data"]["stopped"], false);
    let rows = audit_rows(&app, &cookie).await;
    assert!(rows
        .iter()
        .any(|r| r["target"] == "roi" && r["command"] == "start" && r["result"] == "ok"));
    assert!(has_roi_row(&rows, "stop", None));
}

#[tokio::test]
async fn start_errors_http() {
    let (app, _state, _sim, cookie) = setup().await;
    let start = |id: &'static str| {
        send(
            &app,
            &cookie,
            Method::POST,
            "/api/vehicles/1/roi/start",
            Some(json!({ "id": id })),
        )
    };
    let (s, v) = start("roi_9").await;
    assert_eq!(s, StatusCode::CONFLICT, "{v}");
    assert_eq!(error_code(&v), "roi_target_unset");
    let (s, v) = start("roi_99").await;
    assert_eq!(s, StatusCode::NOT_FOUND, "{v}");
    assert_eq!(error_code(&v), "not_found");
    let rows = audit_rows(&app, &cookie).await;
    assert!(rows
        .iter()
        .any(|r| r["target"] == "roi" && r["command"] == "start" && r["result"] == "rejected"));
    // Vehicle 2 has no camera profile: caps.roi = none.
    let (s, v) = send(
        &app,
        &cookie,
        Method::PUT,
        "/api/vehicles/2/roi/targets",
        Some(targets("North")),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    let (s, v) = send(
        &app,
        &cookie,
        Method::POST,
        "/api/vehicles/2/roi/start",
        Some(json!({ "id": "roi_1" })),
    )
    .await;
    assert_eq!(s, StatusCode::CONFLICT, "{v}");
    assert_eq!(error_code(&v), "unsupported_capability");
}

#[tokio::test]
async fn center_command_cancels_roi() {
    let (app, state, _sim, cookie) = setup().await;
    state.roi.start(1, "roi_1").await.unwrap();
    let body = json!({ "cmd": "gimbal_center", "args": { "mode": "one_key_reset" } });
    let (s, v) = send(
        &app,
        &cookie,
        Method::POST,
        "/api/vehicles/1/camera/command",
        Some(body),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(state.roi.active_target(1), None);
    let rows = audit_rows(&app, &cookie).await;
    assert!(has_roi_row(&rows, "stop", Some("manual_command")), "{rows:?}");
}

#[tokio::test]
async fn zoom_command_keeps_roi() {
    let (app, state, _sim, cookie) = setup().await;
    state.roi.start(1, "roi_1").await.unwrap();
    let body = json!({ "cmd": "zoom_step", "args": { "steps": 1 } });
    let (s, v) = send(
        &app,
        &cookie,
        Method::POST,
        "/api/vehicles/1/camera/command",
        Some(body),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(state.roi.active_target(1).as_deref(), Some("roi_1"));
}

#[tokio::test]
async fn unchanged_profile_put_keeps_roi_and_driver() {
    let (app, state, sim, cookie) = setup().await;
    state.roi.start(1, "roi_1").await.unwrap();
    let before = state.cameras.ensure(1).await;
    put_mt11(&app, &cookie, sim.addr.port()).await;
    assert_eq!(state.roi.active_target(1).as_deref(), Some("roi_1"));
    let after = state.cameras.ensure(1).await;
    assert!(
        std::sync::Arc::ptr_eq(&before, &after),
        "driver must not be reloaded"
    );
    let rows = audit_rows(&app, &cookie).await;
    assert!(!has_roi_row(&rows, "stop", None), "{rows:?}");
}

#[tokio::test]
async fn changed_profile_put_stops_roi_with_audit() {
    let (app, state, _sim, cookie) = setup().await;
    state.roi.start(1, "roi_1").await.unwrap();
    let body = json!({ "host": "127.0.0.2" });
    let (s, v) = send(
        &app,
        &cookie,
        Method::PUT,
        "/api/vehicles/1/camera/profile",
        Some(body),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(state.roi.active_target(1), None);
    let rows = audit_rows(&app, &cookie).await;
    assert!(has_roi_row(&rows, "stop", Some("profile_reload")), "{rows:?}");
}

#[tokio::test]
async fn targets_put_unsetting_active_slot_stops_roi() {
    let (app, state, _sim, cookie) = setup().await;
    state.roi.start(1, "roi_1").await.unwrap();
    let (s, v) = send(
        &app,
        &cookie,
        Method::PUT,
        "/api/vehicles/1/roi/targets",
        Some(targets("")),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(state.roi.active_target(1), None);
}

/// Waits until the driver knows the stream size (clicks need it).
async fn wait_stream(state: &AppState) {
    for _ in 0..80 {
        if state.cameras.ensure(1).await.state().borrow().stream.is_some() {
            return;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    panic!("stream size never read");
}

#[tokio::test]
async fn ai_select_stops_roi() {
    let (app, state, _sim, cookie) = setup().await;
    wait_stream(&state).await;
    state.roi.start(1, "roi_1").await.unwrap();
    let body = json!({ "cmd": "ai_select_box", "args": { "x": 0.5, "y": 0.5, "box_px": null } });
    let (s, v) = send(
        &app,
        &cookie,
        Method::POST,
        "/api/vehicles/1/camera/command",
        Some(body),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(state.roi.active_target(1), None);
    let rows = audit_rows(&app, &cookie).await;
    assert!(has_roi_row(&rows, "stop", Some("ai_tracking")), "{rows:?}");
}

#[tokio::test]
async fn roi_start_cancels_ai_tracking() {
    let (_app, state, mut sim, _cookie) = setup().await;
    while sim.received.try_recv().is_ok() {}
    state.roi.start(1, "roi_1").await.unwrap();
    let mut seen: Vec<(u8, Vec<u8>)> = Vec::new();
    for _ in 0..40 {
        while let Ok((_, cmd, payload)) = sim.received.try_recv() {
            seen.push((cmd, payload));
        }
        if seen.iter().any(|(c, _)| *c == 0x07) {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    let cancel = seen.iter().position(|(c, p)| *c == 0x56 && p.first() == Some(&0));
    let first_rate = seen.iter().position(|(c, _)| *c == 0x07);
    assert!(first_rate.is_some(), "ROI sent no 0x07: {seen:?}");
    assert!(
        cancel.is_some_and(|c| Some(c) < first_rate),
        "cancel before ROI 0x07: {seen:?}"
    );
}

#[tokio::test]
async fn profile_put_video_fields_keeps_driver() {
    let (app, state, mut sim, cookie) = setup().await;
    state.roi.start(1, "roi_1").await.unwrap();
    let before = state.cameras.ensure(1).await;
    while sim.received.try_recv().is_ok() {}
    let body = json!({ "encoding_preset": "h265_4k", "ai_box_px": 200 });
    let (s, v) = send(
        &app,
        &cookie,
        Method::PUT,
        "/api/vehicles/1/camera/profile",
        Some(body),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(v["data"]["ai_box_px"], 200);
    tokio::time::sleep(Duration::from_millis(300)).await;
    let mut reconnected = false;
    while let Ok((_, cmd, _)) = sim.received.try_recv() {
        reconnected |= cmd == 0x01;
    }
    assert!(!reconnected, "a video-field save must not reconnect the camera");
    assert_eq!(state.roi.active_target(1).as_deref(), Some("roi_1"));
    assert!(std::sync::Arc::ptr_eq(&before, &state.cameras.ensure(1).await));

    let body = json!({ "host": "127.0.0.2" });
    let (s, v) = send(
        &app,
        &cookie,
        Method::PUT,
        "/api/vehicles/1/camera/profile",
        Some(body),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert!(
        !std::sync::Arc::ptr_eq(&before, &state.cameras.ensure(1).await),
        "host change reloads"
    );
}

async fn post_cmd(app: &axum::Router, cookie: &str, body: Value) -> (StatusCode, Value) {
    send(
        app,
        cookie,
        Method::POST,
        "/api/vehicles/1/camera/command",
        Some(body),
    )
    .await
}

/// A click the driver refuses must leave ROI pointing (refusal first).
#[tokio::test]
async fn refused_ai_click_in_ir_keeps_roi() {
    let (app, state, _sim, cookie) = setup().await;
    let (s, v) = post_cmd(
        &app,
        &cookie,
        json!({ "cmd": "video_mode", "args": { "mode": "thermal" } }),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    for _ in 0..80 {
        if state.cameras.ensure(1).await.state().borrow().video_mode == Some(rgcs_core::VideoMode::Thermal) {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    state.roi.start(1, "roi_1").await.unwrap();
    let body = json!({ "cmd": "ai_select_box", "args": { "x": 0.5, "y": 0.5, "box_px": null } });
    let (s, v) = post_cmd(&app, &cookie, body).await;
    assert_eq!(s, StatusCode::CONFLICT, "{v}");
    assert_eq!(error_code(&v), "rgb_only");
    assert_eq!(state.roi.active_target(1).as_deref(), Some("roi_1"));
    let rows = audit_rows(&app, &cookie).await;
    assert!(!has_roi_row(&rows, "stop", None), "{rows:?}");
}

#[tokio::test]
async fn ai_point_missing_every_detection_keeps_roi() {
    let (app, state, _sim, cookie) = setup().await;
    wait_stream(&state).await;
    for _ in 0..80 {
        if !state
            .cameras
            .ensure(1)
            .await
            .state()
            .borrow()
            .candidates
            .is_empty()
        {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    state.roi.start(1, "roi_1").await.unwrap();
    let body = json!({ "cmd": "ai_select_point", "args": { "x": 0.05, "y": 0.05 } });
    let (s, v) = post_cmd(&app, &cookie, body).await;
    assert_eq!(s, StatusCode::CONFLICT, "{v}");
    assert_eq!(error_code(&v), "no_detection");
    assert_eq!(state.roi.active_target(1).as_deref(), Some("roi_1"));

    let body = json!({ "cmd": "ai_select_point", "args": { "x": 0.45, "y": 0.5 } });
    let (s, v) = post_cmd(&app, &cookie, body).await;
    assert_eq!(s, StatusCode::OK, "{v}");
    assert_eq!(
        state.roi.active_target(1),
        None,
        "an accepted select still stops ROI"
    );
}
