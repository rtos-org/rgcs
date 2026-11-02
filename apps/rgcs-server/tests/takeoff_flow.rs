mod common;

use axum::http::{Method, StatusCode};
use common::*;
use mavlink::dialects::ardupilotmega::{
    MavAutopilot, MavLandedState, MavMessage, MavModeFlag, MavState, MavType, MavVtolState,
    EXTENDED_SYS_STATE_DATA, HEARTBEAT_DATA,
};
use mavlink::MavHeader;
use rgcs_core::VehicleCommand;
use rgcs_mavlink::Clock;
use rgcs_server::app::AppState;
use serde_json::{json, Value};

async fn token(app: &axum::Router, cookie: &str) -> String {
    let (status, body, _) = call(
        app,
        req(
            Method::POST,
            "/api/vehicles/1/confirm",
            Some(cookie),
            Some(json!({ "cmd": "takeoff" })),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    body["data"]["confirm_token"].as_str().unwrap().to_string()
}

async fn takeoff(app: &axum::Router, cookie: &str, alt: Value, token: Option<&str>) -> (StatusCode, Value) {
    let mut body = json!({ "cmd": "takeoff", "args": { "alt_rel": alt } });
    if let Some(t) = token {
        body["confirm_token"] = json!(t);
    }
    let (status, resp, _) = call(
        app,
        req(Method::POST, "/api/vehicles/1/command", Some(cookie), Some(body)),
    )
    .await;
    (status, resp)
}

#[tokio::test]
async fn takeoff_without_a_token_is_409_confirm_required() {
    let (app, state) = spawn_app().await;
    seed_vehicle(&state, 1, true, false).await;
    let cookie = login(&app).await;
    let (status, body) = takeoff(&app, &cookie, json!(30), None).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(error_code(&body), "confirm_required");
}

#[tokio::test]
async fn takeoff_altitude_out_of_range_is_400_invalid() {
    let (app, state) = spawn_app().await;
    seed_vehicle(&state, 1, true, false).await;
    let cookie = login(&app).await;
    for alt in [json!(0), json!(1001), json!(-5)] {
        let t = token(&app, &cookie).await;
        let (status, body) = takeoff(&app, &cookie, alt.clone(), Some(&t)).await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{alt} -> {body}");
        assert_eq!(error_code(&body), "invalid");
    }
}

#[tokio::test]
async fn takeoff_while_disarmed_is_409_arm_first() {
    let (app, state) = spawn_app().await;
    seed_vehicle(&state, 1, false, false).await;
    let cookie = login(&app).await;
    let t = token(&app, &cookie).await;
    let (status, body) = takeoff(&app, &cookie, json!(30), Some(&t)).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(error_code(&body), "rejected");
    assert_eq!(body["error"]["message"], "arm first");
}

#[tokio::test]
async fn confirmed_takeoff_of_an_armed_copter_is_queued() {
    let (app, state, mut recorded, _out) = spawn_app_recording().await;
    seed_vehicle(&state, 1, true, false).await;
    let cookie = login(&app).await;
    let t = token(&app, &cookie).await;
    let (status, body) = takeoff(&app, &cookie, json!(20), Some(&t)).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        recorded.recv().await,
        Some(VehicleCommand::Takeoff { alt_rel: 20.0 })
    );
}

const HEADER: MavHeader = MavHeader {
    system_id: 1,
    component_id: 1,
    sequence: 0,
};

/// An armed ArduPlane in FBWA (5); QuadPlanes report FIXED_WING too.
async fn seed_armed_plane(app: &AppState) {
    let hb = HEARTBEAT_DATA {
        custom_mode: 5,
        mavtype: MavType::MAV_TYPE_FIXED_WING,
        autopilot: MavAutopilot::MAV_AUTOPILOT_ARDUPILOTMEGA,
        base_mode: MavModeFlag::MAV_MODE_FLAG_CUSTOM_MODE_ENABLED | MavModeFlag::MAV_MODE_FLAG_SAFETY_ARMED,
        system_status: MavState::MAV_STATE_ACTIVE,
        mavlink_version: 3,
    };
    let mut router = app.router.lock().await;
    router.on_message(&HEADER, &MavMessage::HEARTBEAT(hb), Clock::default());
}

#[tokio::test]
async fn plane_takeoff_is_409_vtol_unknown_until_extended_sys_state_arrives() {
    let (app, state, mut recorded, _out) = spawn_app_recording().await;
    seed_armed_plane(&state).await;
    let cookie = login(&app).await;
    let t = token(&app, &cookie).await;
    let (status, body) = takeoff(&app, &cookie, json!(30), Some(&t)).await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(error_code(&body), "vtol_unknown");
    let ext = EXTENDED_SYS_STATE_DATA {
        vtol_state: MavVtolState::MAV_VTOL_STATE_MC,
        landed_state: MavLandedState::MAV_LANDED_STATE_ON_GROUND,
    };
    state
        .router
        .lock()
        .await
        .on_message(&HEADER, &MavMessage::EXTENDED_SYS_STATE(ext), Clock::default());
    let t = token(&app, &cookie).await;
    let (status, body) = takeoff(&app, &cookie, json!(30), Some(&t)).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        recorded.recv().await,
        Some(VehicleCommand::Takeoff { alt_rel: 30.0 })
    );
}
