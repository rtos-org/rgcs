//! Full parameter download with gap completion, verified writes and history.

mod common;

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use axum::http::{Method, StatusCode};
use common::*;
use rgcs_core::ServerMessage;
use rgcs_server::params::SET_ATTEMPTS;
use serde_json::{json, Value};

async fn confirm_token(app: &axum::Router, cookie: &str) -> String {
    let (status, body, _) = call(
        app,
        req(
            Method::POST,
            "/api/vehicles/1/confirm",
            Some(cookie),
            Some(json!({"cmd":"param_write"})),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    body["data"]["confirm_token"].as_str().unwrap().to_string()
}

async fn wait_complete(app: &axum::Router, cookie: &str, secs: u64) -> Value {
    for _ in 0..(secs * 10) {
        let (_, body, _) = call(
            app,
            req(Method::GET, "/api/vehicles/1/params/progress", Some(cookie), None),
        )
        .await;
        if body["data"]["complete"] == true {
            return body["data"].clone();
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    panic!("download did not complete in {secs} s");
}

#[tokio::test]
async fn full_download_reports_progress_and_completes() {
    let (app, state, rx) = spawn_app_with_link().await;
    seed_vehicle(&state, 1, false, false).await;
    let cookie = login(&app).await;
    let reads = Arc::new(AtomicUsize::new(0));
    let _fake = fake_vehicle_params(rx, state.params.clone(), 1, FakeParamMode::Normal, reads.clone());
    let mut sub = state.tx.subscribe();
    let (status, body, _) = call(
        &app,
        req(
            Method::POST,
            "/api/vehicles/1/params/refresh",
            Some(&cookie),
            None,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::ACCEPTED, "{body}");
    let progress = wait_complete(&app, &cookie, 10).await;
    assert_eq!(progress["received"], FAKE_PARAM_COUNT as u32);
    assert_eq!(progress["total"], FAKE_PARAM_COUNT as u32);
    assert_eq!(progress["downloading"], false);
    let (status, body, _) = call(
        &app,
        req(Method::GET, "/api/vehicles/1/params", Some(&cookie), None),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let entries = body["data"]["entries"].as_array().unwrap();
    assert_eq!(entries.len(), FAKE_PARAM_COUNT as usize);
    assert_eq!(entries[0]["name"], "P0000");
    assert_eq!(body["data"]["progress"]["complete"], true);
    let completed = tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            if let Ok(ServerMessage::ParamProgress { sysid: 1, progress }) = sub.recv().await {
                if progress.complete && !progress.downloading {
                    return true;
                }
            }
        }
    })
    .await;
    assert_eq!(completed, Ok(true), "a complete progress frame was broadcast");
    assert_eq!(reads.load(Ordering::Relaxed), 0, "no index reads were needed");
}

#[tokio::test]
async fn missing_indexes_are_completed_by_index() {
    let (app, state, rx) = spawn_app_with_link().await;
    seed_vehicle(&state, 1, false, false).await;
    let cookie = login(&app).await;
    let reads = Arc::new(AtomicUsize::new(0));
    let _fake = fake_vehicle_params(
        rx,
        state.params.clone(),
        1,
        FakeParamMode::Gaps(vec![5, 6, 7, 900]),
        reads.clone(),
    );
    let (status, _, _) = call(
        &app,
        req(
            Method::POST,
            "/api/vehicles/1/params/refresh",
            Some(&cookie),
            None,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::ACCEPTED);
    let progress = wait_complete(&app, &cookie, 15).await;
    assert_eq!(progress["received"], FAKE_PARAM_COUNT as u32);
    assert_eq!(
        reads.load(Ordering::Relaxed),
        4,
        "exactly the four gaps were re-requested by index"
    );
    assert_eq!(state.params.get(1, "P0900"), Some(900.0));
}

#[tokio::test]
async fn verified_write_records_history_and_audit() {
    let (app, state, rx) = spawn_app_with_link().await;
    seed_vehicle(&state, 1, false, false).await;
    let cookie = login(&app).await;
    let _fake = fake_vehicle_params(
        rx,
        state.params.clone(),
        1,
        FakeParamMode::Normal,
        Arc::new(AtomicUsize::new(0)),
    );
    state.params.on_value(
        1,
        rgcs_core::ParamEntry {
            name: "FENCE_ALT_MAX".into(),
            value: 100.0,
            index: 3,
            ptype: 9,
        },
        FAKE_PARAM_COUNT,
    );
    let token = confirm_token(&app, &cookie).await;
    let body = json!({"changes": [{"name": "FENCE_ALT_MAX", "value": 150.0}], "confirm_token": token});
    let (status, reply, _) = call(
        &app,
        req(Method::PUT, "/api/vehicles/1/params", Some(&cookie), Some(body)),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{reply}");
    assert_eq!(reply["data"][0]["verified"], true);
    assert_eq!(reply["data"][0]["actual"], 150.0);
    assert_eq!(state.params.get(1, "FENCE_ALT_MAX"), Some(150.0));
    let (_, hist, _) = call(
        &app,
        req(Method::GET, "/api/history/params?sysid=1", Some(&cookie), None),
    )
    .await;
    assert_eq!(hist["data"][0]["name"], "FENCE_ALT_MAX");
    assert_eq!(hist["data"][0]["old_value"], 100.0);
    assert_eq!(hist["data"][0]["new_value"], 150.0);
    assert_eq!(hist["data"][0]["verified"], true);
    let (_, audit, _) = call(
        &app,
        req(Method::GET, "/api/history/audit?limit=5", Some(&cookie), None),
    )
    .await;
    assert!(
        audit["data"]
            .as_array()
            .unwrap()
            .iter()
            .any(|r| r["target"] == "settings" && r["command"] == "param_write" && r["result"] == "ok"),
        "{audit}"
    );
}

#[tokio::test]
async fn unanswered_param_set_is_recorded_unverified() {
    let (app, state, rx) = spawn_app_with_link().await;
    seed_vehicle(&state, 1, false, false).await;
    let cookie = login(&app).await;
    let _fake = fake_vehicle_params(
        rx,
        state.params.clone(),
        1,
        FakeParamMode::SilentSet,
        Arc::new(AtomicUsize::new(0)),
    );
    let token = confirm_token(&app, &cookie).await;
    let started = std::time::Instant::now();
    let body = json!({"changes": [{"name": "WPNAV_SPEED", "value": 800.0}], "confirm_token": token});
    let (status, reply, _) = call(
        &app,
        req(Method::PUT, "/api/vehicles/1/params", Some(&cookie), Some(body)),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{reply}");
    assert_eq!(reply["data"][0]["verified"], false);
    assert!(reply["data"][0]["actual"].is_null());
    assert!(
        started.elapsed() < Duration::from_secs(6),
        "{:?}",
        started.elapsed()
    );
    let (_, hist, _) = call(
        &app,
        req(Method::GET, "/api/history/params?sysid=1", Some(&cookie), None),
    )
    .await;
    assert_eq!(hist["data"][0]["verified"], false);
    // the next write is accepted (no stuck lock)
    let token = confirm_token(&app, &cookie).await;
    let body = json!({"changes": [{"name": "WPNAV_SPEED", "value": 700.0}], "confirm_token": token});
    let (status, _, _) = call(
        &app,
        req(Method::PUT, "/api/vehicles/1/params", Some(&cookie), Some(body)),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
}

#[tokio::test]
async fn armed_or_unconfirmed_write_sends_nothing() {
    let (app, state, mut rx) = spawn_app_with_link().await;
    seed_vehicle(&state, 1, true, false).await;
    let cookie = login(&app).await;
    let token = confirm_token(&app, &cookie).await;
    let body = json!({"changes": [{"name": "FENCE_ALT_MAX", "value": 150.0}], "confirm_token": token});
    let (status, reply, _) = call(
        &app,
        req(
            Method::PUT,
            "/api/vehicles/1/params",
            Some(&cookie),
            Some(body.clone()),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{reply}");
    assert_eq!(error_code(&reply), "vehicle_armed");
    seed_vehicle(&state, 1, false, false).await;
    let body = json!({"changes": [{"name": "FENCE_ALT_MAX", "value": 150.0}]});
    let (status, reply, _) = call(
        &app,
        req(Method::PUT, "/api/vehicles/1/params", Some(&cookie), Some(body)),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{reply}");
    assert_eq!(error_code(&reply), "confirm_required");
    let bad = json!({"changes": [{"name": "THIS_NAME_IS_WAY_TOO_LONG", "value": 1.0}], "confirm_token": "x"});
    let (status, reply, _) = call(
        &app,
        req(Method::PUT, "/api/vehicles/1/params", Some(&cookie), Some(bad)),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{reply}");
    assert!(rx.try_recv().is_err(), "nothing was sent to the link");
}

#[tokio::test]
async fn history_endpoint_filters_by_sysid() {
    let (app, state) = spawn_app().await;
    let cookie = login(&app).await;
    state
        .store
        .record_param(rgcs_store::param_history::ParamHistoryInput {
            operator: "admin",
            sysid: 1,
            name: "A",
            old_value: None,
            new_value: 1.0,
            verified: true,
        })
        .await
        .unwrap();
    state
        .store
        .record_param(rgcs_store::param_history::ParamHistoryInput {
            operator: "admin",
            sysid: 2,
            name: "B",
            old_value: None,
            new_value: 2.0,
            verified: true,
        })
        .await
        .unwrap();
    let (status, all, _) = call(
        &app,
        req(Method::GET, "/api/history/params?limit=10", Some(&cookie), None),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(all["data"].as_array().unwrap().len(), 2);
    let (_, one, _) = call(
        &app,
        req(Method::GET, "/api/history/params?sysid=2", Some(&cookie), None),
    )
    .await;
    assert_eq!(one["data"].as_array().unwrap().len(), 1);
    assert_eq!(one["data"][0]["name"], "B");
    let (status, _, _) = call(&app, req(Method::GET, "/api/history/params", None, None)).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn arming_midway_aborts_the_remaining_changes() {
    let (app, state, rx) = spawn_app_with_link().await;
    seed_vehicle(&state, 1, false, false).await;
    let cookie = login(&app).await;
    let sets = Arc::new(AtomicUsize::new(0));
    let _fake = fake_vehicle_params_counting(
        rx,
        state.params.clone(),
        1,
        FakeParamMode::SilentSet,
        Arc::new(AtomicUsize::new(0)),
        sets.clone(),
    );
    let token = confirm_token(&app, &cookie).await;
    let arm = {
        let state = state.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(500)).await;
            seed_vehicle(&state, 1, true, false).await;
        })
    };
    let body = json!({"changes": [{"name": "WPNAV_SPEED", "value": 800.0}, {"name": "FENCE_ALT_MAX", "value": 150.0}], "confirm_token": token});
    let (status, reply, _) = call(
        &app,
        req(Method::PUT, "/api/vehicles/1/params", Some(&cookie), Some(body)),
    )
    .await;
    arm.await.unwrap();
    assert_eq!(status, StatusCode::OK, "{reply}");
    assert_eq!(reply["data"][0]["verified"], false);
    assert_eq!(reply["data"][0]["reason"], "no_echo");
    assert_eq!(reply["data"][1]["verified"], false);
    assert_eq!(reply["data"][1]["reason"], "vehicle_armed");
    assert_eq!(
        sets.load(Ordering::Relaxed),
        SET_ATTEMPTS as usize,
        "only the first change reached the link"
    );
    let (_, hist, _) = call(
        &app,
        req(Method::GET, "/api/history/params?sysid=1", Some(&cookie), None),
    )
    .await;
    assert_eq!(
        hist["data"].as_array().unwrap().len(),
        1,
        "the aborted change is not a history row"
    );
    let (_, audit, _) = call(
        &app,
        req(Method::GET, "/api/history/audit?limit=5", Some(&cookie), None),
    )
    .await;
    assert!(
        audit["data"]
            .as_array()
            .unwrap()
            .iter()
            .any(|r| r["command"] == "param_write" && r["reason"] == "vehicle_armed"),
        "{audit}"
    );
}

#[tokio::test]
async fn stale_value_before_the_echo_does_not_fail_the_write() {
    let (app, state, rx) = spawn_app_with_link().await;
    seed_vehicle(&state, 1, false, false).await;
    let cookie = login(&app).await;
    let _fake = fake_vehicle_params(
        rx,
        state.params.clone(),
        1,
        FakeParamMode::StaleThenEcho,
        Arc::new(AtomicUsize::new(0)),
    );
    state.params.on_value(
        1,
        rgcs_core::ParamEntry {
            name: "P0003".into(),
            value: 3.0,
            index: 3,
            ptype: 9,
        },
        FAKE_PARAM_COUNT,
    );
    let token = confirm_token(&app, &cookie).await;
    let body = json!({"changes": [{"name": "P0003", "value": 33.0}], "confirm_token": token});
    let (status, reply, _) = call(
        &app,
        req(Method::PUT, "/api/vehicles/1/params", Some(&cookie), Some(body)),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{reply}");
    assert_eq!(reply["data"][0]["verified"], true, "{reply}");
    assert_eq!(reply["data"][0]["actual"], 33.0);
    // the echo (index -1) must not disturb the cached index
    assert_eq!(state.params.entry(1, "P0003").unwrap().index, 3);
}

#[tokio::test]
async fn writes_are_refused_while_a_download_runs() {
    let (app, state, mut rx) = spawn_app_with_link().await;
    seed_vehicle(&state, 1, false, false).await;
    let cookie = login(&app).await;
    assert!(state.params.begin_download(1));
    let token = confirm_token(&app, &cookie).await;
    let body = json!({"changes": [{"name": "FENCE_ALT_MAX", "value": 150.0}], "confirm_token": token});
    let (status, reply, _) = call(
        &app,
        req(Method::PUT, "/api/vehicles/1/params", Some(&cookie), Some(body)),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{reply}");
    assert_eq!(error_code(&reply), "download_in_progress");
    assert!(rx.try_recv().is_err(), "nothing was sent to the link");
}
