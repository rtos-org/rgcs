//! Plugin overlay tile fetcher: one client with no
//! redirects, at most two requests in flight across the server and every plugin, 100 ms between
//! requests, a 10 s timeout and a 512 KiB body cap. The URL template comes from each overlay's
//! manifest. Errors are short codes; URLs and bodies are never logged.

use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, UNIX_EPOCH};

use futures::StreamExt;
use rgcs_core::AreaStatus;
use rgcs_store::Store;
use tokio::sync::{Mutex, Semaphore};
use tokio::time::Instant;

use crate::overlay_tiles::{check_tile, covers, tile_url, tiles, Rect, Source};

/// Requests in flight at once, across every area.
pub const OVERLAY_IN_FLIGHT: usize = 2;
pub const OVERLAY_SPACING: Duration = Duration::from_millis(100);
pub const OVERLAY_TIMEOUT: Duration = Duration::from_secs(10);
/// Tile bodies above this are refused as `too_large`.
pub const OVERLAY_BODY_CAP: usize = 512 * 1024;
/// Progress is written to the area row every this many tiles.
const PROGRESS_EVERY: u64 = 10;
const USER_AGENT: &str = concat!("RGCS/", env!("CARGO_PKG_VERSION"));

struct Inner {
    client: reqwest::Client,
    timeout: Duration,
    spacing: Duration,
    permits: Semaphore,
    next_slot: Mutex<Instant>,
}

/// Shared by every area task of every plugin (cheap to clone). The URL template comes with
/// each request's [`Source`].
#[derive(Clone)]
pub struct OverlayFetcher {
    inner: Arc<Inner>,
}

impl Default for OverlayFetcher {
    fn default() -> Self {
        Self::with_timing(OVERLAY_TIMEOUT, OVERLAY_SPACING)
    }
}

impl OverlayFetcher {
    /// Tests: a short timeout and spacing.
    pub fn with_timing(timeout: Duration, spacing: Duration) -> Self {
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .user_agent(USER_AGENT)
            .build()
            .expect("static reqwest client");
        Self {
            inner: Arc::new(Inner {
                client,
                timeout,
                spacing,
                permits: Semaphore::new(OVERLAY_IN_FLIGHT),
                next_slot: Mutex::new(Instant::now()),
            }),
        }
    }

    /// Waits for this request's slot, `spacing` after the previous one.
    async fn pace(&self) {
        let wait = {
            let mut next = self.inner.next_slot.lock().await;
            let now = Instant::now();
            let at = (*next).max(now);
            *next = at + self.inner.spacing;
            at - now
        };
        tokio::time::sleep(wait).await;
    }

    /// Fetches and validates one tile; returns the body and its `Last-Modified` (unix ms).
    pub async fn fetch_tile(
        &self,
        src: &Source,
        z: u8,
        x: u32,
        y: u32,
    ) -> Result<(Vec<u8>, Option<u64>), String> {
        let _permit = self
            .inner
            .permits
            .acquire()
            .await
            .map_err(|_| "closed".to_string())?;
        self.pace().await;
        let url = tile_url(&src.template, z, x, y);
        tokio::time::timeout(
            self.inner.timeout,
            get_tile(&self.inner.client, &url, self.inner.timeout, src),
        )
        .await
        .unwrap_or_else(|_| Err("timeout".into()))
    }

    /// Fetches one tile into the overlay's cache (temp file + rename). A failure leaves any
    /// cached tile in place.
    pub async fn fetch_and_store(
        &self,
        data_dir: &Path,
        src: &Source,
        (z, x, y): (u8, u32, u32),
    ) -> Result<Option<u64>, String> {
        let (body, modified) = self.fetch_tile(src, z, x, y).await?;
        write_atomic(&src.tile_path(data_dir, z, x, y), &body)
            .await
            .map_err(|_| "io".to_string())?;
        Ok(modified)
    }
}

fn send_error(e: &reqwest::Error) -> String {
    if e.is_timeout() {
        "timeout"
    } else if e.is_redirect() {
        "redirect"
    } else {
        "connect"
    }
    .into()
}

fn last_modified(res: &reqwest::Response) -> Option<u64> {
    let text = res.headers().get(reqwest::header::LAST_MODIFIED)?.to_str().ok()?;
    let t = httpdate::parse_http_date(text).ok()?;
    t.duration_since(UNIX_EPOCH).ok().map(|d| d.as_millis() as u64)
}

async fn get_tile(
    client: &reqwest::Client,
    url: &str,
    timeout: Duration,
    src: &Source,
) -> Result<(Vec<u8>, Option<u64>), String> {
    let mut res = client
        .get(url)
        .timeout(timeout)
        .send()
        .await
        .map_err(|e| send_error(&e))?;
    let status = res.status();
    if status.is_redirection() {
        return Err("redirect".into());
    }
    if status != reqwest::StatusCode::OK {
        return Err(format!("http_{}", status.as_u16()));
    }
    if res.content_length().is_some_and(|n| n > OVERLAY_BODY_CAP as u64) {
        return Err("too_large".into());
    }
    let content_type = res
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);
    let modified = last_modified(&res);
    let mut body: Vec<u8> = Vec::new();
    while let Some(chunk) = res.chunk().await.map_err(|e| send_error(&e))? {
        if body.len() + chunk.len() > OVERLAY_BODY_CAP {
            return Err("too_large".into());
        }
        body.extend_from_slice(&chunk);
    }
    check_tile(src.format, src.tile_size, content_type.as_deref(), &body).map_err(str::to_string)?;
    Ok((body, modified))
}

async fn write_atomic(path: &Path, body: &[u8]) -> std::io::Result<()> {
    let dir = path.parent().ok_or(std::io::ErrorKind::InvalidInput)?;
    tokio::fs::create_dir_all(dir).await?;
    let tmp = dir.join(format!(".tmp-{}", uuid::Uuid::new_v4().simple()));
    if let Err(e) = tokio::fs::write(&tmp, body).await {
        let _ = tokio::fs::remove_file(&tmp).await;
        return Err(e);
    }
    tokio::fs::rename(&tmp, path).await
}

/// Running counts of one area fetch.
#[derive(Debug, Default)]
struct Tally {
    ok: u64,
    failed: u64,
    data_modified: Option<u64>,
    last_error: Option<String>,
}

impl Tally {
    fn add(&mut self, r: Result<Option<u64>, String>) {
        match r {
            Ok(m) => {
                self.ok += 1;
                self.data_modified = self.data_modified.max(m);
            }
            Err(code) => {
                self.failed += 1;
                self.last_error = Some(code);
            }
        }
    }

    fn status(&self) -> AreaStatus {
        match (self.ok, self.failed) {
            (_, 0) => AreaStatus::Ready,
            (0, _) => AreaStatus::Failed,
            _ => AreaStatus::Partial,
        }
    }

    async fn flush(&self, store: &Store, id: i64) {
        let r = store
            .area_progress(
                id,
                self.ok,
                self.failed,
                self.data_modified,
                self.last_error.as_deref(),
            )
            .await;
        if let Err(e) = r {
            tracing::warn!(area = id, error = %e, "overlay progress write failed");
        }
    }
}

/// Fetches every tile of `rect` for area `id` (already claimed with `begin_area_fetch`) and
/// records progress and the outcome. Never panics on a fetch or store error.
pub async fn run_area(
    fetcher: OverlayFetcher,
    store: Store,
    data_dir: PathBuf,
    id: i64,
    src: Source,
    rect: Rect,
) {
    tracing::info!(area = id, plugin = %src.plugin, overlay = %src.overlay, "overlay fetch started");
    let mut tally = Tally::default();
    let mut results = futures::stream::iter(tiles(&rect, src.zooms()))
        .map(|t| {
            let (f, dir, src) = (&fetcher, &data_dir, &src);
            async move { f.fetch_and_store(dir, src, t).await }
        })
        .buffer_unordered(OVERLAY_IN_FLIGHT);
    while let Some(r) = results.next().await {
        tally.add(r);
        if (tally.ok + tally.failed) % PROGRESS_EVERY == 0 {
            tally.flush(&store, id).await;
        }
    }
    tally.flush(&store, id).await;
    let status = tally.status();
    if let Err(e) = store.finish_area_fetch(id, status, crate::app::unix_ms()).await {
        tracing::warn!(area = id, error = %e, "overlay finish write failed");
    }
    tracing::info!(
        area = id,
        ok = tally.ok,
        failed = tally.failed,
        "overlay fetch done"
    );
}

/// Starts `run_area` in the background.
pub fn spawn_area(
    fetcher: OverlayFetcher,
    store: Store,
    data_dir: PathBuf,
    id: i64,
    src: Source,
    rect: Rect,
) {
    tokio::spawn(run_area(fetcher, store, data_dir, id, src, rect));
}

/// Removes the cached tiles of `gone` that none of `others` (areas of the same overlay)
/// covers; returns how many.
pub async fn prune_tiles(data_dir: &Path, src: &Source, gone: Rect, others: &[Rect]) -> u64 {
    let zooms = src.zooms();
    let mut removed = 0;
    for (z, x, y) in tiles(&gone, zooms.clone()) {
        if others.iter().any(|r| covers(r, &zooms, z, x, y)) {
            continue;
        }
        if tokio::fs::remove_file(src.tile_path(data_dir, z, x, y))
            .await
            .is_ok()
        {
            removed += 1;
        }
    }
    removed
}
