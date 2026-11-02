//! MAVLink inspector API (user request 2026-10-19): rows of received / sent frames and the
//! fields of one message.

mod common;

use axum::http::{Method, StatusCode};
use common::{call, error_code, login, req, spawn_app};
use mavlink::dialects::ardupilotmega::{MavMessage, HEARTBEAT_DATA};
use mavlink::MavHeader;
use rgcs_core::InspectorDir;

#[tokio::test]
async fn inspector_requires_login_and_lists_rows() {
    let (app, state) = spawn_app().await;
    let (status, _, _) = call(&app, req(Method::GET, "/api/mavlink/inspector", None, None)).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    let cookie = login(&app).await;
    let hdr = MavHeader {
        system_id: 1,
        component_id: 1,
        sequence: 0,
    };
    let hb = MavMessage::HEARTBEAT(HEARTBEAT_DATA {
        custom_mode: 5,
        ..HEARTBEAT_DATA::DEFAULT
    });
    let now = state.inspector.now_ms();
    state.inspector.record(InspectorDir::Rx, &hdr, &hb, now);
    state.inspector.record(
        InspectorDir::Tx,
        &MavHeader {
            system_id: 255,
            component_id: 190,
            sequence: 0,
        },
        &hb,
        now,
    );

    let (status, body, _) = call(
        &app,
        req(Method::GET, "/api/mavlink/inspector", Some(&cookie), None),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let rows = body["data"]["rows"].as_array().unwrap();
    assert_eq!(rows.len(), 2);
    assert_eq!(
        (rows[0]["dir"].as_str(), rows[0]["name"].as_str()),
        (Some("rx"), Some("HEARTBEAT"))
    );
    assert_eq!(body["data"]["gcs_sysid"], 255);

    let (status, body, _) = call(
        &app,
        req(
            Method::GET,
            "/api/mavlink/inspector/rx/1/1/0",
            Some(&cookie),
            None,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["data"]["fields"]["custom_mode"], 5);
    let (status, body, _) = call(
        &app,
        req(
            Method::GET,
            "/api/mavlink/inspector/rx/9/1/0",
            Some(&cookie),
            None,
        ),
    )
    .await;
    assert_eq!((status, error_code(&body)), (StatusCode::NOT_FOUND, "not_found"));
    let (status, _, _) = call(
        &app,
        req(
            Method::GET,
            "/api/mavlink/inspector/up/1/1/0",
            Some(&cookie),
            None,
        ),
    )
    .await;
    assert!(status.is_client_error());
}
