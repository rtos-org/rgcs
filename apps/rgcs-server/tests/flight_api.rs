//! Flight records, squawks and maintenance API (様式 1, 3).

mod common;

use axum::http::{Method, StatusCode};
use common::{call, error_code, login, req, seed_vehicle, spawn_app};
use serde_json::{json, Value};

/// 2026-12-01 23:30 JST.
const T0: u64 = 1_796_050_800_000 + 23 * 3_600_000 + 30 * 60_000;

fn flight_body(takeoff: u64, landed: u64) -> Value {
    json!({
        "pilot": "admin", "pilot_license": "", "takeoff_at": takeoff, "landed_at": landed,
        "takeoff_place": "", "landing_place": "", "purposes": ["空撮"], "specific_flight": [],
        "summary": "", "safety_notes": ""
    })
}

async fn create(app: &axum::Router, cookie: &str, sysid: u8) -> Value {
    let (status, body, _) = call(
        app,
        req(
            Method::POST,
            &format!("/api/vehicles/{sysid}/flights"),
            Some(cookie),
            Some(flight_body(T0, T0 + 120_000)),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    body["data"].clone()
}

#[tokio::test]
async fn manual_flight_then_patch_and_confirm() {
    let (app, state) = spawn_app().await;
    seed_vehicle(&state, 1, false, false).await;
    let admin = login(&app).await;
    let f = create(&app, &admin, 1).await;
    let id = f["id"].as_i64().unwrap();
    assert_eq!(
        (f["status"].as_str(), f["flight_minutes"].as_u64()),
        (Some("draft"), Some(2))
    );

    let (status, body, _) = call(
        &app,
        req(
            Method::PATCH,
            &format!("/api/vehicles/1/flights/{id}"),
            Some(&admin),
            Some(json!({ "takeoff_place": "A" })),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        (
            body["data"]["id"].as_i64(),
            body["data"]["takeoff_place"].as_str()
        ),
        (Some(id), Some("A"))
    );
    let (status, body, _) = call(
        &app,
        req(
            Method::PATCH,
            &format!("/api/vehicles/1/flights/{id}"),
            Some(&admin),
            Some(json!({ "status": "confirmed" })),
        ),
    )
    .await;
    assert_eq!(
        (status, body["data"]["status"].as_str()),
        (StatusCode::OK, Some("confirmed"))
    );
    let (status, body, _) = call(
        &app,
        req(
            Method::PATCH,
            &format!("/api/vehicles/1/flights/{id}"),
            Some(&admin),
            Some(json!({ "landed_at": T0 - 1 })),
        ),
    )
    .await;
    assert_eq!(
        (status, error_code(&body)),
        (StatusCode::BAD_REQUEST, "validation")
    );
    let (_, audit, _) = call(
        &app,
        req(Method::GET, "/api/history/audit?limit=10", Some(&admin), None),
    )
    .await;
    let cmds: Vec<&str> = audit["data"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|e| e["command"].as_str())
        .collect();
    assert!(
        cmds.contains(&"flight_create") && cmds.contains(&"flight_patch"),
        "{cmds:?}"
    );
}

#[tokio::test]
async fn confirmed_flight_patch_returns_the_superseding_row() {
    let (app, state) = spawn_app().await;
    seed_vehicle(&state, 1, false, false).await;
    let admin = login(&app).await;
    let id = create(&app, &admin, 1).await["id"].as_i64().unwrap();
    call(
        &app,
        req(
            Method::PATCH,
            &format!("/api/vehicles/1/flights/{id}"),
            Some(&admin),
            Some(json!({ "status": "confirmed" })),
        ),
    )
    .await;
    let (status, body, _) = call(
        &app,
        req(
            Method::PATCH,
            &format!("/api/vehicles/1/flights/{id}"),
            Some(&admin),
            Some(json!({ "summary": "fixed" })),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let new_id = body["data"]["id"].as_i64().unwrap();
    assert_ne!(new_id, id);
    assert_eq!(body["data"]["supersedes"].as_i64(), Some(id));
    let (_, list, _) = call(
        &app,
        req(Method::GET, "/api/vehicles/1/flights", Some(&admin), None),
    )
    .await;
    let rows = list["data"].as_array().unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(
        (rows[0]["id"].as_i64(), rows[0]["summary"].as_str()),
        (Some(new_id), Some("fixed"))
    );
    let (_, list, _) = call(
        &app,
        req(
            Method::GET,
            "/api/vehicles/1/flights?from=2026-12-02",
            Some(&admin),
            None,
        ),
    )
    .await;
    assert!(list["data"].as_array().unwrap().is_empty());
}

#[tokio::test]
async fn delete_refuses_confirmed() {
    let (app, state) = spawn_app().await;
    seed_vehicle(&state, 1, false, false).await;
    let admin = login(&app).await;
    let id = create(&app, &admin, 1).await["id"].as_i64().unwrap();
    call(
        &app,
        req(
            Method::PATCH,
            &format!("/api/vehicles/1/flights/{id}"),
            Some(&admin),
            Some(json!({ "status": "confirmed" })),
        ),
    )
    .await;
    let (status, body, _) = call(
        &app,
        req(
            Method::DELETE,
            &format!("/api/vehicles/1/flights/{id}"),
            Some(&admin),
            None,
        ),
    )
    .await;
    assert_eq!((status, error_code(&body)), (StatusCode::CONFLICT, "confirmed"));
    let draft = create(&app, &admin, 1).await["id"].as_i64().unwrap();
    let (status, body, _) = call(
        &app,
        req(
            Method::DELETE,
            &format!("/api/vehicles/1/flights/{draft}"),
            Some(&admin),
            None,
        ),
    )
    .await;
    assert_eq!(
        (status, body["data"]["deleted"].as_bool()),
        (StatusCode::OK, Some(true))
    );
}

#[tokio::test]
async fn squawk_requires_a_date() {
    let (app, state) = spawn_app().await;
    seed_vehicle(&state, 1, false, false).await;
    let admin = login(&app).await;
    let id = create(&app, &admin, 1).await["id"].as_i64().unwrap();
    let path = format!("/api/vehicles/1/flights/{id}/squawks");
    let (status, body, _) = call(
        &app,
        req(Method::POST, &path, Some(&admin), Some(json!({ "occurred_on": "", "description": "振動", "action_on": "", "action": "", "confirmer": "" }))),
    )
    .await;
    assert_eq!(
        (status, error_code(&body)),
        (StatusCode::BAD_REQUEST, "validation")
    );
    let (status, body, _) = call(
        &app,
        req(Method::POST, &path, Some(&admin), Some(json!({ "occurred_on": "2026-12-05", "description": "振動", "action_on": "", "action": "", "confirmer": "" }))),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    assert_eq!(body["data"]["flight_id"].as_i64(), Some(id));
    let (_, list, _) = call(
        &app,
        req(Method::GET, "/api/vehicles/1/flights", Some(&admin), None),
    )
    .await;
    assert_eq!(list["data"][0]["squawks"].as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn maintenance_total_minutes_is_snapshotted() {
    let (app, state) = spawn_app().await;
    seed_vehicle(&state, 1, false, false).await;
    let admin = login(&app).await;
    let mut reg = json!({
        "name": "UAV-01", "registration": "", "uas_type": "", "model": "", "type_cert_no": "", "airworthiness_class": "",
        "airworthiness_no": "", "manufacturer": "", "serial_no": "", "initial_flight_minutes": 40, "inspection_template_id": null
    });
    let (status, _, _) = call(
        &app,
        req(
            Method::PUT,
            "/api/vehicles/1/registry",
            Some(&admin),
            Some(reg.take()),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let body = json!({ "performed_on": "2026-12-10", "detail": "プロペラ交換", "reason": "損傷", "place": "工場", "engineer": "admin", "notes": "", "supersedes": null });
    let (status, out, _) = call(
        &app,
        req(
            Method::POST,
            "/api/vehicles/1/maintenance",
            Some(&admin),
            Some(body.clone()),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{out}");
    assert_eq!(out["data"]["total_minutes"].as_u64(), Some(40));
    let mut bad = body.clone();
    bad["detail"] = json!("");
    let (status, out, _) = call(
        &app,
        req(
            Method::POST,
            "/api/vehicles/1/maintenance",
            Some(&admin),
            Some(bad),
        ),
    )
    .await;
    assert_eq!(
        (status, error_code(&out)),
        (StatusCode::BAD_REQUEST, "validation")
    );
    let (_, list, _) = call(
        &app,
        req(
            Method::GET,
            "/api/vehicles/1/maintenance?from=2026-12-01&to=2026-12-31",
            Some(&admin),
            None,
        ),
    )
    .await;
    assert_eq!(list["data"].as_array().unwrap().len(), 1);
    let (_, list, _) = call(
        &app,
        req(
            Method::GET,
            "/api/vehicles/1/maintenance?from=2026-12-11",
            Some(&admin),
            None,
        ),
    )
    .await;
    assert!(list["data"].as_array().unwrap().is_empty());
}

#[tokio::test]
async fn other_vehicles_flight_is_404() {
    let (app, state) = spawn_app().await;
    seed_vehicle(&state, 1, false, false).await;
    let admin = login(&app).await;
    let id = create(&app, &admin, 1).await["id"].as_i64().unwrap();
    let (status, _, _) = call(
        &app,
        req(
            Method::PATCH,
            &format!("/api/vehicles/2/flights/{id}"),
            Some(&admin),
            Some(json!({ "summary": "x" })),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _, _) = call(
        &app,
        req(
            Method::DELETE,
            &format!("/api/vehicles/2/flights/{id}"),
            Some(&admin),
            None,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _, _) = call(
        &app,
        req(Method::POST, &format!("/api/vehicles/2/flights/{id}/squawks"), Some(&admin), Some(json!({ "occurred_on": "2026-12-05", "description": "x", "action_on": "", "action": "", "confirmer": "" }))),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn superseded_flights_are_frozen() {
    let (app, state) = spawn_app().await;
    seed_vehicle(&state, 1, false, false).await;
    let admin = login(&app).await;
    let id = create(&app, &admin, 1).await["id"].as_i64().unwrap();
    let squawk = json!({ "occurred_on": "2026-12-05", "description": "x", "action_on": "", "action": "", "confirmer": "" });
    call(
        &app,
        req(
            Method::POST,
            &format!("/api/vehicles/1/flights/{id}/squawks"),
            Some(&admin),
            Some(squawk.clone()),
        ),
    )
    .await;
    call(
        &app,
        req(
            Method::PATCH,
            &format!("/api/vehicles/1/flights/{id}"),
            Some(&admin),
            Some(json!({ "status": "confirmed" })),
        ),
    )
    .await;
    let (_, body, _) = call(
        &app,
        req(
            Method::PATCH,
            &format!("/api/vehicles/1/flights/{id}"),
            Some(&admin),
            Some(json!({ "summary": "v2" })),
        ),
    )
    .await;
    let new_id = body["data"]["id"].as_i64().unwrap();
    assert_eq!(
        body["data"]["squawks"].as_array().unwrap().len(),
        1,
        "squawks follow the correction"
    );
    for request in [
        req(
            Method::PATCH,
            &format!("/api/vehicles/1/flights/{id}"),
            Some(&admin),
            Some(json!({ "summary": "v3" })),
        ),
        req(
            Method::DELETE,
            &format!("/api/vehicles/1/flights/{id}"),
            Some(&admin),
            None,
        ),
        req(
            Method::POST,
            &format!("/api/vehicles/1/flights/{id}/squawks"),
            Some(&admin),
            Some(squawk.clone()),
        ),
    ] {
        let (status, body, _) = call(&app, request).await;
        assert_eq!((status, error_code(&body)), (StatusCode::CONFLICT, "superseded"));
    }
    let (status, _, _) = call(
        &app,
        req(
            Method::POST,
            &format!("/api/vehicles/1/flights/{new_id}/squawks"),
            Some(&admin),
            Some(squawk),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
}

#[tokio::test]
async fn confirming_an_open_flight_is_refused() {
    let (app, state) = spawn_app().await;
    seed_vehicle(&state, 1, false, false).await;
    let admin = login(&app).await;
    let id = state
        .store
        .open_flight(1, "admin", "", T0, None, None, "system")
        .await
        .unwrap();
    let (status, body, _) = call(
        &app,
        req(
            Method::PATCH,
            &format!("/api/vehicles/1/flights/{id}"),
            Some(&admin),
            Some(json!({ "status": "confirmed" })),
        ),
    )
    .await;
    assert_eq!(
        (status, error_code(&body)),
        (StatusCode::BAD_REQUEST, "validation")
    );
}

#[tokio::test]
async fn maintenance_supersedes_must_be_an_own_live_record() {
    let (app, state) = spawn_app().await;
    seed_vehicle(&state, 1, false, false).await;
    seed_vehicle(&state, 2, false, false).await;
    let admin = login(&app).await;
    let body = |supersedes: Value| json!({ "performed_on": "2026-12-10", "detail": "x", "reason": "", "place": "", "engineer": "", "notes": "", "supersedes": supersedes });
    let (status, out, _) = call(
        &app,
        req(
            Method::POST,
            "/api/vehicles/1/maintenance",
            Some(&admin),
            Some(body(json!(999))),
        ),
    )
    .await;
    assert_eq!(
        (status, error_code(&out)),
        (StatusCode::BAD_REQUEST, "validation")
    );
    let (_, other, _) = call(
        &app,
        req(
            Method::POST,
            "/api/vehicles/2/maintenance",
            Some(&admin),
            Some(body(Value::Null)),
        ),
    )
    .await;
    let other_id = other["data"]["id"].as_i64().unwrap();
    let (status, out, _) = call(
        &app,
        req(
            Method::POST,
            "/api/vehicles/1/maintenance",
            Some(&admin),
            Some(body(json!(other_id))),
        ),
    )
    .await;
    assert_eq!(
        (status, error_code(&out)),
        (StatusCode::BAD_REQUEST, "validation")
    );
    let (_, mine, _) = call(
        &app,
        req(
            Method::POST,
            "/api/vehicles/1/maintenance",
            Some(&admin),
            Some(body(Value::Null)),
        ),
    )
    .await;
    let mine_id = mine["data"]["id"].as_i64().unwrap();
    let (status, _, _) = call(
        &app,
        req(
            Method::POST,
            "/api/vehicles/1/maintenance",
            Some(&admin),
            Some(body(json!(mine_id))),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let (status, out, _) = call(
        &app,
        req(
            Method::POST,
            "/api/vehicles/1/maintenance",
            Some(&admin),
            Some(body(json!(mine_id))),
        ),
    )
    .await;
    assert_eq!(
        (status, error_code(&out)),
        (StatusCode::BAD_REQUEST, "validation"),
        "already superseded"
    );
}

#[tokio::test]
async fn deleting_a_draft_with_an_attached_log_detaches_it() {
    let (app, state) = spawn_app().await;
    seed_vehicle(&state, 1, false, false).await;
    let admin = login(&app).await;
    let id = create(&app, &admin, 1).await["id"].as_i64().unwrap();
    let log = state
        .store
        .add_log(
            1,
            Some(id),
            None,
            "x.bin",
            1,
            rgcs_core::LogSource::Upload,
            "admin",
        )
        .await
        .unwrap();
    let (status, body, _) = call(
        &app,
        req(
            Method::DELETE,
            &format!("/api/vehicles/1/flights/{id}"),
            Some(&admin),
            None,
        ),
    )
    .await;
    assert_eq!(
        (status, body["data"]["deleted"].as_bool()),
        (StatusCode::OK, Some(true)),
        "{body}"
    );
    assert_eq!(state.store.log(log.id).await.unwrap().unwrap().flight_id, None);
}
