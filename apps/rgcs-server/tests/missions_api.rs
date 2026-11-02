//! Saved missions, `.waypoints` export / import and validation.

mod common;

use axum::body::Body;
use axum::http::{header, Method, Request, StatusCode};
use common::*;
use rgcs_core::{demo20, Mission, MissionItem, MAV_CMD_NAV_WAYPOINT};
use serde_json::{json, Value};

const FIXTURE: &str = include_str!("../../../crates/rgcs-mission/tests/fixtures/demo20.waypoints");

fn mission_json(m: &Mission) -> Value {
    serde_json::to_value(m).unwrap()
}

async fn create(app: &axum::Router, cookie: &str, m: &Mission) -> (StatusCode, Value) {
    let (status, body, _) = call(
        app,
        req(Method::POST, "/api/missions", Some(cookie), Some(mission_json(m))),
    )
    .await;
    (status, body)
}

fn text_request(path: &str, cookie: &str, text: &str, name: Option<&str>) -> Request<Body> {
    let mut b = Request::builder()
        .method(Method::POST)
        .uri(path)
        .header(header::COOKIE, cookie)
        .header(CSRF.0, CSRF.1)
        .header(header::CONTENT_TYPE, "text/plain; charset=utf-8");
    if let Some(n) = name {
        b = b.header("x-mission-name", n);
    }
    b.body(Body::from(text.to_string())).unwrap()
}

#[tokio::test]
async fn create_list_get_update_delete() {
    let (app, _state) = spawn_app().await;
    let cookie = login(&app).await;
    let (status, body) = create(&app, &cookie, &demo20()).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    let id = body["data"]["id"].as_i64().expect("id");
    assert_eq!(body["data"]["items"].as_array().unwrap().len(), 20);

    let (status, body, _) = call(&app, req(Method::GET, "/api/missions", Some(&cookie), None)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"][0]["id"], id);
    assert_eq!(body["data"][0]["item_count"], 20);
    assert_eq!(body["data"][0]["name"], "demo20");

    let mut renamed = demo20();
    renamed.name = "renamed".into();
    let (status, body, _) = call(
        &app,
        req(
            Method::PUT,
            &format!("/api/missions/{id}"),
            Some(&cookie),
            Some(mission_json(&renamed)),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["data"]["name"], "renamed");
    assert_eq!(body["data"]["id"], id);

    let (status, body, _) = call(
        &app,
        req(Method::GET, &format!("/api/missions/{id}"), Some(&cookie), None),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"]["name"], "renamed");

    let (status, _, _) = call(
        &app,
        req(
            Method::DELETE,
            &format!("/api/missions/{id}"),
            Some(&cookie),
            None,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (status, body, _) = call(
        &app,
        req(Method::GET, &format!("/api/missions/{id}"), Some(&cookie), None),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(error_code(&body), "not_found");
    let (status, _, _) = call(
        &app,
        req(
            Method::PUT,
            "/api/missions/999",
            Some(&cookie),
            Some(mission_json(&renamed)),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn export_is_the_golden_text_with_attachment_header() {
    let (app, _state) = spawn_app().await;
    let cookie = login(&app).await;
    let (_, body) = create(&app, &cookie, &demo20()).await;
    let id = body["data"]["id"].as_i64().unwrap();
    let request = Request::builder()
        .method(Method::GET)
        .uri(format!("/api/missions/{id}/export?format=waypoints"))
        .header(header::COOKIE, &cookie)
        .body(Body::empty())
        .unwrap();
    let response = tower::ServiceExt::oneshot(app.clone(), request).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let headers = response.headers().clone();
    assert!(headers[header::CONTENT_TYPE]
        .to_str()
        .unwrap()
        .starts_with("text/plain"));
    assert_eq!(
        headers[header::CONTENT_DISPOSITION],
        "attachment; filename=\"demo20.waypoints\""
    );
    let bytes = http_body_util::BodyExt::collect(response.into_body())
        .await
        .unwrap()
        .to_bytes();
    assert_eq!(std::str::from_utf8(&bytes).unwrap(), FIXTURE);

    let (status, body, _) = call(
        &app,
        req(
            Method::GET,
            &format!("/api/missions/{id}/export?format=kml"),
            Some(&cookie),
            None,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    assert_eq!(error_code(&body), "invalid");
}

#[tokio::test]
async fn import_returns_an_unsaved_mission() {
    let (app, _state) = spawn_app().await;
    let cookie = login(&app).await;
    let crlf = FIXTURE.replace('\n', "\r\n");
    let (status, body, _) = call(
        &app,
        text_request("/api/missions/import", &cookie, &crlf, Some("from mp")),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(body["data"]["id"].is_null());
    assert_eq!(body["data"]["name"], "from mp");
    assert_eq!(body["data"]["items"].as_array().unwrap().len(), 20);
    let (status, body, _) = call(&app, text_request("/api/missions/import", &cookie, FIXTURE, None)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"]["name"], "imported");
}

#[tokio::test]
async fn import_rejects_garbage_400() {
    let (app, _state) = spawn_app().await;
    let cookie = login(&app).await;
    let (status, body, _) = call(
        &app,
        text_request("/api/missions/import", &cookie, "hello\nworld\n", None),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    assert_eq!(error_code(&body), "invalid_waypoints");
}

#[tokio::test]
async fn validate_reports_findings_and_stats() {
    let (app, state) = spawn_app().await;
    seed_vehicle(&state, 1, false, false).await;
    seed_param(&state, 1, "FENCE_ENABLE", 1.0);
    seed_param(&state, 1, "FENCE_ALT_MAX", 70.0);
    let cookie = login(&app).await;
    let mut m = demo20();
    m.items[0].command = MAV_CMD_NAV_WAYPOINT;
    let (status, body, _) = call(
        &app,
        req(
            Method::POST,
            "/api/missions/validate?sysid=1",
            Some(&cookie),
            Some(mission_json(&m)),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let codes: Vec<&str> = body["data"]["findings"]
        .as_array()
        .unwrap()
        .iter()
        .map(|f| f["code"].as_str().unwrap())
        .collect();
    assert!(codes.contains(&"first_not_takeoff"), "{codes:?}");
    assert!(codes.contains(&"fence_alt"), "{codes:?}");
    assert!(body["data"]["stats"]["distance_m"].as_f64().unwrap() > 1000.0);
    // without a vehicle the fence is unknown → warning only
    let (status, body, _) = call(
        &app,
        req(
            Method::POST,
            "/api/missions/validate",
            Some(&cookie),
            Some(mission_json(&demo20())),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let codes: Vec<&str> = body["data"]["findings"]
        .as_array()
        .unwrap()
        .iter()
        .map(|f| f["code"].as_str().unwrap())
        .collect();
    assert!(codes.contains(&"fence_unknown"), "{codes:?}");
    assert!(!codes.contains(&"fence_alt"));
}

#[tokio::test]
async fn name_and_item_count_are_validated() {
    let (app, _state) = spawn_app().await;
    let cookie = login(&app).await;
    let mut long_name = demo20();
    long_name.name = "x".repeat(65);
    let (status, body) = create(&app, &cookie, &long_name).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    assert_eq!(error_code(&body), "validation");
    assert!(body["error"]["message"].as_str().unwrap().contains("name"));
    let mut too_many = demo20();
    let wp: MissionItem = too_many.items[1].clone();
    too_many.items.extend(std::iter::repeat_n(wp, 690));
    assert!(too_many.items.len() > 700);
    let (status, body) = create(&app, &cookie, &too_many).await;
    assert_eq!(status, StatusCode::BAD_REQUEST, "{body}");
    assert!(body["error"]["message"].as_str().unwrap().contains("items"));
}

#[tokio::test]
async fn missions_need_a_session() {
    let (app, _state) = spawn_app().await;
    let (status, _, _) = call(&app, req(Method::GET, "/api/missions", None, None)).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    let (status, _, _) = call(&app, req(Method::POST, "/api/missions", None, Some(json!({})))).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

/// Flight plans replaced briefings: the old route is gone, so the path falls through to the UI
/// fallback like any unknown one and no API envelope comes back.
#[tokio::test]
async fn briefing_routes_are_gone() {
    let (app, _state) = spawn_app().await;
    let cookie = login(&app).await;
    let (_, body, _) = call(&app, req(Method::GET, "/api/briefings", Some(&cookie), None)).await;
    assert!(body.get("success").is_none(), "{body}");
}
