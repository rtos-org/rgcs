//! Survey cameras: the shared camera list for survey planning.

mod common;

use axum::http::{Method, StatusCode};
use common::*;
use serde_json::{json, Value};

fn camera(name: &str, focal: f64) -> Value {
    json!({
        "id": null, "name": name, "sensor_w_mm": 13.2, "sensor_h_mm": 8.8,
        "image_w_px": 5472, "image_h_px": 3648, "focal_mm": focal,
        "shutter_s": 0.0005, "min_interval_s": 2.0, "builtin": true
    })
}

#[tokio::test]
async fn a_fresh_server_lists_only_the_builtin_camera() {
    let (app, _state) = spawn_app().await;
    let cookie = login(&app).await;
    let (status, body, _) = call(&app, req(Method::GET, "/api/survey-cameras", Some(&cookie), None)).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let list = body["data"].as_array().unwrap();
    assert_eq!(list.len(), 1);
    let c = &list[0];
    assert_eq!(c["name"], "Sony α7R IV 35mm");
    assert_eq!(c["builtin"], true);
    assert_eq!(c["sensor_w_mm"], 35.7);
    assert_eq!(c["sensor_h_mm"], 23.8);
    assert_eq!(c["image_w_px"], 9504);
    assert_eq!(c["image_h_px"], 6336);
    assert_eq!(c["focal_mm"], 35.0);
    assert_eq!(c["shutter_s"], 0.001);
    assert_eq!(c["min_interval_s"], 1.0);
}

#[tokio::test]
async fn create_update_delete_a_custom_camera() {
    let (app, _state) = spawn_app().await;
    let cookie = login(&app).await;
    let (status, body, _) = call(
        &app,
        req(
            Method::POST,
            "/api/survey-cameras",
            Some(&cookie),
            Some(camera("Mini", 8.8)),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    assert_eq!(body["data"]["builtin"], false, "client builtin is ignored");
    let id = body["data"]["id"].as_i64().expect("id");

    let (_, body, _) = call(&app, req(Method::GET, "/api/survey-cameras", Some(&cookie), None)).await;
    assert_eq!(body["data"].as_array().unwrap().len(), 2);
    assert_eq!(body["data"][0]["builtin"], true);
    assert_eq!(body["data"][1]["name"], "Mini");

    let path = format!("/api/survey-cameras/{id}");
    let (status, body, _) = call(
        &app,
        req(Method::PUT, &path, Some(&cookie), Some(camera("Mini2", 10.0))),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["data"]["name"], "Mini2");
    assert_eq!(body["data"]["focal_mm"], 10.0);

    let (status, body, _) = call(&app, req(Method::DELETE, &path, Some(&cookie), None)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"]["deleted"], true);
    let (status, body, _) = call(&app, req(Method::DELETE, &path, Some(&cookie), None)).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(error_code(&body), "not_found");
    let (status, _, _) = call(
        &app,
        req(Method::PUT, &path, Some(&cookie), Some(camera("x", 5.0))),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn the_builtin_camera_cannot_be_changed_or_deleted() {
    let (app, _state) = spawn_app().await;
    let cookie = login(&app).await;
    let (_, body, _) = call(&app, req(Method::GET, "/api/survey-cameras", Some(&cookie), None)).await;
    let path = format!("/api/survey-cameras/{}", body["data"][0]["id"]);
    let (status, body, _) = call(&app, req(Method::DELETE, &path, Some(&cookie), None)).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(error_code(&body), "builtin");
    let (status, body, _) = call(
        &app,
        req(Method::PUT, &path, Some(&cookie), Some(camera("x", 5.0))),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(error_code(&body), "builtin");
}

#[tokio::test]
async fn an_invalid_camera_is_rejected() {
    let (app, _state) = spawn_app().await;
    let cookie = login(&app).await;
    let (status, body, _) = call(
        &app,
        req(
            Method::POST,
            "/api/survey-cameras",
            Some(&cookie),
            Some(camera("Bad", 0.0)),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(error_code(&body), "invalid");
}

#[tokio::test]
async fn survey_cameras_need_a_session() {
    let (app, _state) = spawn_app().await;
    let (status, _, _) = call(&app, req(Method::GET, "/api/survey-cameras", None, None)).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    let (status, _, _) = call(
        &app,
        req(Method::POST, "/api/survey-cameras", None, Some(camera("x", 5.0))),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}
