//! `/api/assignments`: which saved plan each vehicle should fly, shared over the WebSocket.

mod common;

use axum::http::{Method, StatusCode};
use common::*;
use rgcs_core::{demo20, ServerMessage};
use serde_json::{json, Value};

async fn saved_plan(app: &axum::Router, cookie: &str) -> i64 {
    let body = serde_json::to_value(demo20()).unwrap();
    let (status, body, _) = call(app, req(Method::POST, "/api/missions", Some(cookie), Some(body))).await;
    assert_eq!(status, StatusCode::CREATED, "{body}");
    body["data"]["id"].as_i64().expect("id")
}

async fn assign(app: &axum::Router, cookie: &str, sysid: u8, plan: Option<i64>) -> (StatusCode, Value) {
    let (status, body, _) = call(
        app,
        req(
            Method::PUT,
            &format!("/api/assignments/{sysid}"),
            Some(cookie),
            Some(json!({ "plan_id": plan })),
        ),
    )
    .await;
    (status, body)
}

async fn list(app: &axum::Router, cookie: &str) -> Value {
    let (status, body, _) = call(app, req(Method::GET, "/api/assignments", Some(cookie), None)).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    body["data"].clone()
}

#[tokio::test]
async fn put_then_get() {
    let (app, _state) = spawn_app().await;
    let cookie = login(&app).await;
    let plan = saved_plan(&app, &cookie).await;
    let (status, body) = assign(&app, &cookie, 2, Some(plan)).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["data"]["sysid"], 2);
    assert_eq!(body["data"]["plan_id"], plan);
    assert_eq!(body["data"]["assigned_by"], "admin");
    let rows = list(&app, &cookie).await;
    assert_eq!(rows.as_array().unwrap().len(), 1);
    assert_eq!(rows[0]["plan_id"], plan);

    let (status, body) = assign(&app, &cookie, 2, None).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(body["data"]["plan_id"].is_null());
    assert!(list(&app, &cookie).await[0]["plan_id"].is_null());
}

#[tokio::test]
async fn one_plan_on_two_vehicles() {
    let (app, _state) = spawn_app().await;
    let cookie = login(&app).await;
    let plan = saved_plan(&app, &cookie).await;
    assert_eq!(assign(&app, &cookie, 3, Some(plan)).await.0, StatusCode::OK);
    assert_eq!(assign(&app, &cookie, 2, Some(plan)).await.0, StatusCode::OK);
    let rows = list(&app, &cookie).await;
    let rows = rows.as_array().unwrap();
    assert_eq!(rows.len(), 2);
    assert_eq!(rows[0]["sysid"], 2);
    assert_eq!(rows[1]["sysid"], 3);
    assert!(rows.iter().all(|r| r["plan_id"] == plan));
}

#[tokio::test]
async fn unknown_plan_is_404() {
    let (app, _state) = spawn_app().await;
    let cookie = login(&app).await;
    let (status, body) = assign(&app, &cookie, 2, Some(999)).await;
    assert_eq!(status, StatusCode::NOT_FOUND, "{body}");
    assert_eq!(body["error"]["code"], "not_found");
    assert!(list(&app, &cookie).await.as_array().unwrap().is_empty());
}

#[tokio::test]
async fn needs_a_session() {
    let (app, _state) = spawn_app().await;
    let (status, _, _) = call(&app, req(Method::GET, "/api/assignments", None, None)).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    let (status, _, _) = call(
        &app,
        req(
            Method::PUT,
            "/api/assignments/2",
            None,
            Some(json!({ "plan_id": null })),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn a_change_is_broadcast() {
    let (app, state) = spawn_app().await;
    let cookie = login(&app).await;
    let plan = saved_plan(&app, &cookie).await;
    let mut rx = state.tx.subscribe();
    assert_eq!(assign(&app, &cookie, 4, Some(plan)).await.0, StatusCode::OK);
    let rows = tokio::time::timeout(std::time::Duration::from_secs(2), async {
        loop {
            if let Ok(ServerMessage::Assignments { rows }) = rx.recv().await {
                return rows;
            }
        }
    })
    .await
    .expect("an assignments frame");
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].sysid, 4);
    assert_eq!(rows[0].plan_id, Some(plan));
}
