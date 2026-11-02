mod common;

use std::time::Duration;

use axum::http::{Method, StatusCode};
use common::*;
use rgcs_core::{CalibFrame, CalibKind, CalibPhase, VehicleCommand};
use serde_json::{json, Value};

const BASE: &str = "/api/vehicles/1/calibration";

async fn post(app: &axum::Router, cookie: &str, path: &str, body: Value) -> (StatusCode, Value) {
    let (status, body, _) = call(app, req(Method::POST, path, Some(cookie), Some(body))).await;
    (status, body)
}

async fn token(app: &axum::Router, cookie: &str, cmd: &str) -> String {
    let (status, body) = post(app, cookie, "/api/vehicles/1/confirm", json!({ "cmd": cmd })).await;
    assert_eq!(status, StatusCode::OK);
    body["data"]["confirm_token"].as_str().unwrap().to_string()
}

fn other(cmd: &VehicleCommand) -> (u16, [f32; 7]) {
    match cmd {
        VehicleCommand::Other { mav_cmd, params } => (*mav_cmd, *params),
        c => panic!("{c:?}"),
    }
}

#[tokio::test]
async fn level_is_one_command_and_its_date_is_listed_afterwards() {
    let (app, state, mut sent, _out) = spawn_app_recording().await;
    seed_vehicle(&state, 1, false, false).await;
    let cookie = login(&app).await;
    let (status, body) = post(&app, &cookie, BASE, json!({ "kind": "level" })).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["data"]["phase"], "done");
    assert_eq!(
        other(&sent.recv().await.unwrap()),
        (241, [0.0, 0.0, 0.0, 0.0, 2.0, 0.0, 0.0])
    );
    for _ in 0..50 {
        let (_, list, _) = call(&app, req(Method::GET, BASE, Some(&cookie), None)).await;
        if list["data"]["records"].as_array().is_some_and(|r| !r.is_empty()) {
            assert_eq!(list["data"]["records"][0]["kind"], "level");
            assert_eq!(list["data"]["records"][0]["operator"], "admin");
            return;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    panic!("no record");
}

#[tokio::test]
async fn accel_walks_through_the_positions_the_vehicle_asks_for() {
    let (app, state, mut sent, _out) = spawn_app_recording().await;
    seed_vehicle(&state, 1, false, false).await;
    let cookie = login(&app).await;
    let (status, body) = post(&app, &cookie, BASE, json!({ "kind": "accel" })).await;
    assert_eq!(
        (status, body["data"]["phase"].as_str()),
        (StatusCode::OK, Some("running"))
    );
    assert_eq!(other(&sent.recv().await.unwrap()).1[4], 1.0);
    // nothing to confirm before the vehicle asks
    let (status, _) = post(&app, &cookie, &format!("{BASE}/next"), json!({})).await;
    assert_eq!(status, StatusCode::CONFLICT);
    state.calib.on_frame(1, &CalibFrame::AccelPos(3));
    let (status, body) = post(&app, &cookie, &format!("{BASE}/next"), json!({})).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        other(&sent.recv().await.unwrap()),
        (42429, [3.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0])
    );
    assert_eq!(body["data"]["phase"], "running");
    // a second start while it runs is refused
    let (status, body) = post(&app, &cookie, BASE, json!({ "kind": "level" })).await;
    assert_eq!((status, error_code(&body)), (StatusCode::CONFLICT, "busy"));
}

#[tokio::test]
async fn compass_starts_onboard_calibration_and_cancel_stops_it() {
    let (app, state, mut sent, _out) = spawn_app_recording().await;
    seed_vehicle(&state, 1, false, false).await;
    let cookie = login(&app).await;
    post(&app, &cookie, BASE, json!({ "kind": "compass" })).await;
    assert_eq!(
        other(&sent.recv().await.unwrap()),
        (42424, [0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0])
    );
    let (status, body) = post(&app, &cookie, &format!("{BASE}/cancel"), json!({})).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"]["phase"], "cancelled");
    assert_eq!(other(&sent.recv().await.unwrap()).0, 42426);
}

#[tokio::test]
async fn armed_vehicles_and_unknown_kinds_are_refused() {
    let (app, state, _sent, _out) = spawn_app_recording().await;
    seed_vehicle(&state, 1, true, false).await;
    let cookie = login(&app).await;
    let (status, body) = post(&app, &cookie, BASE, json!({ "kind": "level" })).await;
    assert_eq!(
        (status, error_code(&body)),
        (StatusCode::CONFLICT, "vehicle_armed")
    );
    let (status, _) = post(&app, &cookie, BASE, json!({ "kind": "gyro" })).await;
    assert!(status.is_client_error());
    let (status, _) = post(
        &app,
        &cookie,
        "/api/vehicles/7/calibration",
        json!({ "kind": "level" }),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn rc_streams_input_then_writes_the_swept_channels() {
    let (app, state, mut sent, mut out) = spawn_app_recording().await;
    seed_vehicle(&state, 1, false, false).await;
    let cookie = login(&app).await;
    post(&app, &cookie, BASE, json!({ "kind": "rc" })).await;
    // RC_CHANNELS (65) at 10 Hz while calibrating
    assert_eq!(
        other(&sent.recv().await.unwrap()),
        (511, [65.0, 100_000.0, 0.0, 0.0, 0.0, 0.0, 0.0])
    );
    for v in [
        vec![1500, 1500],
        vec![1000, 1550],
        vec![2000, 1500],
        vec![1520, 1500],
    ] {
        state.calib.on_frame(1, &CalibFrame::RcChannels(v));
    }
    // the fake vehicle echoes every PARAM_SET
    let params = state.params.clone();
    tokio::spawn(async move {
        while let Some(o) = out.recv().await {
            if let mavlink::dialects::ardupilotmega::MavMessage::PARAM_SET(p) = o.message {
                let name = String::from_utf8_lossy(&*p.param_id)
                    .trim_end_matches('\0')
                    .to_string();
                params.set(1, &name, p.param_value);
            }
        }
    });
    let (status, body) = post(&app, &cookie, &format!("{BASE}/finish"), json!({})).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["data"]["phase"], "done");
    assert_eq!(state.params.get(1, "RC1_MIN"), Some(1000.0));
    assert_eq!(state.params.get(1, "RC1_MAX"), Some(2000.0));
    assert_eq!(state.params.get(1, "RC1_TRIM"), Some(1520.0));
    assert_eq!(state.params.get(1, "RC2_MIN"), None);
    // the stream goes back to the vehicle's own rate
    assert_eq!(
        other(&sent.recv().await.unwrap()),
        (511, [65.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0])
    );
    assert_eq!(state.calib.get(1).unwrap().kind, CalibKind::Rc);
    assert_eq!(state.calib.get(1).unwrap().phase, CalibPhase::Done);
}

#[tokio::test]
async fn motor_test_needs_a_confirm_token_and_sane_values() {
    let (app, state, mut sent, _out) = spawn_app_recording().await;
    seed_vehicle(&state, 1, false, false).await;
    let cookie = login(&app).await;
    let path = "/api/vehicles/1/motor-test";
    let (status, body) = post(&app, &cookie, path, json!({ "motor": 2, "pct": 5, "seconds": 2 })).await;
    assert_eq!(
        (status, error_code(&body)),
        (StatusCode::CONFLICT, "confirm_required")
    );
    let t = token(&app, &cookie, "motor_test").await;
    let (status, _) = post(
        &app,
        &cookie,
        path,
        json!({ "motor": 2, "pct": 150, "seconds": 2, "confirm_token": t }),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    let t = token(&app, &cookie, "motor_test").await;
    let (status, body) = post(
        &app,
        &cookie,
        path,
        json!({ "motor": 2, "pct": 5, "seconds": 2, "confirm_token": t }),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        other(&sent.recv().await.unwrap()),
        (209, [2.0, 0.0, 5.0, 2.0, 0.0, 0.0, 0.0])
    );
    // all motors in sequence: start at 1, count in param5
    let t = token(&app, &cookie, "motor_test").await;
    post(
        &app,
        &cookie,
        path,
        json!({ "motor": 1, "count": 4, "pct": 5, "seconds": 1, "confirm_token": t }),
    )
    .await;
    assert_eq!(
        other(&sent.recv().await.unwrap()),
        (209, [1.0, 0.0, 5.0, 1.0, 4.0, 0.0, 0.0])
    );
}

#[tokio::test]
async fn esc_needs_a_confirm_token_and_arms_the_next_boot() {
    let (app, state, _sent, mut out) = spawn_app_recording().await;
    seed_vehicle(&state, 1, false, false).await;
    seed_param(&state, 1, "ESC_CALIBRATION", 0.0);
    let cookie = login(&app).await;
    let (status, body) = post(&app, &cookie, BASE, json!({ "kind": "esc" })).await;
    assert_eq!(
        (status, error_code(&body)),
        (StatusCode::CONFLICT, "confirm_required")
    );
    let params = state.params.clone();
    tokio::spawn(async move {
        while let Some(o) = out.recv().await {
            if let mavlink::dialects::ardupilotmega::MavMessage::PARAM_SET(p) = o.message {
                params.set(1, "ESC_CALIBRATION", p.param_value);
            }
        }
    });
    let t = token(&app, &cookie, "calib_esc").await;
    let (status, body) = post(&app, &cookie, BASE, json!({ "kind": "esc", "confirm_token": t })).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["data"]["phase"], "done");
    assert_eq!(state.params.get(1, "ESC_CALIBRATION"), Some(3.0));
}

#[tokio::test]
async fn a_vehicle_armed_mid_session_cannot_take_the_next_step_or_the_rc_write() {
    let (app, state, _sent, _out) = spawn_app_recording().await;
    seed_vehicle(&state, 1, false, false).await;
    let cookie = login(&app).await;
    post(&app, &cookie, BASE, json!({ "kind": "rc" })).await;
    state.calib.on_frame(1, &CalibFrame::RcChannels(vec![1000]));
    state.calib.on_frame(1, &CalibFrame::RcChannels(vec![2000]));
    seed_vehicle(&state, 1, true, false).await;
    let (status, body) = post(&app, &cookie, &format!("{BASE}/finish"), json!({})).await;
    assert_eq!(
        (status, error_code(&body)),
        (StatusCode::CONFLICT, "vehicle_armed")
    );
    assert_eq!(state.params.get(1, "RC1_MIN"), None);
    let (status, body) = post(&app, &cookie, &format!("{BASE}/next"), json!({})).await;
    assert_eq!(
        (status, error_code(&body)),
        (StatusCode::CONFLICT, "vehicle_armed")
    );
}
