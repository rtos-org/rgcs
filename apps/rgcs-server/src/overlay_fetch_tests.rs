//! `overlay_fetch` against the local fake (no internet).

use std::time::Duration;

use rgcs_core::{AreaStatus, TileFormat};
use rgcs_store::Store;

use crate::overlay_fake::{OverlayFake, FAKE_LAST_MODIFIED_MS};
use crate::overlay_fetch::{prune_tiles, run_area, OverlayFetcher};
use crate::overlay_tiles::{tiles, Rect, Source};

fn scratch() -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("rgcs-overlay-{}", uuid::Uuid::new_v4().simple()));
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

fn fetcher() -> OverlayFetcher {
    OverlayFetcher::with_timing(Duration::from_millis(300), Duration::ZERO)
}

/// A GIF overlay, zoom 8–14, on the fake in `mode`.
fn gif_src(fake: &OverlayFake, mode: &str) -> Source {
    src(fake, mode, TileFormat::Gif)
}

fn src(fake: &OverlayFake, mode: &str, format: TileFormat) -> Source {
    Source {
        plugin: "docomo-lte".into(),
        overlay: "lte".into(),
        template: fake.template(mode, format.ext()),
        format,
        tile_size: 256,
        min_zoom: 8,
        max_zoom: 14,
    }
}

#[tokio::test]
async fn a_good_tile_is_stored_with_its_data_date() {
    let fake = OverlayFake::start().await;
    let dir = scratch();
    let s = gif_src(&fake, "ok");
    let got = fetcher().fetch_and_store(&dir, &s, (9, 449, 205)).await;
    assert_eq!(got, Ok(Some(FAKE_LAST_MODIFIED_MS)));
    let bytes = std::fs::read(s.tile_path(&dir, 9, 449, 205)).unwrap();
    assert!(bytes.starts_with(b"GIF89a"));
    let leftovers: Vec<_> = std::fs::read_dir(dir.join("overlays/docomo-lte/lte/9/449"))
        .unwrap()
        .collect();
    assert_eq!(leftovers.len(), 1, "no temp file left behind");
}

#[tokio::test]
async fn png_overlays_store_png_tiles_and_check_the_format() {
    let fake = OverlayFake::start().await;
    let dir = scratch();
    let s = src(&fake, "ok", TileFormat::Png);
    assert!(fetcher().fetch_and_store(&dir, &s, (9, 1, 2)).await.is_ok());
    assert!(std::fs::read(s.tile_path(&dir, 9, 1, 2))
        .unwrap()
        .starts_with(b"\x89PNG"));
    // a GIF answer for a PNG overlay is refused
    let wrong = Source {
        template: fake.template("ok", "gif"),
        ..s.clone()
    };
    assert_eq!(
        fetcher().fetch_and_store(&dir, &wrong, (9, 1, 3)).await,
        Err("not_png".to_string())
    );
    let big = src(&fake, "big", TileFormat::Png);
    assert_eq!(
        fetcher().fetch_and_store(&dir, &big, (9, 1, 4)).await,
        Err("bad_size".to_string())
    );
}

#[tokio::test]
async fn bad_answers_get_short_codes_and_keep_the_cached_tile() {
    let fake = OverlayFake::start().await;
    let dir = scratch();
    fetcher()
        .fetch_and_store(&dir, &gif_src(&fake, "ok"), (9, 1, 2))
        .await
        .unwrap();
    for (mode, code) in [
        ("html", "html"),
        ("missing", "http_404"),
        ("big", "bad_size"),
        ("huge", "too_large"),
        ("slow", "timeout"),
        ("redirect", "redirect"),
    ] {
        let got = fetcher()
            .fetch_and_store(&dir, &gif_src(&fake, mode), (9, 1, 2))
            .await;
        assert_eq!(got, Err(code.to_string()), "{mode}");
    }
    let ok = gif_src(&fake, "ok");
    assert!(std::fs::read(ok.tile_path(&dir, 9, 1, 2))
        .unwrap()
        .starts_with(b"GIF89a"));
    let closed = Source {
        template: "http://127.0.0.1:1/{z}/{x}/{y}.gif".into(),
        ..ok
    };
    assert_eq!(
        OverlayFetcher::default()
            .fetch_and_store(&dir, &closed, (9, 1, 2))
            .await,
        Err("connect".to_string())
    );
}

#[tokio::test]
async fn at_most_two_requests_are_in_flight() {
    let fake = OverlayFake::start().await;
    let dir = scratch();
    let (f, s) = (fetcher(), gif_src(&fake, "paced"));
    let jobs = (0..8).map(|x| f.fetch_and_store(&dir, &s, (10, x, 0)));
    let results = futures::future::join_all(jobs).await;
    assert!(results.iter().all(Result::is_ok));
    assert_eq!(fake.hits(), 8);
    assert_eq!(fake.peak(), 2);
}

#[tokio::test]
async fn requests_are_spaced() {
    let fake = OverlayFake::start().await;
    let dir = scratch();
    let f = OverlayFetcher::with_timing(Duration::from_secs(1), Duration::from_millis(100));
    let s = gif_src(&fake, "ok");
    let t0 = std::time::Instant::now();
    let jobs = (0..4).map(|x| f.fetch_and_store(&dir, &s, (10, x, 0)));
    futures::future::join_all(jobs).await;
    assert!(t0.elapsed() >= Duration::from_millis(300), "{:?}", t0.elapsed());
}

/// A rectangle inside one tile at every zoom 8–14: 7 tiles.
const SMALL: Rect = Rect {
    south: 33.668,
    west: 135.904,
    north: 33.6683,
    east: 135.9042,
};

async fn run(mode: &str) -> (rgcs_core::OverlayArea, std::path::PathBuf) {
    let fake = OverlayFake::start().await;
    let store = Store::open_memory().await.unwrap();
    let dir = scratch();
    let r = SMALL;
    let area = store
        .create_overlay_area(("docomo-lte", "lte"), "a", (r.south, r.west, r.north, r.east), 7)
        .await
        .unwrap();
    assert!(store.begin_area_fetch(area.id, 7).await.unwrap());
    run_area(
        fetcher(),
        store.clone(),
        dir.clone(),
        area.id,
        gif_src(&fake, mode),
        r,
    )
    .await;
    (store.get_overlay_area(area.id).await.unwrap().unwrap(), dir)
}

#[tokio::test]
async fn an_area_fetch_ends_ready_partial_or_failed() {
    let (ok, dir) = run("ok").await;
    assert_eq!(
        (ok.status, ok.tiles_ok, ok.tiles_failed),
        (AreaStatus::Ready, 7, 0)
    );
    assert_eq!(ok.data_modified, Some(FAKE_LAST_MODIFIED_MS));
    assert!(ok.fetched_at.is_some() && ok.last_error.is_none());
    assert_eq!(cached(&dir).len(), 7);

    let (mixed, _) = run("mixed").await;
    assert_eq!(mixed.status, AreaStatus::Partial);
    assert_eq!(mixed.tiles_ok + mixed.tiles_failed, 7);
    assert!(mixed.tiles_ok > 0 && mixed.tiles_failed > 0);
    assert_eq!(mixed.last_error.as_deref(), Some("http_404"));

    let (bad, _) = run("missing").await;
    assert_eq!(
        (bad.status, bad.tiles_ok, bad.tiles_failed),
        (AreaStatus::Failed, 0, 7)
    );
    assert!(bad.data_modified.is_none());
}

/// Every cached tile file under `<dir>/overlays`.
fn cached(dir: &std::path::Path) -> Vec<std::path::PathBuf> {
    fn walk(p: &std::path::Path, out: &mut Vec<std::path::PathBuf>) {
        for e in std::fs::read_dir(p).into_iter().flatten().flatten() {
            if e.path().is_dir() {
                walk(&e.path(), out);
            } else {
                out.push(e.path());
            }
        }
    }
    let mut out = Vec::new();
    walk(&dir.join("overlays"), &mut out);
    out
}

#[tokio::test]
async fn pruning_keeps_tiles_another_area_covers() {
    let dir = scratch();
    let s = Source {
        plugin: "p".into(),
        overlay: "o".into(),
        template: String::new(),
        format: TileFormat::Gif,
        tile_size: 256,
        min_zoom: 8,
        max_zoom: 14,
    };
    let other = Source {
        overlay: "other".into(),
        ..s.clone()
    };
    // Two side-by-side rectangles that share tiles at the low zooms.
    let a = Rect {
        south: 33.60,
        west: 135.80,
        north: 33.65,
        east: 135.85,
    };
    let b = Rect {
        south: 33.60,
        west: 135.85,
        north: 33.65,
        east: 135.90,
    };
    let put = |src: &Source, (z, x, y): (u8, u32, u32)| {
        let p = src.tile_path(&dir, z, x, y);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(&p, b"GIF89a").unwrap();
    };
    for t in tiles(&a, s.zooms()).chain(tiles(&b, s.zooms())) {
        put(&s, t);
    }
    // the same rectangle under another overlay is not touched
    tiles(&a, s.zooms()).for_each(|t| put(&other, t));
    let removed = prune_tiles(&dir, &s, a, &[b]).await;
    assert!(removed > 0);
    for (z, x, y) in tiles(&b, s.zooms()) {
        assert!(s.tile_path(&dir, z, x, y).exists(), "b keeps {z}/{x}/{y}");
    }
    let n_other = tiles(&a, s.zooms()).count();
    assert_eq!(cached(&dir).len(), tiles(&b, s.zooms()).count() + n_other);
    // The last area takes its tiles with it.
    prune_tiles(&dir, &s, b, &[]).await;
    assert_eq!(cached(&dir).len(), n_other);
}
