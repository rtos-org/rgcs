//! DataFlash retrieval over LOG_REQUEST_* with progress, plus upload / attachment.

mod common;

use std::sync::Arc;
use std::time::Duration;

use axum::body::Body;
use axum::http::{header, Method, Request, StatusCode};
use common::{
    call, error_code, fake_log_bytes, fake_vehicle_logs, login, req, seed_vehicle, spawn_app_with_link, CSRF,
    FAKE_LOG_ID,
};
use http_body_util::BodyExt;
use rgcs_core::ServerMessage;
use serde_json::{json, Value};
use tower::ServiceExt;

const LOG_LEN: usize = 10_240;

async fn wait_done(rx: &mut tokio::sync::broadcast::Receiver<ServerMessage>) -> rgcs_core::LogFetchProgress {
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            if let Ok(ServerMessage::LogFetchProgress { sysid: 1, progress }) = rx.recv().await {
                if progress.done {
                    return progress;
                }
            }
        }
    })
    .await
    .expect("log_fetch_progress done within 10 s")
}

async fn get_file(app: &axum::Router, cookie: &str, path: &str) -> (StatusCode, Vec<u8>, String) {
    let request = Request::builder()
        .method(Method::GET)
        .uri(path)
        .header(header::COOKIE, cookie)
        .body(Body::empty())
        .unwrap();
    let res = app.clone().oneshot(request).await.unwrap();
    let status = res.status();
    let disposition = res
        .headers()
        .get(header::CONTENT_DISPOSITION)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let bytes = res.into_body().collect().await.unwrap().to_bytes().to_vec();
    (status, bytes, disposition)
}

#[tokio::test]
async fn fc_list_and_fetch_save_the_file_and_the_row() {
    let (app, state, rx) = spawn_app_with_link().await;
    seed_vehicle(&state, 1, false, false).await;
    let log = fake_log_bytes(LOG_LEN);
    let requests = Arc::new(std::sync::Mutex::new(Vec::new()));
    let _fc = fake_vehicle_logs(rx, state.logs.clone(), 1, log.clone(), None, requests.clone());
    let cookie = login(&app).await;

    let (status, body, _) = call(
        &app,
        req(Method::GET, "/api/vehicles/1/logs/fc", Some(&cookie), None),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["data"][0]["id"].as_u64(), Some(u64::from(FAKE_LOG_ID)));
    assert_eq!(body["data"][0]["size"].as_u64(), Some(LOG_LEN as u64));

    let mut ws = state.tx.subscribe();
    let (status, body, _) = call(
        &app,
        req(
            Method::POST,
            "/api/vehicles/1/logs/fetch",
            Some(&cookie),
            Some(json!({ "fc_log_id": FAKE_LOG_ID })),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::ACCEPTED, "{body}");
    let progress = wait_done(&mut ws).await;
    assert_eq!(
        (progress.received, progress.total, progress.error),
        (LOG_LEN as u64, LOG_LEN as u64, None)
    );

    let (_, body, _) = call(
        &app,
        req(Method::GET, "/api/vehicles/1/logs", Some(&cookie), None),
    )
    .await;
    assert_eq!(body["data"]["fetch_enabled"], true);
    let row = &body["data"]["logs"][0];
    assert_eq!(
        (
            row["source"].as_str(),
            row["size"].as_u64(),
            row["fc_log_id"].as_u64()
        ),
        (Some("mavlink"), Some(LOG_LEN as u64), Some(7))
    );
    let id = row["id"].as_i64().unwrap();
    let (status, bytes, disposition) =
        get_file(&app, &cookie, &format!("/api/vehicles/1/logs/{id}/file")).await;
    assert_eq!(status, StatusCode::OK);
    assert!(disposition.contains("attachment"), "{disposition}");
    assert_eq!(bytes, log);
    let (_, audit, _) = call(
        &app,
        req(Method::GET, "/api/history/audit?limit=5", Some(&cookie), None),
    )
    .await;
    assert!(audit["data"]
        .as_array()
        .unwrap()
        .iter()
        .any(|e| e["command"] == "log_fetch" && e["result"] == "ok"));
}

#[tokio::test]
async fn dropped_chunk_is_re_requested_and_the_file_is_exact() {
    let (app, state, rx) = spawn_app_with_link().await;
    seed_vehicle(&state, 1, false, false).await;
    let log = fake_log_bytes(LOG_LEN);
    let requests = Arc::new(std::sync::Mutex::new(Vec::new()));
    let _fc = fake_vehicle_logs(
        rx,
        state.logs.clone(),
        1,
        log.clone(),
        Some(2880),
        requests.clone(),
    );
    let cookie = login(&app).await;
    let mut ws = state.tx.subscribe();
    let (status, _, _) = call(
        &app,
        req(
            Method::POST,
            "/api/vehicles/1/logs/fetch",
            Some(&cookie),
            Some(json!({ "fc_log_id": FAKE_LOG_ID })),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::ACCEPTED);
    let progress = wait_done(&mut ws).await;
    assert_eq!(progress.error, None);
    let (_, body, _) = call(
        &app,
        req(Method::GET, "/api/vehicles/1/logs", Some(&cookie), None),
    )
    .await;
    let id = body["data"]["logs"][0]["id"].as_i64().unwrap();
    let (_, bytes, _) = get_file(&app, &cookie, &format!("/api/vehicles/1/logs/{id}/file")).await;
    assert_eq!(bytes, log, "byte-identical after the re-request");
    let asked = requests.lock().unwrap().clone();
    assert!(
        asked.iter().filter(|o| **o == 2880).count() >= 2,
        "offset 2880 asked again: {asked:?}"
    );
}

#[tokio::test]
async fn fetch_is_refused_when_disabled() {
    let (_app, state, _rx) = spawn_app_with_link().await;
    let state = state.with_log_fetch(false);
    let app = rgcs_server::app::build(state.clone(), None);
    seed_vehicle(&state, 1, false, false).await;
    let cookie = login(&app).await;
    let (status, body, _) = call(
        &app,
        req(Method::GET, "/api/vehicles/1/logs/fc", Some(&cookie), None),
    )
    .await;
    assert_eq!(
        (status, error_code(&body)),
        (StatusCode::SERVICE_UNAVAILABLE, "log_fetch_disabled")
    );
    let (status, body, _) = call(
        &app,
        req(
            Method::POST,
            "/api/vehicles/1/logs/fetch",
            Some(&cookie),
            Some(json!({ "fc_log_id": 7 })),
        ),
    )
    .await;
    assert_eq!(
        (status, error_code(&body)),
        (StatusCode::SERVICE_UNAVAILABLE, "log_fetch_disabled")
    );
    let (_, body, _) = call(
        &app,
        req(Method::GET, "/api/vehicles/1/logs", Some(&cookie), None),
    )
    .await;
    assert_eq!(body["data"]["fetch_enabled"], false);
}

#[tokio::test]
async fn upload_streams_to_disk_and_attaches_to_a_flight() {
    let (app, state, _rx) = spawn_app_with_link().await;
    seed_vehicle(&state, 1, false, false).await;
    let cookie = login(&app).await;
    let (_, flight, _) = call(
        &app,
        req(
            Method::POST,
            "/api/vehicles/1/flights",
            Some(&cookie),
            Some(json!({ "pilot": "a", "pilot_license": "", "takeoff_at": 1_796_050_800_000u64, "landed_at": 1_796_050_860_000u64,
                "takeoff_place": "", "landing_place": "", "purposes": [], "specific_flight": [], "summary": "", "safety_notes": "" })),
        ),
    )
    .await;
    let flight_id = flight["data"]["id"].as_i64().unwrap();
    let payload = fake_log_bytes(300_000);
    let request = Request::builder()
        .method(Method::POST)
        .uri(format!(
            "/api/vehicles/1/logs/upload?filename=2026-12-05%2010-00-00.bin&flight_id={flight_id}"
        ))
        .header(CSRF.0, CSRF.1)
        .header(header::COOKIE, &cookie)
        .header(header::CONTENT_LENGTH, payload.len())
        .body(Body::from(payload.clone()))
        .unwrap();
    let res = app.clone().oneshot(request).await.unwrap();
    let status = res.status();
    let body: Value = serde_json::from_slice(&res.into_body().collect().await.unwrap().to_bytes()).unwrap();
    assert_eq!(status, StatusCode::CREATED, "{body}");
    assert_eq!(
        (
            body["data"]["flight_id"].as_i64(),
            body["data"]["source"].as_str(),
            body["data"]["size"].as_u64()
        ),
        (Some(flight_id), Some("upload"), Some(300_000))
    );
    assert!(body["data"]["filename"].as_str().unwrap().ends_with(".bin"));
    let id = body["data"]["id"].as_i64().unwrap();
    let (status, body, _) = call(
        &app,
        req(
            Method::PATCH,
            &format!("/api/vehicles/1/logs/{id}"),
            Some(&cookie),
            Some(json!({ "flight_id": null })),
        ),
    )
    .await;
    assert_eq!(
        (status, body["data"]["flight_id"].is_null()),
        (StatusCode::OK, true)
    );
    let (status, bytes, _) = get_file(&app, &cookie, &format!("/api/vehicles/1/logs/{id}/file")).await;
    assert_eq!((status, bytes.len()), (StatusCode::OK, 300_000));
    assert_eq!(bytes, payload);
    let request = Request::builder()
        .method(Method::POST)
        .uri("/api/vehicles/1/logs/upload")
        .header(CSRF.0, CSRF.1)
        .header(header::COOKIE, &cookie)
        .body(Body::empty())
        .unwrap();
    let res = app.clone().oneshot(request).await.unwrap();
    assert_eq!(res.status(), StatusCode::BAD_REQUEST, "empty upload");
}

#[tokio::test]
async fn upload_declared_over_the_cap_is_refused_and_oversize_bodies_are_cut() {
    let (app, state, _rx) = spawn_app_with_link().await;
    seed_vehicle(&state, 1, false, false).await;
    let cookie = login(&app).await;
    let request = Request::builder()
        .method(Method::POST)
        .uri("/api/vehicles/1/logs/upload?filename=big.bin")
        .header(CSRF.0, CSRF.1)
        .header(header::COOKIE, &cookie)
        .header(
            header::CONTENT_LENGTH,
            rgcs_server::logs_api::MAX_UPLOAD_BYTES + 1,
        )
        .body(Body::from(vec![0u8; 16]))
        .unwrap();
    let res = app.clone().oneshot(request).await.unwrap();
    assert_eq!(res.status(), StatusCode::PAYLOAD_TOO_LARGE);
    // A body that lies about its length is cut at the cap: nothing is stored.
    let (_, body, _) = call(
        &app,
        req(Method::GET, "/api/vehicles/1/logs", Some(&cookie), None),
    )
    .await;
    assert!(body["data"]["logs"].as_array().unwrap().is_empty());
    let dir = state.data_dir.join("logs").join("1");
    assert!(
        !dir.exists() || std::fs::read_dir(&dir).unwrap().next().is_none(),
        "no partial file left"
    );
}

#[tokio::test]
async fn attach_refuses_superseded_flights_and_is_audited() {
    let (app, state, _rx) = spawn_app_with_link().await;
    seed_vehicle(&state, 1, false, false).await;
    let cookie = login(&app).await;
    let flight = json!({ "pilot": "a", "pilot_license": "", "takeoff_at": 1_796_050_800_000u64, "landed_at": 1_796_050_860_000u64,
        "takeoff_place": "", "landing_place": "", "purposes": [], "specific_flight": [], "summary": "", "safety_notes": "" });
    let (_, f, _) = call(
        &app,
        req(
            Method::POST,
            "/api/vehicles/1/flights",
            Some(&cookie),
            Some(flight),
        ),
    )
    .await;
    let old_id = f["data"]["id"].as_i64().unwrap();
    call(
        &app,
        req(
            Method::PATCH,
            &format!("/api/vehicles/1/flights/{old_id}"),
            Some(&cookie),
            Some(json!({ "status": "confirmed" })),
        ),
    )
    .await;
    let (_, newer, _) = call(
        &app,
        req(
            Method::PATCH,
            &format!("/api/vehicles/1/flights/{old_id}"),
            Some(&cookie),
            Some(json!({ "summary": "v2" })),
        ),
    )
    .await;
    let new_id = newer["data"]["id"].as_i64().unwrap();
    let log = state
        .store
        .add_log(1, None, None, "x.bin", 1, rgcs_core::LogSource::Upload, "admin")
        .await
        .unwrap();
    let (status, body, _) = call(
        &app,
        req(
            Method::PATCH,
            &format!("/api/vehicles/1/logs/{}", log.id),
            Some(&cookie),
            Some(json!({ "flight_id": old_id })),
        ),
    )
    .await;
    assert_eq!(
        (status, error_code(&body)),
        (StatusCode::BAD_REQUEST, "validation"),
        "superseded target"
    );
    let (status, body, _) = call(
        &app,
        req(
            Method::PATCH,
            &format!("/api/vehicles/1/logs/{}", log.id),
            Some(&cookie),
            Some(json!({ "flight_id": new_id })),
        ),
    )
    .await;
    assert_eq!(
        (status, body["data"]["flight_id"].as_i64()),
        (StatusCode::OK, Some(new_id))
    );
    let (_, audit, _) = call(
        &app,
        req(Method::GET, "/api/history/audit?limit=5", Some(&cookie), None),
    )
    .await;
    assert!(audit["data"]
        .as_array()
        .unwrap()
        .iter()
        .any(|e| e["command"] == "log_attach"));
}
