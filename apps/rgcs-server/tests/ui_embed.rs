//! The UI compiled into the binary (P6): SPA routes fall back to index.html, hashed assets are
//! served with long caching, and the API is never shadowed.

mod common;

use axum::body::Body;
use axum::http::{header, Method, Request, StatusCode};
use http_body_util::BodyExt;
use include_dir::{include_dir, Dir};
use rgcs_server::app::{build_with_ui, UiSource};
use rgcs_server::ui_embed::embedded_router;
use tower::ServiceExt;

static FIXTURE: Dir<'static> = include_dir!("$CARGO_MANIFEST_DIR/tests/fixtures/ui");

async fn get(app: &axum::Router, path: &str) -> (StatusCode, String, String, String) {
    let res = app
        .clone()
        .oneshot(
            Request::builder()
                .method(Method::GET)
                .uri(path)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    let status = res.status();
    let h = |k| {
        res.headers()
            .get(k)
            .and_then(|v| v.to_str().ok())
            .unwrap_or("")
            .to_string()
    };
    let (ct, cc) = (h(header::CONTENT_TYPE), h(header::CACHE_CONTROL));
    let body = String::from_utf8_lossy(&res.into_body().collect().await.unwrap().to_bytes()).to_string();
    (status, ct, cc, body)
}

#[tokio::test]
async fn embedded_ui_serves_spa_routes_and_assets() {
    let app = embedded_router(&FIXTURE);
    for path in ["/", "/present?t=abc", "/mission"] {
        let (status, ct, cc, body) = get(&app, path).await;
        assert_eq!(status, StatusCode::OK, "{path}");
        assert!(ct.starts_with("text/html"), "{path}: {ct}");
        assert_eq!(cc, "no-cache", "{path}");
        assert!(body.contains(r#"<div id="root">"#), "{path}");
    }
    let (status, ct, cc, body) = get(&app, "/assets/app-abc123.js").await;
    assert_eq!(status, StatusCode::OK);
    assert!(ct.contains("javascript"), "{ct}");
    assert!(cc.contains("immutable"), "{cc}");
    assert!(body.contains("fixture"));
    let (status, _, _, _) = get(&app, "/assets/missing.js").await;
    assert_eq!(
        status,
        StatusCode::NOT_FOUND,
        "a missing hashed asset must not fall back to HTML"
    );
}

#[tokio::test]
async fn api_routes_are_not_shadowed() {
    let (_app, state) = common::spawn_app().await;
    let app = build_with_ui(state, UiSource::Embedded(&FIXTURE));
    let (status, ct, _, _) = get(&app, "/api/health").await;
    assert_eq!(status, StatusCode::OK);
    assert!(ct.starts_with("application/json"), "{ct}");
    let (status, _, _, body) = get(&app, "/api/nope").await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert!(
        !body.contains("<div id=\"root\">"),
        "unknown API paths must not get the SPA"
    );
    let (status, _, _, body) = get(&app, "/").await;
    assert_eq!(status, StatusCode::OK);
    assert!(body.contains(r#"<div id="root">"#));
}
