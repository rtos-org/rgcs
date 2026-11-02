//! `GET /api/plugins` rows: what the UI needs from each plugin.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::plugin::{
    LegendEntry, LocalText, Manifest, OverlayCache, OverlaySpec, PluginError, PluginLink, TileFormat,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum PluginStatus {
    Ok,
    Error,
}

/// An overlay as the UI sees it. `tiles` is sent for `direct` overlays only: `area` tiles come
/// from RGCS (`/api/plugins/{p}/overlays/{o}/tiles/…`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export)]
pub struct OverlayInfo {
    pub id: String,
    pub name: LocalText,
    pub cache: OverlayCache,
    pub format: TileFormat,
    pub tile_size: u16,
    pub min_zoom: u8,
    pub max_zoom: u8,
    pub default_opacity: u8,
    pub attribution: Option<LocalText>,
    pub notice: Option<LocalText>,
    pub legend: Vec<LegendEntry>,
    pub tiles: Option<String>,
}

impl OverlayInfo {
    fn of(o: &OverlaySpec) -> Self {
        Self {
            id: o.id.clone(),
            name: o.name.clone(),
            cache: o.cache,
            format: o.format,
            tile_size: o.tile_size,
            min_zoom: o.min_zoom,
            max_zoom: o.max_zoom,
            default_opacity: o.default_opacity,
            attribution: o.attribution.clone(),
            notice: o.notice.clone(),
            legend: o.legend.clone(),
            tiles: (o.cache == OverlayCache::Direct).then(|| o.tiles.clone()),
        }
    }
}

/// One plugin found in `plugins_dir`, loaded or not.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export)]
pub struct PluginInfo {
    pub id: String,
    pub status: PluginStatus,
    /// The [`PluginError`] code when `status` is `error`.
    pub error: Option<String>,
    pub enabled: bool,
    pub version: String,
    pub name: LocalText,
    pub description: Option<LocalText>,
    pub author: Option<String>,
    pub homepage: Option<String>,
    pub overlays: Vec<OverlayInfo>,
    pub links: Vec<PluginLink>,
}

impl PluginInfo {
    pub fn loaded(m: &Manifest, enabled: bool) -> Self {
        Self {
            id: m.id.clone(),
            status: PluginStatus::Ok,
            error: None,
            enabled,
            version: m.version.clone(),
            name: m.name.clone(),
            description: m.description.clone(),
            author: m.author.clone(),
            homepage: m.homepage.clone(),
            overlays: m.overlays.iter().map(OverlayInfo::of).collect(),
            links: m.links.clone(),
        }
    }

    /// A directory whose manifest did not load: listed by its directory name.
    pub fn broken(dir: &str, e: PluginError, enabled: bool) -> Self {
        Self {
            id: dir.into(),
            status: PluginStatus::Error,
            error: Some(e.code().into()),
            enabled,
            version: String::new(),
            name: LocalText::plain(dir),
            description: None,
            author: None,
            homepage: None,
            overlays: Vec::new(),
            links: Vec::new(),
        }
    }
}
