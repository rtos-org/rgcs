mod common;

use axum::body::Body;
use axum::http::{header, Method, Request, StatusCode};
use axum::routing::post;
use common::*;
use http_body_util::BodyExt;
use tower::ServiceExt;

async fn fake_mediamtx() -> String {
    let app = axum::Router::new().route(
        "/mt11/whep",
        post(|body: String| async move {
            (
                StatusCode::CREATED,
                [(header::CONTENT_TYPE, "application/sdp")],
                format!("v=0\r\nanswer:{}", body.len()),
            )
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    format!("http://127.0.0.1:{}/mt11/whep", addr.port())
}

fn sdp_request(cookie: Option<&str>, body: Vec<u8>) -> Request<Body> {
    let mut b = Request::builder()
        .method(Method::POST)
        .uri("/api/vehicles/1/video/whep")
        .header("x-requested-with", "rgcs")
        .header(header::CONTENT_TYPE, "application/sdp");
    if let Some(c) = cookie {
        b = b.header(header::COOKIE, c);
    }
    b.body(Body::from(body)).unwrap()
}

#[tokio::test]
async fn whep_relay_requires_a_session_and_caps_the_body() {
    let (app, _) = spawn_app_with_whep(&fake_mediamtx().await).await;
    let res = app
        .clone()
        .oneshot(sdp_request(None, b"v=0".to_vec()))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
    let cookie = login(&app).await;
    let res = app
        .clone()
        .oneshot(sdp_request(Some(&cookie), vec![b'a'; 65 * 1024]))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::PAYLOAD_TOO_LARGE);
}

#[tokio::test]
async fn whep_relay_returns_503_when_mediamtx_is_down() {
    let (app, _) = spawn_app_with_whep("http://127.0.0.1:1/mt11/whep").await;
    let cookie = login(&app).await;
    let (status, body, _) = call(&app, sdp_request(Some(&cookie), b"v=0".to_vec())).await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE, "{body}");
    assert_eq!(error_code(&body), "video_unavailable");
}

#[tokio::test]
async fn whep_relay_passes_the_answer_through() {
    let (app, _) = spawn_app_with_whep(&fake_mediamtx().await).await;
    let cookie = login(&app).await;
    let res = app
        .clone()
        .oneshot(sdp_request(Some(&cookie), b"v=0\r\noffer".to_vec()))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::CREATED);
    assert_eq!(res.headers()[header::CONTENT_TYPE], "application/sdp");
    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(&bytes[..], b"v=0\r\nanswer:10");
}

#[tokio::test]
async fn video_source_endpoint_reports_none_for_an_unconfigured_camera() {
    let (app, state) = spawn_app().await;
    seed_vehicle(&state, 1, false, false).await;
    let cookie = login(&app).await;
    let (status, body, _) = call(
        &app,
        req(Method::GET, "/api/vehicles/1/video/source", Some(&cookie), None),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["data"]["source"], "none");
    assert_eq!(body["data"]["whep_path"], "mt11");
    let (status, body, _) = call(
        &app,
        req(
            Method::PUT,
            "/api/vehicles/1/video/source",
            Some(&cookie),
            Some(serde_json::json!({ "mode": "mt11" })),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["data"]["mode"], "mt11");
    let (_, audit, _) = call(
        &app,
        req(Method::GET, "/api/history/audit?limit=1", Some(&cookie), None),
    )
    .await;
    assert_eq!(audit["data"][0]["target"], "video", "{audit}");
    assert_eq!(audit["data"][0]["command"], "source");
}

#[tokio::test]
async fn video_source_is_in_the_snapshot_and_resent_every_second() {
    let (app, state) = spawn_app().await;
    seed_vehicle(&state, 1, false, false).await;
    let cookie = login(&app).await;
    let (status, body, _) = call(
        &app,
        req(Method::GET, "/api/vehicles/1/video/source", Some(&cookie), None),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let snap = rgcs_server::ws::snapshot(&state).await;
    let rgcs_core::ServerMessage::Snapshot { video_sources, .. } = snap else {
        panic!("not a snapshot")
    };
    assert_eq!(video_sources.len(), 1);
    assert_eq!(video_sources[0].sysid, 1);
    assert_eq!(video_sources[0].status.whep_path, "mt11");
}
