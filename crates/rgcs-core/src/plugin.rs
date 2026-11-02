//! Plugins, stage 1: a `plugin.toml` manifest that declares
//! map overlays and links. No code runs: the manifest is parsed, validated and served as data.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// The manifest format this build understands (`api = 1`).
pub const PLUGIN_API: u32 = 1;
/// A larger `plugin.toml` is refused before parsing.
pub const MAX_MANIFEST_BYTES: usize = 64 * 1024;
pub const MAX_OVERLAYS: usize = 8;
pub const MAX_LINKS: usize = 16;
/// Every localized value (and the author) is at most this many characters.
pub const MAX_TEXT_CHARS: usize = 200;
/// `area` overlays fetch at most this many zoom levels past `min_zoom`.
pub const MAX_AREA_ZOOM_SPAN: u8 = 8;
pub const MAX_ZOOM: u8 = 22;

/// Why a plugin did not load (`PluginInfo.error`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum PluginError {
    Parse,
    BadId,
    IdMismatch,
    ApiVersion,
    BadUrl,
    BadZoom,
    DuplicateOverlay,
    TooLarge,
    TooMany,
    BadValue,
    NoEnText,
}

impl PluginError {
    pub fn code(self) -> &'static str {
        match self {
            Self::Parse => "parse",
            Self::BadId => "bad_id",
            Self::IdMismatch => "id_mismatch",
            Self::ApiVersion => "api_version",
            Self::BadUrl => "bad_url",
            Self::BadZoom => "bad_zoom",
            Self::DuplicateOverlay => "duplicate_overlay",
            Self::TooLarge => "too_large",
            Self::TooMany => "too_many",
            Self::BadValue => "bad_value",
            Self::NoEnText => "no_en_text",
        }
    }
}

/// Text in the UI languages. In the manifest it is either one string (every language) or a
/// table with `en` (required) and optional `ja` / `zh` / `ko`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[ts(export)]
pub struct LocalText {
    pub en: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub ja: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub zh: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub ko: Option<String>,
}

impl LocalText {
    pub fn plain(s: &str) -> Self {
        Self {
            en: s.into(),
            ja: None,
            zh: None,
            ko: None,
        }
    }

    /// The text in `lang`, else English.
    pub fn pick(&self, lang: &str) -> &str {
        let t = match lang {
            "ja" => &self.ja,
            "zh" => &self.zh,
            "ko" => &self.ko,
            _ => &None,
        };
        t.as_deref().unwrap_or(&self.en)
    }

    pub(crate) fn all(&self) -> impl Iterator<Item = &str> {
        std::iter::once(self.en.as_str()).chain(
            [&self.ja, &self.zh, &self.ko]
                .into_iter()
                .flatten()
                .map(String::as_str),
        )
    }
}

#[derive(Deserialize)]
#[serde(untagged)]
enum LocalTextRaw {
    Plain(String),
    Table(LocalTable),
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct LocalTable {
    #[serde(default)]
    en: String,
    ja: Option<String>,
    zh: Option<String>,
    ko: Option<String>,
}

impl<'de> Deserialize<'de> for LocalText {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        Ok(match LocalTextRaw::deserialize(d)? {
            LocalTextRaw::Plain(s) => Self::plain(&s),
            LocalTextRaw::Table(t) => Self {
                en: t.en,
                ja: t.ja,
                zh: t.zh,
                ko: t.ko,
            },
        })
    }
}

/// `area`: fetched ahead for chosen rectangles and served by RGCS. `direct`: the browser loads
/// the tiles from the source.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum OverlayCache {
    Area,
    Direct,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum TileFormat {
    Gif,
    Png,
}

impl TileFormat {
    pub fn ext(self) -> &'static str {
        match self {
            Self::Gif => "gif",
            Self::Png => "png",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
#[ts(export)]
pub struct LegendEntry {
    /// `#rrggbb`.
    pub color: String,
    pub label: LocalText,
}

fn default_opacity() -> u8 {
    60
}

/// One `[[overlay]]` of a manifest.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OverlaySpec {
    pub id: String,
    pub name: LocalText,
    /// URL template with `{z}`, `{x}` and `{y}`.
    pub tiles: String,
    pub cache: OverlayCache,
    pub format: TileFormat,
    pub tile_size: u16,
    pub min_zoom: u8,
    pub max_zoom: u8,
    /// Percent, 10–100.
    #[serde(default = "default_opacity")]
    pub default_opacity: u8,
    pub attribution: Option<LocalText>,
    pub notice: Option<LocalText>,
    #[serde(default)]
    pub legend: Vec<LegendEntry>,
}

/// One `[[link]]` of a manifest.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(deny_unknown_fields)]
#[ts(export)]
pub struct PluginLink {
    pub label: LocalText,
    /// `https` only.
    pub url: String,
}

/// A parsed `plugin.toml`.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Manifest {
    pub id: String,
    pub api: u32,
    pub version: String,
    pub name: LocalText,
    pub description: Option<LocalText>,
    pub author: Option<String>,
    pub homepage: Option<String>,
    #[serde(default, rename = "overlay")]
    pub overlays: Vec<OverlaySpec>,
    #[serde(default, rename = "link")]
    pub links: Vec<PluginLink>,
}

/// Parses a manifest (size first, then strict TOML). Run [`validate`] next.
pub fn parse_manifest(text: &str) -> Result<Manifest, PluginError> {
    if text.len() > MAX_MANIFEST_BYTES {
        return Err(PluginError::TooLarge);
    }
    toml::from_str(text).map_err(|_| PluginError::Parse)
}

/// `^[a-z0-9][a-z0-9-]{0,39}$`: plugin and overlay ids, safe as path parts and layer ids.
pub fn valid_id(id: &str) -> bool {
    let b = id.as_bytes();
    (1..=40).contains(&b.len())
        && b[0] != b'-'
        && b.iter()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == b'-')
}

pub use crate::plugin_info::{OverlayInfo, PluginInfo, PluginStatus};
pub use crate::plugin_validate::validate;

#[cfg(test)]
#[path = "plugin_tests.rs"]
mod tests;
