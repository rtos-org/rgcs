mod common;

use axum::body::Body;
use axum::http::{header, Method, Request, StatusCode};
use axum::routing::post;
use common::*;
use http_body_util::BodyExt;
use rgcs_core::operator::Role;
use serde_json::json;
use tower::ServiceExt;

async fn create_token(app: &axum::Router, cookie: &str) -> String {
    let (status, body, _) = call(
        app,
        req(
            Method::POST,
            "/api/settings/presentation/tokens",
            Some(cookie),
            Some(json!({ "label": "会場" })),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(
        body["data"]["url"],
        format!("/present?t={}", body["data"]["token"].as_str().unwrap())
    );
    body["data"]["token"].as_str().unwrap().to_string()
}

#[tokio::test]
async fn present_endpoints_need_a_valid_token() {
    let (app, _) = spawn_app().await;
    let (status, body, _) = call(&app, req_nocsrf(Method::GET, "/present/config", None)).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(error_code(&body), "invalid_token");
    let (status, _, _) = call(&app, req_nocsrf(Method::GET, "/present/config?t=deadbeef", None)).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);

    let cookie = login(&app).await;
    let token = create_token(&app, &cookie).await;
    let (status, body, _) = call(
        &app,
        req_nocsrf(Method::GET, &format!("/present/config?t={token}"), None),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["data"]["logo"], false);
    assert!(body["data"]["sysid"].is_null());
    assert_eq!(body["data"]["whep_path"], "mt11");
    assert!(body["data"]["map_tile_url"].is_string());

    let (status, _, _) = call(
        &app,
        req(
            Method::DELETE,
            &format!("/api/settings/presentation/tokens/{}", &token[..6]),
            Some(&cookie),
            None,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let (status, _, _) = call(
        &app,
        req_nocsrf(Method::GET, &format!("/present/config?t={token}"), None),
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED, "revoked tokens stop working");
}

#[tokio::test]
async fn admin_creates_lists_and_revokes_tokens_operators_cannot() {
    let (app, state) = spawn_app().await;
    state
        .store
        .create_user("op", "op-pass-1", Role::Operator)
        .await
        .unwrap();
    let op = login_as(&app, "op", "op-pass-1").await;
    let (status, body, _) = call(
        &app,
        req(
            Method::POST,
            "/api/settings/presentation/tokens",
            Some(&op),
            Some(json!({ "label": "x" })),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN, "{body}");
    assert_eq!(error_code(&body), "forbidden");
    let (status, _, _) = call(
        &app,
        req(Method::GET, "/api/settings/presentation/tokens", Some(&op), None),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "operators may read the list");

    let admin = login(&app).await;
    let token = create_token(&app, &admin).await;
    assert_eq!(token.len(), 32);
    let (_, list, _) = call(
        &app,
        req(
            Method::GET,
            "/api/settings/presentation/tokens",
            Some(&admin),
            None,
        ),
    )
    .await;
    assert_eq!(list["data"][0]["token_prefix"], &token[..6]);
    assert_eq!(list["data"][0]["label"], "会場");
    assert!(
        list["data"][0]["token"].is_null(),
        "the full token is never listed"
    );
}

fn upload(cookie: &str, content_type: &str, body: Vec<u8>) -> Request<Body> {
    Request::builder()
        .method(Method::PUT)
        .uri("/api/settings/branding/logo")
        .header("x-requested-with", "rgcs")
        .header(header::COOKIE, cookie)
        .header(header::CONTENT_TYPE, content_type)
        .body(Body::from(body))
        .unwrap()
}

#[tokio::test]
async fn logo_upload_limits_and_serves() {
    let (app, _) = spawn_app().await;
    let admin = login(&app).await;
    let token = create_token(&app, &admin).await;
    let svg = b"<svg xmlns='http://www.w3.org/2000/svg'/>".to_vec();
    let (status, body, _) = call(&app, upload(&admin, "image/svg+xml", svg.clone())).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let (_, cfg, _) = call(
        &app,
        req_nocsrf(Method::GET, &format!("/present/config?t={token}"), None),
    )
    .await;
    assert_eq!(cfg["data"]["logo"], true);
    let res = app
        .clone()
        .oneshot(req_nocsrf(Method::GET, &format!("/present/logo?t={token}"), None))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::OK);
    assert_eq!(res.headers()[header::CONTENT_TYPE], "image/svg+xml");
    assert_eq!(res.headers()[header::CACHE_CONTROL], "no-store");
    // An uploaded SVG must never run script in our origin when opened directly.
    assert_eq!(res.headers()["x-content-type-options"], "nosniff");
    assert_eq!(
        res.headers()[header::CONTENT_SECURITY_POLICY],
        "default-src 'none'; style-src 'unsafe-inline'; sandbox"
    );
    assert_eq!(
        res.headers()[header::CONTENT_DISPOSITION],
        "inline; filename=logo.svg"
    );
    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(&bytes[..], &svg[..]);

    let (status, _, _) = call(&app, upload(&admin, "image/png", vec![0u8; 1024 * 1024 + 1])).await;
    assert_eq!(status, StatusCode::PAYLOAD_TOO_LARGE);
    let (status, body, _) = call(&app, upload(&admin, "image/gif", vec![0u8; 10])).await;
    assert_eq!(status, StatusCode::UNSUPPORTED_MEDIA_TYPE, "{body}");

    let (status, _, _) = call(
        &app,
        req(Method::DELETE, "/api/settings/branding/logo", Some(&admin), None),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let res = app
        .clone()
        .oneshot(req_nocsrf(Method::GET, &format!("/present/logo?t={token}"), None))
        .await
        .unwrap();
    assert_eq!(res.status(), StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn present_vehicle_reports_the_first_vehicle_or_null() {
    let (app, state) = spawn_app().await;
    let admin = login(&app).await;
    let token = create_token(&app, &admin).await;
    let (status, body, _) = call(
        &app,
        req_nocsrf(Method::GET, &format!("/present/vehicle?t={token}"), None),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(body["data"].is_null());
    seed_vehicle(&state, 2, true, false).await;
    seed_vehicle(&state, 1, false, false).await;
    let (_, body, _) = call(
        &app,
        req_nocsrf(Method::GET, &format!("/present/vehicle?t={token}"), None),
    )
    .await;
    assert_eq!(body["data"]["sysid"], 1);
    assert_eq!(body["data"]["armed"], false);
    assert_eq!(body["data"]["mode"], "STABILIZE");
    assert!(body["data"]["lat"].is_number());
    let (_, cfg, _) = call(
        &app,
        req_nocsrf(Method::GET, &format!("/present/config?t={token}"), None),
    )
    .await;
    assert_eq!(cfg["data"]["sysid"], 1);
    assert_eq!(cfg["data"]["vehicle_name"], "UAV-01");
}

#[tokio::test]
async fn present_whep_relays_like_the_operator_endpoint() {
    let fake = axum::Router::new().route(
        "/mt11/whep",
        post(|body: String| async move {
            (
                StatusCode::CREATED,
                [(header::CONTENT_TYPE, "application/sdp")],
                format!("v=0 answer {}", body.len()),
            )
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move { axum::serve(listener, fake).await.unwrap() });
    let (app, _) = spawn_app_with_whep(&format!("http://127.0.0.1:{}/mt11/whep", addr.port())).await;
    let admin = login(&app).await;
    let token = create_token(&app, &admin).await;
    let sdp = |t: &str| {
        Request::builder()
            .method(Method::POST)
            .uri(format!("/present/whep?t={t}"))
            .header(header::CONTENT_TYPE, "application/sdp")
            .body(Body::from("v=0 offer"))
            .unwrap()
    };
    let res = app.clone().oneshot(sdp("nope")).await.unwrap();
    assert_eq!(res.status(), StatusCode::UNAUTHORIZED);
    let res = app.clone().oneshot(sdp(&token)).await.unwrap();
    assert_eq!(res.status(), StatusCode::CREATED);
    let bytes = res.into_body().collect().await.unwrap().to_bytes();
    assert_eq!(&bytes[..], b"v=0 answer 9");
}
