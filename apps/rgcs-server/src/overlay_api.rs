//! `/api/plugins/{p}/overlays/{o}/…`: the areas of a plugin's `area` overlay and its cached
//! tiles. An unknown, disabled or `direct` overlay is
//! 404 on every route here.

use axum::extract::{Path, State};
use axum::http::{header, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use rgcs_core::{OverlayArea, OverlayCache, TileEstimate};
use rgcs_store::StoreError;
use serde::Deserialize;

use crate::api::{err, ok};
use crate::app::AppState;
use crate::auth::AuthUser;
use crate::overlay_fetch::{prune_tiles, spawn_area};
use crate::overlay_tiles::{blank, count, in_range, parse_tile_name, Rect, Source, OVERLAY_MAX_TILES};

/// Longest area name, in characters.
pub const AREA_NAME_MAX: usize = 60;

#[derive(Debug, Deserialize)]
pub struct AreaBody {
    pub name: String,
    #[serde(flatten)]
    pub rect: Rect,
}

fn store_error(e: StoreError) -> Response {
    err(StatusCode::INTERNAL_SERVER_ERROR, "store", e.to_string())
}

fn not_found(what: String) -> Response {
    err(StatusCode::NOT_FOUND, "not_found", what)
}

fn busy() -> Response {
    err(StatusCode::CONFLICT, "busy", "the area is being fetched")
}

fn rect_of(a: &OverlayArea) -> Rect {
    Rect {
        south: a.south,
        west: a.west,
        north: a.north,
        east: a.east,
    }
}

fn bad_rect() -> Response {
    err(
        StatusCode::BAD_REQUEST,
        "bad_rect",
        "need -85 < south < north < 85 and -180 <= west < east <= 180",
    )
}

/// The `area` overlay `plugin/overlay` of a loaded, enabled plugin.
fn source(app: &AppState, plugin: &str, overlay: &str) -> Result<Source, Box<Response>> {
    match app.plugins.overlay(plugin, overlay) {
        Some(o) if o.cache == OverlayCache::Area => Ok(Source::of(plugin, &o)),
        _ => Err(Box::new(not_found(format!("no area overlay {plugin}/{overlay}")))),
    }
}

/// The area `id` when it belongs to `src`.
async fn area_of(app: &AppState, src: &Source, id: i64) -> Result<OverlayArea, Box<Response>> {
    match app.store.get_overlay_area(id).await {
        Ok(Some(a)) if a.plugin_id == src.plugin && a.overlay_id == src.overlay => Ok(a),
        Ok(_) => Err(Box::new(not_found(format!("area {id} does not exist")))),
        Err(e) => Err(Box::new(store_error(e))),
    }
}

/// The tile count of a valid rectangle within the limit, else the 400 to answer.
fn checked_count(src: &Source, r: &Rect) -> Result<u64, Box<Response>> {
    if !r.is_valid() {
        return Err(Box::new(bad_rect()));
    }
    let tiles = count(r, src.zooms());
    if tiles > OVERLAY_MAX_TILES {
        return Err(Box::new(err(
            StatusCode::BAD_REQUEST,
            "too_many_tiles",
            format!("{tiles} tiles; at most {OVERLAY_MAX_TILES}"),
        )));
    }
    Ok(tiles)
}

/// Claims the area and starts its background fetch; answers the row as it now stands.
async fn start_fetch(app: &AppState, src: Source, area: &OverlayArea) -> Response {
    let rect = rect_of(area);
    match app
        .store
        .begin_area_fetch(area.id, count(&rect, src.zooms()))
        .await
    {
        Ok(true) => {}
        Ok(false) => return busy(),
        Err(e) => return store_error(e),
    }
    spawn_area(
        app.overlay_fetcher.clone(),
        app.store.clone(),
        app.data_dir.clone(),
        area.id,
        src,
        rect,
    );
    match app.store.get_overlay_area(area.id).await {
        Ok(Some(row)) => ok(row),
        Ok(None) => not_found(format!("area {} does not exist", area.id)),
        Err(e) => store_error(e),
    }
}

type OverlayPath = Path<(String, String)>;
type AreaPath = Path<(String, String, i64)>;

/// `GET …/areas` → `OverlayArea[]`, oldest first.
pub async fn list(State(app): State<AppState>, _u: AuthUser, Path((p, o)): OverlayPath) -> Response {
    let src = match source(&app, &p, &o) {
        Ok(s) => s,
        Err(res) => return *res,
    };
    match app.store.list_overlay_areas(&src.plugin, &src.overlay).await {
        Ok(rows) => ok(rows),
        Err(e) => store_error(e),
    }
}

/// `POST …/areas/estimate` `{south, west, north, east}` → `{tiles}`. Only the rectangle is
/// checked: the UI compares the count with the limit itself.
pub async fn estimate(
    State(app): State<AppState>,
    _u: AuthUser,
    Path((p, o)): OverlayPath,
    Json(r): Json<Rect>,
) -> Response {
    let src = match source(&app, &p, &o) {
        Ok(s) => s,
        Err(res) => return *res,
    };
    if !r.is_valid() {
        return bad_rect();
    }
    ok(TileEstimate {
        tiles: count(&r, src.zooms()),
    })
}

/// `POST …/areas` `{name, south, west, north, east}` → the new area, fetching.
pub async fn create(
    State(app): State<AppState>,
    _u: AuthUser,
    Path((p, o)): OverlayPath,
    Json(body): Json<AreaBody>,
) -> Response {
    let src = match source(&app, &p, &o) {
        Ok(s) => s,
        Err(res) => return *res,
    };
    let name = body.name.trim();
    if name.is_empty() || name.chars().count() > AREA_NAME_MAX {
        return err(
            StatusCode::BAD_REQUEST,
            "bad_name",
            "name must be 1–60 characters",
        );
    }
    let tiles = match checked_count(&src, &body.rect) {
        Ok(n) => n,
        Err(res) => return *res,
    };
    let r = body.rect;
    let created = app
        .store
        .create_overlay_area(
            (&src.plugin, &src.overlay),
            name,
            (r.south, r.west, r.north, r.east),
            tiles,
        )
        .await;
    match created {
        Ok(area) => start_fetch(&app, src, &area).await,
        Err(e) => store_error(e),
    }
}

/// `POST …/areas/{id}/refresh` → the area, fetching again (409 `busy` while fetching).
pub async fn refresh(State(app): State<AppState>, _u: AuthUser, Path((p, o, id)): AreaPath) -> Response {
    let src = match source(&app, &p, &o) {
        Ok(s) => s,
        Err(res) => return *res,
    };
    match area_of(&app, &src, id).await {
        Ok(area) => start_fetch(&app, src, &area).await,
        Err(res) => *res,
    }
}

/// `DELETE …/areas/{id}` → 204; removes the tiles no other area of the overlay covers.
pub async fn delete(State(app): State<AppState>, _u: AuthUser, Path((p, o, id)): AreaPath) -> Response {
    let src = match source(&app, &p, &o) {
        Ok(s) => s,
        Err(res) => return *res,
    };
    let area = match area_of(&app, &src, id).await {
        Ok(a) => a,
        Err(res) => return *res,
    };
    match app.store.delete_overlay_area(id).await {
        Ok(true) => {}
        Ok(false) => return busy(),
        Err(e) => return store_error(e),
    }
    let others: Vec<Rect> = match app.store.list_overlay_areas(&src.plugin, &src.overlay).await {
        Ok(rows) => rows.iter().map(rect_of).collect(),
        Err(e) => return store_error(e),
    };
    prune_tiles(&app.data_dir, &src, rect_of(&area), &others).await;
    StatusCode::NO_CONTENT.into_response()
}

fn image(body: Vec<u8>, content_type: &'static str, cache: &'static str) -> Response {
    (
        [
            (header::CONTENT_TYPE, content_type),
            (header::CACHE_CONTROL, cache),
        ],
        body,
    )
        .into_response()
}

/// `GET …/tiles/{z}/{x}/{y}.<format>` → the cached tile, or a transparent tile of the overlay's
/// format when there is none (never an error, so the map stays quiet). Out-of-range addresses
/// and a wrong extension are 404.
pub async fn tile(
    State(app): State<AppState>,
    _u: AuthUser,
    Path((p, o, z, x, name)): Path<(String, String, String, String, String)>,
) -> Response {
    let Ok(src) = source(&app, &p, &o) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    let parsed = (
        z.parse::<u8>(),
        x.parse::<u32>(),
        parse_tile_name(&name, src.format.ext()),
    );
    let (Ok(z), Ok(x), Some(y)) = parsed else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if !in_range(z, x, y) {
        return StatusCode::NOT_FOUND.into_response();
    }
    let (empty, content_type) = blank(src.format);
    match tokio::fs::read(src.tile_path(&app.data_dir, z, x, y)).await {
        Ok(bytes) => image(bytes, content_type, "private, max-age=3600"),
        // Not cached yet: a later fetch may add it, so the blank is not kept.
        Err(_) => image(empty.to_vec(), content_type, "private, no-cache"),
    }
}
