//! A local stand-in for a plugin's tile server (tests only; no internet). Tiles live under
//! `/{mode}/{z}/{x}/{y}.{gif|png}`; the mode picks the answer and the extension the format.

use std::net::SocketAddr;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use axum::extract::{Path, State};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;

/// `Last-Modified` of every good tile: 2026-10-01 00:00 UTC.
pub const FAKE_LAST_MODIFIED: &str = "Thu, 01 Oct 2026 00:00:00 GMT";
pub const FAKE_LAST_MODIFIED_MS: u64 = 1_790_812_800_000;

#[derive(Clone, Default)]
struct Counters {
    hits: Arc<AtomicUsize>,
    active: Arc<AtomicUsize>,
    peak: Arc<AtomicUsize>,
}

pub struct OverlayFake {
    pub addr: SocketAddr,
    counters: Counters,
}

impl OverlayFake {
    pub async fn start() -> Self {
        let counters = Counters::default();
        let app = axum::Router::new()
            .route("/{mode}/{z}/{x}/{y}", get(tile))
            .with_state(counters.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.expect("bind");
        let addr = listener.local_addr().expect("addr");
        tokio::spawn(async move { axum::serve(listener, app).await.ok() });
        Self { addr, counters }
    }

    /// The tile template for one mode and extension (`gif` / `png`): `ok`, `html`, `missing`,
    /// `big`, `slow`, `redirect`, `huge`, `mixed` (ok when `x + y` is even, else 404), `paced`
    /// (ok after 50 ms).
    pub fn template(&self, mode: &str, ext: &str) -> String {
        format!("http://{}/{mode}/{{z}}/{{x}}/{{y}}.{ext}", self.addr)
    }

    pub fn hits(&self) -> usize {
        self.counters.hits.load(Ordering::SeqCst)
    }

    /// Most requests seen in flight at once.
    pub fn peak(&self) -> usize {
        self.counters.peak.load(Ordering::SeqCst)
    }
}

/// A GIF89a header of `w`×`h` plus filler up to `len` bytes.
pub fn fake_gif(w: u16, h: u16, len: usize) -> Vec<u8> {
    let mut b = b"GIF89a".to_vec();
    b.extend_from_slice(&w.to_le_bytes());
    b.extend_from_slice(&h.to_le_bytes());
    b.resize(len.max(b.len() + 1) - 1, 0);
    b.push(0x3b);
    b
}

/// A PNG signature and IHDR of `w`×`h` (enough for the format check).
pub fn fake_png(w: u32, h: u32) -> Vec<u8> {
    let mut b = b"\x89PNG\r\n\x1a\n".to_vec();
    b.extend_from_slice(&13u32.to_be_bytes());
    b.extend_from_slice(b"IHDR");
    b.extend_from_slice(&w.to_be_bytes());
    b.extend_from_slice(&h.to_be_bytes());
    b.extend_from_slice(&[8, 6, 0, 0, 0, 0, 0, 0, 0]);
    b
}

/// A good image of `px`×`px` (filler up to `len` for GIF).
fn image(png: bool, px: u16, len: usize) -> Response {
    if png {
        let mut b = fake_png(px.into(), px.into());
        b.resize(b.len().max(len), 0);
        image_response("image/png", b)
    } else {
        image_response("image/gif", fake_gif(px, px, len))
    }
}

fn image_response(content_type: &'static str, body: Vec<u8>) -> Response {
    (
        [
            (header::CONTENT_TYPE, content_type),
            (header::LAST_MODIFIED, FAKE_LAST_MODIFIED),
            (header::CACHE_CONTROL, "no-store"),
        ],
        body,
    )
        .into_response()
}

async fn answer(mode: &str, png: bool, x: u32, y: u32) -> Response {
    match mode {
        "ok" => image(png, 256, 64),
        "paced" => {
            tokio::time::sleep(Duration::from_millis(50)).await;
            image(png, 256, 64)
        }
        "mixed" if (x + y) % 2 == 0 => image(png, 256, 64),
        "html" => ([(header::CONTENT_TYPE, "text/html")], "<html>maintenance</html>").into_response(),
        "big" => image(png, 512, 64),
        "huge" => image(png, 256, 600 * 1024),
        "slow" => {
            tokio::time::sleep(Duration::from_secs(5)).await;
            image(png, 256, 64)
        }
        "redirect" => (StatusCode::FOUND, [(header::LOCATION, "/ok/8/0/0.gif")]).into_response(),
        _ => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn tile(
    State(c): State<Counters>,
    Path((mode, _z, x, y)): Path<(String, u8, u32, String)>,
) -> Response {
    c.hits.fetch_add(1, Ordering::SeqCst);
    let now = c.active.fetch_add(1, Ordering::SeqCst) + 1;
    c.peak.fetch_max(now, Ordering::SeqCst);
    let png = y.ends_with(".png");
    let y: u32 = y.split('.').next().unwrap_or("").parse().unwrap_or(0);
    let res = answer(&mode, png, x, y).await;
    c.active.fetch_sub(1, Ordering::SeqCst);
    res
}
