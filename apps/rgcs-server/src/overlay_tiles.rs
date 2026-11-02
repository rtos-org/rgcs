//! Plugin overlay tiles: tile math over an overlay's zoom
//! range, GIF / PNG validation, cache paths and the transparent fallback tiles. Pure.

use std::ops::RangeInclusive;
use std::path::{Path, PathBuf};

use rgcs_core::{OverlaySpec, TileFormat};
use serde::Deserialize;

/// Larger requests are refused (`too_many_tiles`) before anything is fetched.
pub const OVERLAY_MAX_TILES: u64 = 3000;
/// The tile route answers 404 above this zoom.
pub const TILE_ROUTE_MAX_ZOOM: u8 = 22;

/// A 1×1 transparent GIF: the answer for a GIF tile that is not cached.
pub const TRANSPARENT_GIF: &[u8] = &[
    0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00, 0x80, 0x00, 0x00, 0x00, 0x00, 0x00, 0xff,
    0xff, 0xff, 0x21, 0xf9, 0x04, 0x01, 0x00, 0x00, 0x00, 0x00, 0x2c, 0x00, 0x00, 0x00, 0x00, 0x01, 0x00,
    0x01, 0x00, 0x00, 0x02, 0x02, 0x44, 0x01, 0x00, 0x3b,
];

/// A 1×1 transparent RGBA PNG: the answer for a PNG tile that is not cached.
pub const TRANSPARENT_PNG: &[u8] = &[
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00,
    0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00,
    0x00, 0x00, 0x0a, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01,
    0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
];

const PNG_SIGNATURE: &[u8] = b"\x89PNG\r\n\x1a\n";

/// One `area` overlay as the fetcher and the routes need it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Source {
    pub plugin: String,
    pub overlay: String,
    pub template: String,
    pub format: TileFormat,
    pub tile_size: u16,
    pub min_zoom: u8,
    pub max_zoom: u8,
}

impl Source {
    pub fn of(plugin: &str, o: &OverlaySpec) -> Self {
        Self {
            plugin: plugin.to_string(),
            overlay: o.id.clone(),
            template: o.tiles.clone(),
            format: o.format,
            tile_size: o.tile_size,
            min_zoom: o.min_zoom,
            max_zoom: o.max_zoom,
        }
    }

    pub fn zooms(&self) -> RangeInclusive<u8> {
        self.min_zoom..=self.max_zoom
    }

    /// `<data_dir>/overlays/<plugin>/<overlay>` (both ids passed the id rule).
    pub fn dir(&self, data_dir: &Path) -> PathBuf {
        data_dir.join("overlays").join(&self.plugin).join(&self.overlay)
    }

    /// `<dir>/{z}/{x}/{y}.<format>`.
    pub fn tile_path(&self, data_dir: &Path, z: u8, x: u32, y: u32) -> PathBuf {
        self.dir(data_dir)
            .join(z.to_string())
            .join(x.to_string())
            .join(format!("{y}.{}", self.format.ext()))
    }
}

/// A rectangle in degrees.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
pub struct Rect {
    pub south: f64,
    pub west: f64,
    pub north: f64,
    pub east: f64,
}

impl Rect {
    /// `-85 < south < north < 85`, `-180 <= west < east <= 180` (NaN fails every comparison).
    pub fn is_valid(&self) -> bool {
        -85.0 < self.south
            && self.south < self.north
            && self.north < 85.0
            && -180.0 <= self.west
            && self.west < self.east
            && self.east <= 180.0
    }
}

/// The inclusive tile ranges of a rectangle at one zoom.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct TileRange {
    pub z: u8,
    pub x0: u32,
    pub x1: u32,
    pub y0: u32,
    pub y1: u32,
}

impl TileRange {
    pub fn tile_count(&self) -> u64 {
        u64::from(self.x1 - self.x0 + 1) * u64::from(self.y1 - self.y0 + 1)
    }

    pub fn contains(&self, x: u32, y: u32) -> bool {
        (self.x0..=self.x1).contains(&x) && (self.y0..=self.y1).contains(&y)
    }
}

fn clamp_tile(v: f64, z: u8) -> u32 {
    let max = (1u64 << z) - 1;
    (v.floor().max(0.0) as u64).min(max) as u32
}

fn lon_to_x(lon: f64, z: u8) -> u32 {
    clamp_tile((lon + 180.0) / 360.0 * (1u64 << z) as f64, z)
}

fn lat_to_y(lat: f64, z: u8) -> u32 {
    let r = lat.to_radians();
    let y = (1.0 - (r.tan() + 1.0 / r.cos()).ln() / std::f64::consts::PI) / 2.0;
    clamp_tile(y * (1u64 << z) as f64, z)
}

/// Every tile at zoom `z` that intersects `r` (north is the smaller y).
pub fn range(r: &Rect, z: u8) -> TileRange {
    TileRange {
        z,
        x0: lon_to_x(r.west, z),
        x1: lon_to_x(r.east, z),
        y0: lat_to_y(r.north, z),
        y1: lat_to_y(r.south, z),
    }
}

/// Tiles needed for `r` over `zooms`.
pub fn count(r: &Rect, zooms: RangeInclusive<u8>) -> u64 {
    zooms.map(|z| range(r, z).tile_count()).sum()
}

/// Every `(z, x, y)` of `r` over `zooms`, zoom ascending.
pub fn tiles(r: &Rect, zooms: RangeInclusive<u8>) -> impl Iterator<Item = (u8, u32, u32)> {
    let r = *r;
    zooms
        .map(move |z| range(&r, z))
        .flat_map(|t| (t.x0..=t.x1).flat_map(move |x| (t.y0..=t.y1).map(move |y| (t.z, x, y))))
}

/// Whether fetching `r` over `zooms` would include the tile.
pub fn covers(r: &Rect, zooms: &RangeInclusive<u8>, z: u8, x: u32, y: u32) -> bool {
    zooms.contains(&z) && range(r, z).contains(x, y)
}

/// A well-formed tile address the route serves (anything else is 404).
pub fn in_range(z: u8, x: u32, y: u32) -> bool {
    z <= TILE_ROUTE_MAX_ZOOM && u64::from(x) < (1u64 << z) && u64::from(y) < (1u64 << z)
}

/// Accepts a tile of `format` and `px`×`px` served with the matching image type. Codes:
/// `html`, `not_gif` / `not_png`, `bad_size`.
pub fn check_tile(
    format: TileFormat,
    px: u16,
    content_type: Option<&str>,
    body: &[u8],
) -> Result<(), &'static str> {
    let ct = content_type.unwrap_or("").trim().to_ascii_lowercase();
    if ct.starts_with("text/html") || body.first() == Some(&b'<') {
        return Err("html");
    }
    let size = match format {
        TileFormat::Gif => gif_size(&ct, body).ok_or("not_gif")?,
        TileFormat::Png => png_size(&ct, body).ok_or("not_png")?,
    };
    if size != (u32::from(px), u32::from(px)) {
        return Err("bad_size");
    }
    Ok(())
}

fn gif_size(ct: &str, body: &[u8]) -> Option<(u32, u32)> {
    let magic = body.get(..6)?;
    if !ct.starts_with("image/gif") || !(magic == b"GIF87a" || magic == b"GIF89a") {
        return None;
    }
    let le = |b: &[u8]| u32::from(u16::from_le_bytes([b[0], b[1]]));
    Some((le(body.get(6..8)?), le(body.get(8..10)?)))
}

/// The IHDR width and height, which a PNG must carry first.
fn png_size(ct: &str, body: &[u8]) -> Option<(u32, u32)> {
    if !ct.starts_with("image/png") || !body.starts_with(PNG_SIGNATURE) || body.get(12..16)? != b"IHDR" {
        return None;
    }
    let be = |b: &[u8]| u32::from_be_bytes([b[0], b[1], b[2], b[3]]);
    Some((be(body.get(16..20)?), be(body.get(20..24)?)))
}

/// The transparent tile and media type of `format`.
pub fn blank(format: TileFormat) -> (&'static [u8], &'static str) {
    match format {
        TileFormat::Gif => (TRANSPARENT_GIF, "image/gif"),
        TileFormat::Png => (TRANSPARENT_PNG, "image/png"),
    }
}

/// The template with `{z}`, `{x}` and `{y}` filled in (each may repeat).
pub fn tile_url(template: &str, z: u8, x: u32, y: u32) -> String {
    template
        .replace("{z}", &z.to_string())
        .replace("{x}", &x.to_string())
        .replace("{y}", &y.to_string())
}

/// `"205.gif"` with `ext = "gif"` → 205; anything else → `None`.
pub fn parse_tile_name(name: &str, ext: &str) -> Option<u32> {
    let digits = name.strip_suffix(ext)?.strip_suffix('.')?;
    if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    digits.parse().ok()
}

#[cfg(test)]
#[path = "overlay_tiles_tests.rs"]
mod tests;
