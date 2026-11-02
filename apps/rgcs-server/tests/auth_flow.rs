mod common;

use axum::http::{header, Method, StatusCode};
use common::*;

#[tokio::test]
async fn login_without_csrf_header_is_403() {
    let (app, _) = spawn_app().await;
    let (status, body, _) = call(
        &app,
        req_nocsrf(
            Method::POST,
            "/api/auth/login",
            Some(login_body("admin", "admin")),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(error_code(&body), "forbidden");
}

#[tokio::test]
async fn login_sets_httponly_strict_cookie() {
    let (app, _) = spawn_app().await;
    let (status, body, headers) = call(
        &app,
        req(
            Method::POST,
            "/api/auth/login",
            None,
            Some(login_body("admin", "admin")),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"]["username"], "admin");
    let set_cookie = headers[header::SET_COOKIE].to_str().unwrap();
    assert!(set_cookie.starts_with("rgcs_session="), "{set_cookie}");
    assert!(set_cookie.contains("HttpOnly"), "{set_cookie}");
    assert!(set_cookie.contains("SameSite=Strict"), "{set_cookie}");
}

#[tokio::test]
async fn five_failures_lock_the_account_for_60s() {
    let (app, _) = spawn_app().await;
    for attempt in 1..=5 {
        let (status, body, _) = call(
            &app,
            req(
                Method::POST,
                "/api/auth/login",
                None,
                Some(login_body("admin", "nope")),
            ),
        )
        .await;
        assert_eq!(status, StatusCode::UNAUTHORIZED, "attempt {attempt}");
        assert_eq!(error_code(&body), "unauthorized");
    }
    // The 6th attempt is refused even with the right password.
    let (status, body, _) = call(
        &app,
        req(
            Method::POST,
            "/api/auth/login",
            None,
            Some(login_body("admin", "admin")),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(error_code(&body), "locked");
}

#[tokio::test]
async fn vehicles_requires_session() {
    let (app, _) = spawn_app().await;
    let (status, body, _) = call(&app, req(Method::GET, "/api/vehicles", None, None)).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(error_code(&body), "unauthorized");

    let cookie = login(&app).await;
    let (status, body, _) = call(&app, req(Method::GET, "/api/vehicles", Some(&cookie), None)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"], serde_json::json!([]));
}

#[tokio::test]
async fn logout_invalidates_session() {
    let (app, _) = spawn_app().await;
    let cookie = login(&app).await;
    let (status, _, _) = call(&app, req(Method::POST, "/api/auth/logout", Some(&cookie), None)).await;
    assert_eq!(status, StatusCode::OK);
    let (status, body, _) = call(&app, req(Method::GET, "/api/auth/me", Some(&cookie), None)).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(error_code(&body), "unauthorized");
}

#[tokio::test]
async fn concurrent_failures_cannot_bypass_the_lockout() {
    let (app, _) = spawn_app().await;
    let attempts = (0..10).map(|_| {
        let app = app.clone();
        async move {
            let (status, _, _) = call(
                &app,
                req(
                    Method::POST,
                    "/api/auth/login",
                    None,
                    Some(login_body("admin", "nope")),
                ),
            )
            .await;
            status
        }
    });
    let statuses = futures::future::join_all(attempts).await;
    let unauthorized = statuses
        .iter()
        .filter(|s| **s == StatusCode::UNAUTHORIZED)
        .count();
    let locked = statuses
        .iter()
        .filter(|s| **s == StatusCode::TOO_MANY_REQUESTS)
        .count();
    assert_eq!(unauthorized, 5, "{statuses:?}");
    assert_eq!(locked, 5, "{statuses:?}");
}

#[tokio::test]
async fn health_is_public_and_reports_dev_mode() {
    let (app, _) = spawn_app().await;
    let (status, body, _) = call(&app, req_nocsrf(Method::GET, "/api/health", None)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"]["dev_mode"], true, "{body}");
    assert!(body["data"]["hostname"].is_string());
}
