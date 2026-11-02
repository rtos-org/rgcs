//! `/api/health` identifies the exact build (P6: rehearsal builds must be distinguishable).

mod common;

use axum::http::{Method, StatusCode};
use common::{call, req, spawn_app};

#[tokio::test]
async fn health_reports_the_build() {
    let (app, _state) = spawn_app().await;
    let (status, body, _) = call(&app, req(Method::GET, "/api/health", None, None)).await;
    assert_eq!(status, StatusCode::OK);
    let build = body["data"]["build"].as_str().expect("build field");
    assert_eq!(build, option_env!("RGCS_BUILD").unwrap_or("dev"));
    assert!(!build.is_empty());
}
