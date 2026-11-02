//! The UI compiled into the binary (P6, feature `embed-ui`): one file to copy to the Pi.
//! Exact files are served with their MIME type (hashed `assets/` cached for a year); any
//! other path is a SPA route and gets `index.html` (never cached, so upgrades show at once).

use axum::body::Body;
use axum::http::{header, HeaderValue, Method, Request, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Router;
use include_dir::Dir;

#[cfg(feature = "embed-ui")]
pub static UI_DIST: Dir<'static> = include_dir::include_dir!("$CARGO_MANIFEST_DIR/ui/dist");

const INDEX: &str = "index.html";
const ASSETS: &str = "assets/";
const IMMUTABLE: &str = "public, max-age=31536000, immutable";
const NO_CACHE: &str = "no-cache";

fn respond(path: &str, bytes: &'static [u8], cache: &'static str) -> Response {
    let mime = mime_guess::from_path(path).first_or_octet_stream();
    let mut res = (StatusCode::OK, Body::from(bytes)).into_response();
    let headers = res.headers_mut();
    if let Ok(v) = HeaderValue::from_str(mime.as_ref()) {
        headers.insert(header::CONTENT_TYPE, v);
    }
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static(cache));
    res
}

/// Serves `dir` as the SPA: files by exact path, everything else as `index.html`.
pub fn serve(dir: &'static Dir<'static>, req: &Request<Body>) -> Response {
    if req.method() != Method::GET && req.method() != Method::HEAD {
        return StatusCode::METHOD_NOT_ALLOWED.into_response();
    }
    let path = req.uri().path().trim_start_matches('/');
    if let Some(file) = dir.get_file(path) {
        let cache = if path.starts_with(ASSETS) {
            IMMUTABLE
        } else {
            NO_CACHE
        };
        return respond(path, file.contents(), cache);
    }
    // A missing hashed asset is a stale page, not a route: answer 404, not HTML.
    if path.starts_with(ASSETS) || path.starts_with("api/") {
        return StatusCode::NOT_FOUND.into_response();
    }
    match dir.get_file(INDEX) {
        Some(index) => respond(INDEX, index.contents(), NO_CACHE),
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

/// A router that only serves the embedded UI (used as the app's fallback).
pub fn embedded_router(dir: &'static Dir<'static>) -> Router {
    Router::new().fallback(move |req: Request<Body>| async move { serve(dir, &req) })
}
