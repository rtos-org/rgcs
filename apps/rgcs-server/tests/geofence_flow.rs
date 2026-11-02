//! Fence and rally upload / download against the fake vehicle (user request 2026-10-19):
//! the lists go out with their own MAV_MISSION_TYPE and no home slot, then are read back.

mod common;

use std::sync::{Arc, Mutex};

use axum::http::{Method, StatusCode};
use common::*;
use mavlink::dialects::ardupilotmega::{MavMissionType, MISSION_ITEM_INT_DATA};
use serde_json::{json, Value};

fn stored() -> Arc<Mutex<Vec<MISSION_ITEM_INT_DATA>>> {
    Arc::new(Mutex::new(Vec::new()))
}

fn square() -> Value {
    json!({ "kind": "polygon", "inclusion": true, "vertices": [
        { "lat": 36.25, "lon": 137.63 }, { "lat": 36.25, "lon": 137.64 },
        { "lat": 36.26, "lon": 137.64 }, { "lat": 36.26, "lon": 137.63 }
    ] })
}

#[tokio::test]
async fn a_fence_is_written_as_fence_items_and_read_back() {
    let (app, state, rx) = spawn_app_with_link().await;
    seed_vehicle(&state, 1, true, false).await;
    let cookie = login(&app).await;
    let on_board = stored();
    let _fake = fake_vehicle_mission(rx, state.missions.clone(), 1, on_board.clone(), FakeMode::Normal);
    let circle = json!({ "kind": "circle", "inclusion": false, "center": { "lat": 36.255, "lon": 137.635 }, "radius": 40.0 });
    let body = json!({ "zones": [square(), circle] });
    let (status, reply, _) = call(
        &app,
        req(Method::PUT, "/api/vehicles/1/fence", Some(&cookie), Some(body)),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{reply}");
    assert_eq!(reply["data"]["verified"], true);
    assert_eq!(reply["data"]["items"], 5);
    {
        let items = on_board.lock().unwrap();
        assert_eq!(items.len(), 5, "4 vertices + 1 circle, no home slot");
        assert!(items
            .iter()
            .all(|i| i.mission_type == MavMissionType::MAV_MISSION_TYPE_FENCE));
        assert_eq!((items[0].command as u16, items[0].param1), (5001, 4.0));
        assert_eq!((items[4].command as u16, items[4].param1), (5004, 40.0));
    }
    let (status, reply, _) = call(
        &app,
        req(Method::GET, "/api/vehicles/1/fence", Some(&cookie), None),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{reply}");
    assert_eq!(reply["data"]["zones"].as_array().unwrap().len(), 2);
    assert_eq!(reply["data"]["zones"][1]["radius"], 40.0);
}

#[tokio::test]
async fn an_invalid_fence_is_refused_before_anything_is_sent() {
    let (app, state, mut rx) = spawn_app_with_link().await;
    seed_vehicle(&state, 1, false, false).await;
    let cookie = login(&app).await;
    let two = json!({ "kind": "polygon", "inclusion": true, "vertices": [{ "lat": 36.25, "lon": 137.63 }, { "lat": 36.25, "lon": 137.64 }] });
    let (status, reply, _) = call(
        &app,
        req(
            Method::PUT,
            "/api/vehicles/1/fence",
            Some(&cookie),
            Some(json!({ "zones": [two] })),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{reply}");
    assert_eq!(reply["error"]["code"], "fence_invalid");
    assert_eq!(reply["data"]["findings"][0]["code"], "fence_vertices");
    assert!(rx.try_recv().is_err(), "nothing was sent to the link");
}

#[tokio::test]
async fn rally_points_round_trip_with_whole_metre_altitudes() {
    let (app, state, rx) = spawn_app_with_link().await;
    seed_vehicle(&state, 1, false, false).await;
    let cookie = login(&app).await;
    let on_board = stored();
    let _fake = fake_vehicle_mission(rx, state.missions.clone(), 1, on_board.clone(), FakeMode::Normal);
    // ArduPilot keeps rally altitudes as whole metres (int16): 60.4 goes out as 60
    let body = json!({ "points": [{ "lat": 36.251, "lon": 137.631, "alt": 60.4 }, { "lat": 36.252, "lon": 137.632, "alt": 80.0 }] });
    let (status, reply, _) = call(
        &app,
        req(Method::PUT, "/api/vehicles/1/rally", Some(&cookie), Some(body)),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{reply}");
    assert_eq!(reply["data"]["verified"], true);
    assert!(on_board
        .lock()
        .unwrap()
        .iter()
        .all(|i| i.mission_type == MavMissionType::MAV_MISSION_TYPE_RALLY && i.command as u16 == 5100));
    let (_, reply, _) = call(
        &app,
        req(Method::GET, "/api/vehicles/1/rally", Some(&cookie), None),
    )
    .await;
    assert_eq!(reply["data"]["points"][0]["alt"], 60.0);
    assert_eq!(reply["data"]["points"].as_array().unwrap().len(), 2);
}

#[tokio::test]
async fn an_invalid_rally_point_is_refused_before_anything_is_sent() {
    let (app, state, mut rx) = spawn_app_with_link().await;
    seed_vehicle(&state, 1, false, false).await;
    let cookie = login(&app).await;
    let body = json!({ "points": [{ "lat": 136.0, "lon": 137.6, "alt": 60.0 }] });
    let (status, reply, _) = call(
        &app,
        req(Method::PUT, "/api/vehicles/1/rally", Some(&cookie), Some(body)),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{reply}");
    assert_eq!(reply["error"]["code"], "rally_invalid");
    assert_eq!(reply["data"]["findings"][0]["code"], "rally_position");
    assert!(rx.try_recv().is_err(), "nothing was sent to the link");
}

#[tokio::test]
async fn fence_params_report_the_altitude_ceiling_and_whether_zones_are_enforced() {
    let (app, state, _rx) = spawn_app_with_link().await;
    seed_vehicle(&state, 1, false, false).await;
    let cookie = login(&app).await;
    seed_param(&state, 1, "FENCE_ENABLE", 1.0);
    seed_param(&state, 1, "FENCE_ALT_MAX", 120.0);
    seed_param(&state, 1, "FENCE_TYPE", 7.0);
    let (status, reply, _) = call(
        &app,
        req(Method::GET, "/api/vehicles/1/fence/params", Some(&cookie), None),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{reply}");
    assert_eq!(
        reply["data"],
        json!({ "enabled": true, "alt_max": 120.0, "alt_max_on": true, "zones_on": true })
    );
    seed_param(&state, 1, "FENCE_TYPE", 2.0);
    let (_, reply, _) = call(
        &app,
        req(Method::GET, "/api/vehicles/1/fence/params", Some(&cookie), None),
    )
    .await;
    assert_eq!(
        (
            reply["data"]["alt_max_on"].clone(),
            reply["data"]["zones_on"].clone()
        ),
        (json!(false), json!(false))
    );
}
