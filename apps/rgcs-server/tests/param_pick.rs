//! `GET /api/vehicles/{sysid}/params/pick?names=…` (2026-10-20): a handful of named parameters for
//! the planner's predicted path, asking the vehicle for the ones the cache does not hold yet.

mod common;

use axum::http::{Method, StatusCode};
use common::*;
use mavlink::dialects::ardupilotmega::MavMessage;
use serde_json::json;

#[tokio::test]
async fn pick_returns_cached_values_and_requests_the_missing_ones() {
    let (app, state, mut rx) = spawn_app_with_link().await;
    seed_vehicle(&state, 1, false, false).await;
    let cookie = login(&app).await;
    seed_param(&state, 1, "WP_LOITER_RAD", -80.0);
    let (status, reply, _) = call(
        &app,
        req(
            Method::GET,
            "/api/vehicles/1/params/pick?names=WP_LOITER_RAD,Q_ENABLE",
            Some(&cookie),
            None,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{reply}");
    assert_eq!(
        reply["data"],
        json!({ "values": { "WP_LOITER_RAD": -80.0 }, "missing": ["Q_ENABLE"] })
    );
    let mut asked = Vec::new();
    while let Ok(out) = rx.try_recv() {
        if let MavMessage::PARAM_REQUEST_READ(r) = out.message {
            let name: String = r
                .param_id
                .iter()
                .take_while(|c| **c != 0)
                .map(|c| *c as char)
                .collect();
            asked.push(name);
        }
    }
    assert_eq!(asked, vec!["Q_ENABLE".to_string()]);
}

#[tokio::test]
async fn pick_refuses_malformed_or_too_many_names() {
    let (app, state, _rx) = spawn_app_with_link().await;
    seed_vehicle(&state, 1, false, false).await;
    let cookie = login(&app).await;
    let many = (0..40).map(|i| format!("P{i}")).collect::<Vec<_>>().join(",");
    for query in [
        "names=wp_loiter_rad",
        "names=ABCDEFGHIJKLMNOPQ",
        &format!("names={many}"),
        "names=",
    ] {
        let (status, reply, _) = call(
            &app,
            req(
                Method::GET,
                &format!("/api/vehicles/1/params/pick?{query}"),
                Some(&cookie),
                None,
            ),
        )
        .await;
        assert_eq!(status, StatusCode::BAD_REQUEST, "{query}: {reply}");
    }
}
