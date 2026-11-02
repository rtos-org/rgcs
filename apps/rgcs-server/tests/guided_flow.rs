mod common;

use std::time::Duration;

use axum::http::{Method, StatusCode};
use common::*;
use mavlink::dialects::ardupilotmega::MavMessage;
use serde_json::{json, Value};

async fn guided_token(app: &axum::Router, cookie: &str) -> String {
    let (status, body, _) = call(
        app,
        req(
            Method::POST,
            "/api/vehicles/1/confirm",
            Some(cookie),
            Some(json!({ "cmd": "guided" })),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    body["data"]["confirm_token"].as_str().unwrap().to_string()
}

fn body(alt: Option<f32>, token: Option<&str>) -> Value {
    let mut b = json!({ "lat": 35.482383, "lon": 138.48079, "alt_mode": "keep" });
    if let Some(a) = alt {
        b["alt_mode"] = json!("set");
        b["alt_rel"] = json!(a);
    }
    if let Some(t) = token {
        b["confirm_token"] = json!(t);
    }
    b
}

async fn post_guided(app: &axum::Router, cookie: &str, b: Value) -> (StatusCode, Value) {
    let (s, v, _) = call(
        app,
        req(Method::POST, "/api/vehicles/1/guided", Some(cookie), Some(b)),
    )
    .await;
    (s, v)
}

#[tokio::test]
async fn guided_needs_guided_mode() {
    let (app, state) = spawn_app().await;
    seed_copter(&state, 1, COPTER_STABILIZE, true, false).await;
    let cookie = login(&app).await;
    let (status, v) = post_guided(&app, &cookie, body(None, None)).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(error_code(&v), "mode_required");
}

#[tokio::test]
async fn first_guided_needs_a_token_and_later_ones_do_not() {
    let (app, state, mut link) = spawn_app_with_link().await;
    seed_copter(&state, 1, COPTER_GUIDED, true, false).await;
    let cookie = login(&app).await;
    let (status, v) = post_guided(&app, &cookie, body(None, None)).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(error_code(&v), "confirm_required");

    let token = guided_token(&app, &cookie).await;
    let (status, v) = post_guided(&app, &cookie, body(None, Some(&token))).await;
    assert_eq!(status, StatusCode::OK, "{v}");
    assert!(v["data"]["id"].is_u64());
    assert_eq!(v["data"]["warning"], "fence_unknown");

    let mut sent = Vec::new();
    while let Ok(Some(m)) = tokio::time::timeout(Duration::from_millis(200), link.recv()).await {
        sent.push(m.message);
    }
    let targets = sent
        .iter()
        .filter(|m| matches!(m, MavMessage::SET_POSITION_TARGET_GLOBAL_INT(_)))
        .count();
    let reads = sent
        .iter()
        .filter(|m| matches!(m, MavMessage::PARAM_REQUEST_READ(_)))
        .count();
    assert_eq!((targets, reads), (1, 2), "{sent:?}");

    let (status, _) = post_guided(&app, &cookie, body(None, None)).await;
    assert_eq!(status, StatusCode::OK);

    let mut latest = Value::Null;
    for _ in 0..20 {
        let (_, audit, _) = call(
            &app,
            req(Method::GET, "/api/history/audit?limit=1", Some(&cookie), None),
        )
        .await;
        latest = audit["data"][0].clone();
        if latest["command"] == "guided" {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    assert_eq!(latest["command"], "guided", "{latest}");
    assert_eq!(latest["result"], "ok");
}

#[tokio::test]
async fn fence_limit_is_enforced_when_known() {
    let (app, state, _link) = spawn_app_with_link().await;
    seed_copter(&state, 1, COPTER_GUIDED, true, false).await;
    seed_param(&state, 1, "FENCE_ENABLE", 1.0);
    seed_param(&state, 1, "FENCE_ALT_MAX", 120.0);
    let cookie = login(&app).await;
    let token = guided_token(&app, &cookie).await;
    let (status, v) = post_guided(&app, &cookie, body(Some(150.0), Some(&token))).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(error_code(&v), "fence_alt");
    let token = guided_token(&app, &cookie).await;
    let (status, v) = post_guided(&app, &cookie, body(Some(100.0), Some(&token))).await;
    assert_eq!(status, StatusCode::OK, "{v}");
    assert!(v["data"]["warning"].is_null());
}

#[tokio::test]
async fn alt_mode_set_requires_alt_rel() {
    let (app, state) = spawn_app().await;
    seed_copter(&state, 1, COPTER_GUIDED, true, false).await;
    let cookie = login(&app).await;
    let token = guided_token(&app, &cookie).await;
    let mut b = body(None, Some(&token));
    b["alt_mode"] = json!("set");
    let (status, v) = post_guided(&app, &cookie, b).await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(error_code(&v), "invalid");
}

#[tokio::test]
async fn guided_on_lost_link_is_503() {
    let (app, state) = spawn_app().await;
    seed_copter(&state, 1, COPTER_GUIDED, true, true).await;
    let cookie = login(&app).await;
    let (status, v) = post_guided(&app, &cookie, body(None, None)).await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(error_code(&v), "link_lost");
}
