//! The written-plan record: a verified saved-plan upload remembers the plan id and version, a
//! content upload clears it, and every change is broadcast.

mod common;

use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::http::{Method, StatusCode};
use common::*;
use rgcs_core::{demo20, Assignment, Mission, ServerMessage, MAV_CMD_NAV_WAYPOINT};
use serde_json::{json, Value};
use tokio::sync::broadcast::Receiver;

fn stored() -> Arc<Mutex<Vec<mavlink::dialects::ardupilotmega::MISSION_ITEM_INT_DATA>>> {
    Arc::new(Mutex::new(Vec::new()))
}

async fn save_plan(app: &axum::Router, cookie: &str, m: &Mission) -> i64 {
    let body = serde_json::to_value(m).unwrap();
    let (status, body, _) = call(app, req(Method::POST, "/api/missions", Some(cookie), Some(body))).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    body["data"]["id"].as_i64().expect("id")
}

async fn plan_version(app: &axum::Router, cookie: &str, id: i64) -> u64 {
    let (status, body, _) = call(app, req(Method::GET, "/api/missions", Some(cookie), None)).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let rows = body["data"].as_array().unwrap();
    let row = rows.iter().find(|r| r["id"] == id).expect("listed");
    row["updated_at"].as_u64().expect("updated_at")
}

async fn upload_saved(app: &axum::Router, cookie: &str, id: i64) -> (StatusCode, Value) {
    let body = json!({ "mission_id": id });
    let (status, body, _) = call(
        app,
        req(
            Method::POST,
            "/api/vehicles/1/mission/upload",
            Some(cookie),
            Some(body),
        ),
    )
    .await;
    (status, body)
}

async fn row_for(app: &axum::Router, cookie: &str, sysid: u8) -> Value {
    let (status, body, _) = call(app, req(Method::GET, "/api/assignments", Some(cookie), None)).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let rows = body["data"].as_array().unwrap();
    rows.iter()
        .find(|r| r["sysid"] == sysid)
        .cloned()
        .unwrap_or(Value::Null)
}

async fn next_assignments(rx: &mut Receiver<ServerMessage>) -> Vec<Assignment> {
    tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            if let Ok(ServerMessage::Assignments { rows }) = rx.recv().await {
                return rows;
            }
        }
    })
    .await
    .expect("an assignments frame")
}

#[tokio::test]
async fn upload_saved_records_plan_and_version() {
    let (app, state, rx) = spawn_app_with_link().await;
    seed_vehicle(&state, 1, false, false).await;
    let cookie = login(&app).await;
    let plan = save_plan(&app, &cookie, &demo20()).await;
    let version = plan_version(&app, &cookie, plan).await;
    let _fake = fake_vehicle_mission(rx, state.missions.clone(), 1, stored(), FakeMode::Normal);
    let mut ws = state.tx.subscribe();
    let (status, body) = upload_saved(&app, &cookie, plan).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["data"]["verified"], true);

    let row = row_for(&app, &cookie, 1).await;
    assert_eq!(row["written"]["plan_id"], plan, "{row}");
    assert_eq!(row["written"]["plan_updated_at"], version, "{row}");
    assert_eq!(row["written"]["by"], "admin", "{row}");
    let rows = next_assignments(&mut ws).await;
    let written = rows[0].written.as_ref().expect("written in the frame");
    assert_eq!((written.plan_id, written.plan_updated_at), (plan, version));
}

#[tokio::test]
async fn a_failed_or_rejected_upload_records_nothing() {
    let (app, state, rx) = spawn_app_with_link().await;
    seed_vehicle(&state, 1, false, false).await;
    let cookie = login(&app).await;
    let good = save_plan(&app, &cookie, &demo20()).await;
    let mut bad = demo20();
    bad.items[0].command = MAV_CMD_NAV_WAYPOINT;
    let bad = save_plan(&app, &cookie, &bad).await;
    state.store.record_written(1, good, 1234, "pilot").await.unwrap();

    // a fatal finding: refused before anything reaches the link
    let (status, body) = upload_saved(&app, &cookie, bad).await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(error_code(&body), "mission_invalid");
    // the vehicle answers MISSION_ACK with an error
    let _fake = fake_vehicle_mission(rx, state.missions.clone(), 1, stored(), FakeMode::RejectAck);
    let (status, body) = upload_saved(&app, &cookie, good).await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(error_code(&body), "mission_rejected");

    let row = row_for(&app, &cookie, 1).await;
    assert_eq!(row["written"]["plan_id"], good, "{row}");
    assert_eq!(row["written"]["plan_updated_at"], 1234, "{row}");
    assert_eq!(row["written"]["by"], "pilot", "{row}");
}

#[tokio::test]
async fn a_content_upload_clears_the_record() {
    let (app, state, rx) = spawn_app_with_link().await;
    seed_vehicle(&state, 1, false, false).await;
    let cookie = login(&app).await;
    let plan = save_plan(&app, &cookie, &demo20()).await;
    state.store.record_written(1, plan, 1234, "pilot").await.unwrap();
    let _fake = fake_vehicle_mission(rx, state.missions.clone(), 1, stored(), FakeMode::Normal);
    let mut ws = state.tx.subscribe();
    let body = serde_json::to_value(demo20()).unwrap();
    let (status, body, _) = call(
        &app,
        req(Method::PUT, "/api/vehicles/1/mission", Some(&cookie), Some(body)),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["data"]["verified"], true);

    let row = row_for(&app, &cookie, 1).await;
    assert!(row["written"].is_null(), "{row}");
    let rows = next_assignments(&mut ws).await;
    assert!(rows[0].written.is_none(), "{rows:?}");
}

#[tokio::test]
async fn deleting_a_plan_broadcasts_assignments() {
    let (app, state) = spawn_app().await;
    let cookie = login(&app).await;
    let plan = save_plan(&app, &cookie, &demo20()).await;
    let (status, body, _) = call(
        &app,
        req(
            Method::PUT,
            "/api/assignments/2",
            Some(&cookie),
            Some(json!({ "plan_id": plan })),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let mut ws = state.tx.subscribe();
    let (status, _, _) = call(
        &app,
        req(
            Method::DELETE,
            &format!("/api/missions/{plan}"),
            Some(&cookie),
            None,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let rows = next_assignments(&mut ws).await;
    assert_eq!(rows[0].sysid, 2);
    assert_eq!(rows[0].plan_id, None, "the FK unassigned the deleted plan");
}
