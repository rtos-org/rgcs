//! `/api/plugins/{p}/overlays/{o}/*`: areas of a plugin `area` overlay and the tile route,
//! against the local fake (no internet).

mod common;

use std::time::Duration;

use axum::body::Body;
use axum::http::{header, Method, Request, StatusCode};
use common::*;
use http_body_util::BodyExt;
use rgcs_core::TileFormat;
use rgcs_server::app::{self, AppState};
use rgcs_server::overlay_fake::OverlayFake;
use rgcs_server::overlay_fetch::OverlayFetcher;
use rgcs_server::overlay_tiles::{tiles, Rect, Source, TRANSPARENT_GIF, TRANSPARENT_PNG};
use rgcs_server::plugins::{PluginRegistry, MANIFEST};
use serde_json::{json, Value};
use tower::ServiceExt;

const NACHI: Rect = Rect {
    south: 33.64,
    west: 135.88,
    north: 33.66,
    east: 135.90,
};
const NEXT_DOOR: Rect = Rect {
    south: 33.64,
    west: 135.94,
    north: 33.66,
    east: 135.96,
};

const BASE: &str = "/api/plugins/docomo-lte/overlays/lte";
const Z8_14: std::ops::RangeInclusive<u8> = 8..=14;

/// `docomo-lte` with a GIF `area` overlay `lte` (zoom 8–14) on the fake in `mode`, a PNG `area`
/// overlay `png` and a `direct` overlay `sea`.
fn manifest(fake: &OverlayFake, mode: &str) -> String {
    let overlay = |id: &str, cache: &str, ext: &str| {
        format!(
            "[[overlay]]\nid = \"{id}\"\nname = \"{id}\"\ntiles = \"{}\"\ncache = \"{cache}\"\n\
             format = \"{ext}\"\ntile_size = 256\nmin_zoom = 8\nmax_zoom = 14\n",
            fake.template(mode, ext)
        )
    };
    format!(
        "id = \"docomo-lte\"\napi = 1\nversion = \"1\"\nname = \"LTE\"\n{}{}{}",
        overlay("lte", "area", "gif"),
        overlay("png", "area", "png"),
        overlay("sea", "direct", "png")
    )
}

/// The `lte` overlay as the server sees it (for cache paths).
fn lte_source() -> Source {
    Source {
        plugin: "docomo-lte".into(),
        overlay: "lte".into(),
        template: String::new(),
        format: TileFormat::Gif,
        tile_size: 256,
        min_zoom: 8,
        max_zoom: 14,
    }
}

async fn overlay_app(fake: &OverlayFake, mode: &str) -> (axum::Router, AppState, String) {
    let root = temp_data_dir();
    std::fs::create_dir_all(root.join("docomo-lte")).unwrap();
    std::fs::write(root.join("docomo-lte").join(MANIFEST), manifest(fake, mode)).unwrap();
    let (_app, state) = spawn_app().await;
    let state = state
        .with_plugins(PluginRegistry::scan(&root))
        .with_overlay_fetcher(OverlayFetcher::with_timing(
            Duration::from_millis(300),
            Duration::ZERO,
        ));
    let app = app::build(state.clone(), None);
    let cookie = login(&app).await;
    (app, state, cookie)
}

fn count(r: &Rect) -> u64 {
    rgcs_server::overlay_tiles::count(r, Z8_14)
}

fn tile_path(data_dir: &std::path::Path, z: u8, x: u32, y: u32) -> std::path::PathBuf {
    lte_source().tile_path(data_dir, z, x, y)
}

fn rect_json(r: Rect) -> Value {
    json!({ "south": r.south, "west": r.west, "north": r.north, "east": r.east })
}

fn area_json(name: &str, r: Rect) -> Value {
    let mut v = rect_json(r);
    v["name"] = json!(name);
    v
}

async fn create(app: &axum::Router, cookie: &str, name: &str, r: Rect) -> (StatusCode, Value) {
    let (s, b, _) = call(
        app,
        req(
            Method::POST,
            &format!("{BASE}/areas"),
            Some(cookie),
            Some(area_json(name, r)),
        ),
    )
    .await;
    (s, b)
}

async fn list(app: &axum::Router, cookie: &str) -> Vec<Value> {
    let (s, b, _) = call(
        app,
        req(Method::GET, &format!("{BASE}/areas"), Some(cookie), None),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{b}");
    b["data"].as_array().unwrap().clone()
}

/// Polls until no area is fetching.
async fn settle(app: &axum::Router, cookie: &str) -> Vec<Value> {
    for _ in 0..200 {
        let rows = list(app, cookie).await;
        if rows.iter().all(|r| r["status"] != "fetching") {
            return rows;
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    panic!("areas still fetching");
}

async fn get_tile(
    app: &axum::Router,
    cookie: &str,
    path: &str,
) -> (StatusCode, Vec<u8>, axum::http::HeaderMap) {
    let request = Request::builder()
        .uri(path)
        .header(header::COOKIE, cookie)
        .body(Body::empty())
        .unwrap();
    let res = app.clone().oneshot(request).await.unwrap();
    let (status, headers) = (res.status(), res.headers().clone());
    let bytes = res.into_body().collect().await.unwrap().to_bytes().to_vec();
    (status, bytes, headers)
}

#[tokio::test]
async fn estimate_counts_tiles_and_rejects_bad_rectangles() {
    let fake = OverlayFake::start().await;
    let (app, _state, cookie) = overlay_app(&fake, "ok").await;
    let (s, b, _) = call(
        &app,
        req(
            Method::POST,
            &format!("{BASE}/areas/estimate"),
            Some(&cookie),
            Some(rect_json(NACHI)),
        ),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{b}");
    assert_eq!(b["data"]["tiles"], count(&NACHI));
    let flipped = json!({ "south": 33.7, "west": 135.8, "north": 33.6, "east": 135.9 });
    let (s, b, _) = call(
        &app,
        req(
            Method::POST,
            &format!("{BASE}/areas/estimate"),
            Some(&cookie),
            Some(flipped),
        ),
    )
    .await;
    assert_eq!((s, error_code(&b)), (StatusCode::BAD_REQUEST, "bad_rect"));
    let (s, _, _) = call(
        &app,
        req(
            Method::POST,
            &format!("{BASE}/areas/estimate"),
            None,
            Some(rect_json(NACHI)),
        ),
    )
    .await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);
    assert_eq!(fake.hits(), 0, "an estimate fetches nothing");
}

#[tokio::test]
async fn create_refuses_bad_input_before_fetching() {
    let fake = OverlayFake::start().await;
    let (app, _state, cookie) = overlay_app(&fake, "ok").await;
    let japan = Rect {
        south: 30.0,
        west: 129.0,
        north: 45.0,
        east: 146.0,
    };
    assert_eq!(
        create(&app, &cookie, "日本", japan).await.1["error"]["code"],
        "too_many_tiles"
    );
    let (s, b) = create(&app, &cookie, "  ", NACHI).await;
    assert_eq!((s, error_code(&b)), (StatusCode::BAD_REQUEST, "bad_name"));
    let long = "あ".repeat(61);
    assert_eq!(
        create(&app, &cookie, &long, NACHI).await.0,
        StatusCode::BAD_REQUEST
    );
    let mut bad = area_json("x", NACHI);
    bad["east"] = json!(200.0);
    let (s, b, _) = call(
        &app,
        req(Method::POST, &format!("{BASE}/areas"), Some(&cookie), Some(bad)),
    )
    .await;
    assert_eq!((s, error_code(&b)), (StatusCode::BAD_REQUEST, "bad_rect"));
    assert!(list(&app, &cookie).await.is_empty());
    assert_eq!(fake.hits(), 0);
}

#[tokio::test]
async fn create_fetches_and_serves_the_tiles() {
    let fake = OverlayFake::start().await;
    let (app, state, cookie) = overlay_app(&fake, "ok").await;
    let (s, b) = create(&app, &cookie, "那智勝浦", NACHI).await;
    assert_eq!(s, StatusCode::OK, "{b}");
    assert_eq!(b["data"]["status"], "fetching");
    assert_eq!(b["data"]["name"], "那智勝浦");
    assert_eq!(b["data"]["tiles_total"], count(&NACHI));
    let rows = settle(&app, &cookie).await;
    assert_eq!(rows[0]["status"], "ready");
    assert_eq!(rows[0]["tiles_ok"], count(&NACHI));
    assert!(rows[0]["fetched_at"].as_u64().is_some());
    assert_eq!(
        rows[0]["data_modified"],
        rgcs_server::overlay_fake::FAKE_LAST_MODIFIED_MS
    );

    let (z, x, y) = tiles(&NACHI, Z8_14).last().unwrap();
    assert!(tile_path(&state.data_dir, z, x, y).exists());
    let (s, body, h) = get_tile(&app, &cookie, &format!("{BASE}/tiles/{z}/{x}/{y}.gif")).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(h[header::CONTENT_TYPE], "image/gif");
    assert_eq!(h[header::CACHE_CONTROL], "private, max-age=3600");
    assert_eq!(body, std::fs::read(tile_path(&state.data_dir, z, x, y)).unwrap());
}

#[tokio::test]
async fn the_tile_route_never_fails_for_a_well_formed_tile() {
    let fake = OverlayFake::start().await;
    let (app, _state, cookie) = overlay_app(&fake, "ok").await;
    let (s, body, h) = get_tile(&app, &cookie, &format!("{BASE}/tiles/12/3632/1635.gif")).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(h[header::CONTENT_TYPE], "image/gif");
    assert_eq!(body, TRANSPARENT_GIF);
    for bad in [
        "12/4096/0.gif",
        "12/0/4096.gif",
        "23/0/0.gif",
        "12/0/abc.gif",
        "12/0/1.png",
    ] {
        assert_eq!(
            get_tile(&app, &cookie, &format!("{BASE}/tiles/{bad}")).await.0,
            StatusCode::NOT_FOUND,
            "{bad}"
        );
    }
    let (s, _, _) = call(
        &app,
        req(Method::GET, &format!("{BASE}/tiles/12/0/0.gif"), None, None),
    )
    .await;
    assert_eq!(s, StatusCode::UNAUTHORIZED);
    assert_eq!(fake.hits(), 0, "the tile route never fetches");
}

#[tokio::test]
async fn refresh_and_delete_wait_for_the_fetch() {
    let fake = OverlayFake::start().await;
    let (app, _state, cookie) = overlay_app(&fake, "slow").await;
    let (_, b) = create(&app, &cookie, "a", NACHI).await;
    let id = b["data"]["id"].as_i64().unwrap();
    let refresh = format!("{BASE}/areas/{id}/refresh");
    let (s, b, _) = call(&app, req(Method::POST, &refresh, Some(&cookie), None)).await;
    assert_eq!((s, error_code(&b)), (StatusCode::CONFLICT, "busy"));
    let (s, b, _) = call(
        &app,
        req(Method::DELETE, &format!("{BASE}/areas/{id}"), Some(&cookie), None),
    )
    .await;
    assert_eq!((s, error_code(&b)), (StatusCode::CONFLICT, "busy"));
    let rows = settle(&app, &cookie).await;
    assert_eq!(
        (rows[0]["status"].as_str(), rows[0]["last_error"].as_str()),
        (Some("failed"), Some("timeout"))
    );
    let (s, b, _) = call(&app, req(Method::POST, &refresh, Some(&cookie), None)).await;
    assert_eq!(s, StatusCode::OK, "{b}");
    assert_eq!(b["data"]["status"], "fetching");
    assert_eq!(b["data"]["tiles_failed"], 0);
    let (s, b, _) = call(
        &app,
        req(
            Method::POST,
            &format!("{BASE}/areas/999/refresh"),
            Some(&cookie),
            None,
        ),
    )
    .await;
    assert_eq!((s, error_code(&b)), (StatusCode::NOT_FOUND, "not_found"));
    let (s, _, _) = call(
        &app,
        req(Method::DELETE, &format!("{BASE}/areas/999"), Some(&cookie), None),
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn delete_keeps_the_tiles_another_area_covers() {
    let fake = OverlayFake::start().await;
    let (app, state, cookie) = overlay_app(&fake, "ok").await;
    let (_, a) = create(&app, &cookie, "a", NACHI).await;
    create(&app, &cookie, "b", NEXT_DOOR).await;
    settle(&app, &cookie).await;
    let id = a["data"]["id"].as_i64().unwrap();
    let (s, _, _) = call(
        &app,
        req(Method::DELETE, &format!("{BASE}/areas/{id}"), Some(&cookie), None),
    )
    .await;
    assert_eq!(s, StatusCode::NO_CONTENT);
    let rows = list(&app, &cookie).await;
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0]["name"], "b");
    assert!(tiles(&NEXT_DOOR, Z8_14).all(|(z, x, y)| tile_path(&state.data_dir, z, x, y).exists()));
    let only_a = tiles(&NACHI, Z8_14)
        .find(|&(z, x, y)| !rgcs_server::overlay_tiles::covers(&NEXT_DOOR, &Z8_14, z, x, y));
    let (z, x, y) = only_a.expect("a has tiles of its own");
    assert!(!tile_path(&state.data_dir, z, x, y).exists());
}

#[tokio::test]
async fn unknown_disabled_and_direct_overlays_are_not_found() {
    let fake = OverlayFake::start().await;
    let (app, state, cookie) = overlay_app(&fake, "ok").await;
    for path in [
        "/api/plugins/nobody/overlays/lte/areas",
        "/api/plugins/docomo-lte/overlays/nothing/areas",
        "/api/plugins/docomo-lte/overlays/sea/areas",
    ] {
        let (s, b, _) = call(&app, req(Method::GET, path, Some(&cookie), None)).await;
        assert_eq!(
            (s, error_code(&b)),
            (StatusCode::NOT_FOUND, "not_found"),
            "{path}"
        );
    }
    let sea_tile = "/api/plugins/docomo-lte/overlays/sea/tiles/12/0/0.png";
    assert_eq!(get_tile(&app, &cookie, sea_tile).await.0, StatusCode::NOT_FOUND);
    state.plugins.set_enabled("docomo-lte", false);
    let (s, _, _) = call(
        &app,
        req(Method::GET, &format!("{BASE}/areas"), Some(&cookie), None),
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND);
    assert_eq!(
        get_tile(&app, &cookie, &format!("{BASE}/tiles/12/0/0.gif"))
            .await
            .0,
        StatusCode::NOT_FOUND
    );
    // the old LTE routes are gone: the path falls through to the UI fallback, no API envelope
    let (_, b, _) = call(&app, req(Method::GET, "/api/lte/areas", Some(&cookie), None)).await;
    assert!(b.get("success").is_none(), "{b}");
    assert_eq!(fake.hits(), 0);
}

#[tokio::test]
async fn areas_belong_to_their_overlay() {
    let fake = OverlayFake::start().await;
    let (app, _state, cookie) = overlay_app(&fake, "ok").await;
    let (_, a) = create(&app, &cookie, "a", NACHI).await;
    let id = a["data"]["id"].as_i64().unwrap();
    assert_eq!(a["data"]["plugin_id"], "docomo-lte");
    assert_eq!(a["data"]["overlay_id"], "lte");
    settle(&app, &cookie).await;
    let png = "/api/plugins/docomo-lte/overlays/png";
    let (s, b, _) = call(
        &app,
        req(Method::GET, &format!("{png}/areas"), Some(&cookie), None),
    )
    .await;
    assert_eq!(s, StatusCode::OK);
    assert!(b["data"].as_array().unwrap().is_empty());
    let (s, _, _) = call(
        &app,
        req(Method::DELETE, &format!("{png}/areas/{id}"), Some(&cookie), None),
    )
    .await;
    assert_eq!(s, StatusCode::NOT_FOUND, "an area of another overlay");
    assert_eq!(list(&app, &cookie).await.len(), 1);
}

#[tokio::test]
async fn png_overlays_fetch_png_and_fall_back_to_a_transparent_png() {
    let fake = OverlayFake::start().await;
    let (app, state, cookie) = overlay_app(&fake, "ok").await;
    let png = "/api/plugins/docomo-lte/overlays/png";
    let (s, _, h) = get_tile(&app, &cookie, &format!("{png}/tiles/12/3632/1635.png")).await;
    assert_eq!(
        (s, &h[header::CONTENT_TYPE]),
        (StatusCode::OK, &"image/png".parse().unwrap())
    );
    let (_, body, _) = get_tile(&app, &cookie, &format!("{png}/tiles/12/3632/1635.png")).await;
    assert_eq!(body, TRANSPARENT_PNG);
    assert_eq!(
        get_tile(&app, &cookie, &format!("{png}/tiles/12/0/0.gif"))
            .await
            .0,
        StatusCode::NOT_FOUND
    );
    let (s, b, _) = call(
        &app,
        req(
            Method::POST,
            &format!("{png}/areas"),
            Some(&cookie),
            Some(area_json("p", NACHI)),
        ),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{b}");
    for _ in 0..200 {
        let (_, b, _) = call(
            &app,
            req(Method::GET, &format!("{png}/areas"), Some(&cookie), None),
        )
        .await;
        if b["data"][0]["status"] != "fetching" {
            assert_eq!(b["data"][0]["status"], "ready", "{b}");
            break;
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    let (z, x, y) = tiles(&NACHI, Z8_14).next().unwrap();
    let src = Source {
        overlay: "png".into(),
        format: TileFormat::Png,
        ..lte_source()
    };
    assert!(std::fs::read(src.tile_path(&state.data_dir, z, x, y))
        .unwrap()
        .starts_with(b"\x89PNG"));
}
