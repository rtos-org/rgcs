//! `config.toml`: only what is needed to start. Everything else lives in SQLite.

use std::net::SocketAddr;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

pub const DEFAULT_PATH: &str = "/etc/rgcs/config.toml";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Role {
    Standalone,
    Edge,
    Hub,
}

/// MAVLink log retrieval: `auto` = on for tcp/udp links and serial links at
/// 921600 baud or more, off for slower serial links.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LogFetch {
    Auto,
    On,
    Off,
}

pub const LOG_FETCH_MIN_BAUD: u32 = 921_600;

/// A base map the operator can pick (`[[basemaps]]` in config.toml).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, ts_rs::TS)]
#[serde(deny_unknown_fields)]
#[ts(export)]
pub struct Basemap {
    pub id: String,
    pub label: String,
    /// Raster tile templates (`{z}/{x}/{y}`); several for subdomains.
    pub tiles: Vec<String>,
    pub attribution: String,
    #[serde(default = "default_max_zoom")]
    pub max_zoom: u8,
    /// A transparent label layer drawn over imagery.
    #[serde(default)]
    pub overlay: Option<Vec<String>>,
}

fn default_max_zoom() -> u8 {
    19
}

fn basemap(
    id: &str,
    label: &str,
    tiles: &[&str],
    attribution: &str,
    max_zoom: u8,
    overlay: Option<&[&str]>,
) -> Basemap {
    Basemap {
        id: id.into(),
        label: label.into(),
        tiles: tiles.iter().map(|t| t.to_string()).collect(),
        attribution: attribution.into(),
        max_zoom,
        overlay: overlay.map(|o| o.iter().map(|t| t.to_string()).collect()),
    }
}

/// Terrain-RGB DEM tiles for the 3D map (PLATEAU).
pub const DEFAULT_TERRAIN_TILES: &str =
    "https://api.plateauview.mlit.go.jp/tiles/plateau-terrainrgb/{z}/{x}/{y}.png";

/// The start error for a config that still sets the removed docomo key.
const REMOVED_LTE_TILE_URL: &str = "`lte_tile_url` was removed: tile overlays are plugins now. \
     Delete the key and put the overlay in <plugins_dir>/<id>/plugin.toml (see PLUGINS.md)";

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct Config {
    pub listen: SocketAddr,
    pub mavlink_url: String,
    pub data_dir: PathBuf,
    pub role: Role,
    /// Directory with the built UI (`ui/dist`). `None` serves a placeholder page.
    pub ui_dir: Option<PathBuf>,
    /// Interval of the telemetry diff frames in milliseconds.
    pub telemetry_interval_ms: u64,
    /// Raster tile template for the operations map (`{z}/{x}/{y}`); swap for imagery on site.
    pub map_tile_url: String,
    pub map_attribution: String,
    /// MediaMTX WHEP endpoint the browser offers are relayed to.
    pub whep_upstream: String,
    /// RTSP DESCRIBE probe timeout for the video source monitor.
    pub video_probe_timeout_ms: u64,
    pub log_fetch: LogFetch,
    /// Base maps offered in the map picker; empty → the defaults of [`Config::basemaps`].
    pub basemaps: Vec<Basemap>,
    /// DEM tile template for the 3D map; `""` turns 3D off (offline sites).
    pub terrain_tiles: String,
    /// Optional DEM encoding override; unknown values fall back to URL inference.
    pub terrain_encoding: Option<String>,
    /// Plugin directories (`<id>/plugin.toml`), read at start; `None` → `<data_dir>/plugins`.
    pub plugins_dir: Option<PathBuf>,
    /// AI chat provider; absent → disabled.
    pub ai: rgcs_ai::AiConfig,
    /// External-factor sources (外的要因): key env-var names and base-URL overrides.
    pub env: EnvConfig,
}

/// `[env]`: API keys come only from the environment variables named here (never the file).
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct EnvConfig {
    pub open_meteo_api_key_env: String,
    pub openweathermap_api_key_env: String,
    /// `[env.endpoints]`: base-URL overrides (the live check points these at a local fake).
    pub endpoints: EnvEndpointOverrides,
}

impl Default for EnvConfig {
    fn default() -> Self {
        Self {
            open_meteo_api_key_env: "OPEN_METEO_API_KEY".into(),
            openweathermap_api_key_env: "OWM_API_KEY".into(),
            endpoints: EnvEndpointOverrides::default(),
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct EnvEndpointOverrides {
    pub open_meteo: Option<String>,
    pub open_meteo_customer: Option<String>,
    pub jma: Option<String>,
    pub swpc: Option<String>,
    pub gfz: Option<String>,
    pub owm: Option<String>,
}

impl EnvEndpointOverrides {
    /// `base` with every configured override applied.
    pub fn apply(&self, base: crate::env_fetch::EnvEndpoints) -> crate::env_fetch::EnvEndpoints {
        let pick = |o: &Option<String>, d: String| o.clone().unwrap_or(d);
        crate::env_fetch::EnvEndpoints {
            open_meteo: pick(&self.open_meteo, base.open_meteo),
            open_meteo_customer: pick(&self.open_meteo_customer, base.open_meteo_customer),
            jma: pick(&self.jma, base.jma),
            swpc: pick(&self.swpc, base.swpc),
            gfz: pick(&self.gfz, base.gfz),
            owm: pick(&self.owm, base.owm),
        }
    }
}

impl Default for Config {
    fn default() -> Self {
        Self {
            listen: "0.0.0.0:8000".parse().expect("static address"),
            mavlink_url: "udpin:127.0.0.1:15555".into(),
            data_dir: PathBuf::from("/var/lib/rgcs"),
            role: Role::Standalone,
            ui_dir: None,
            telemetry_interval_ms: 100,
            map_tile_url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png".into(),
            map_attribution: "© OpenStreetMap contributors".into(),
            whep_upstream: "http://127.0.0.1:8889/mt11/whep".into(),
            video_probe_timeout_ms: 2000,
            log_fetch: LogFetch::Auto,
            basemaps: Vec::new(),
            terrain_tiles: DEFAULT_TERRAIN_TILES.into(),
            terrain_encoding: None,
            plugins_dir: None,
            ai: rgcs_ai::AiConfig::default(),
            env: EnvConfig::default(),
        }
    }
}

impl Config {
    pub fn parse(text: &str) -> Result<Self, toml::de::Error> {
        toml::from_str(text).map_err(|e: toml::de::Error| {
            if e.message().contains("`lte_tile_url`") {
                <toml::de::Error as serde::de::Error>::custom(REMOVED_LTE_TILE_URL)
            } else {
                e
            }
        })
    }

    /// Where plugins are read from: `plugins_dir`, else `<data_dir>/plugins`.
    pub fn plugins_dir(&self) -> PathBuf {
        self.plugins_dir
            .clone()
            .unwrap_or_else(|| self.data_dir.join("plugins"))
    }

    /// Whether `LOG_REQUEST_*` retrieval is offered (see [`LogFetch`]).
    pub fn log_fetch_enabled(&self) -> bool {
        match self.log_fetch {
            LogFetch::On => true,
            LogFetch::Off => false,
            LogFetch::Auto => !matches!(
                self.mavlink_url.parse::<rgcs_mavlink::LinkUrl>(),
                Ok(rgcs_mavlink::LinkUrl::Serial { baud, .. }) if baud < LOG_FETCH_MIN_BAUD
            ),
        }
    }

    /// The configured base maps, or: the `map_tile_url` map and the GSI standard / photo tiles.
    /// Commercial imagery (e.g. Esri with CARTO labels) is only an example in
    /// `deploy/config.toml.example`: its terms are the operator's to accept.
    pub fn basemaps(&self) -> Vec<Basemap> {
        if !self.basemaps.is_empty() {
            return self.basemaps.clone();
        }
        vec![
            basemap(
                "map",
                "Map",
                &[self.map_tile_url.as_str()],
                &self.map_attribution,
                19,
                None,
            ),
            basemap(
                "gsi_std",
                "GSI standard",
                &["https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png"],
                "地理院タイル",
                18,
                None,
            ),
            basemap(
                "gsi_photo",
                "GSI photo",
                &["https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg"],
                "地理院タイル",
                18,
                None,
            ),
        ]
    }

    /// The DEM tile template, `None` when 3D is turned off.
    pub fn terrain(&self) -> Option<String> {
        let url = self.terrain_tiles.trim();
        (!url.is_empty()).then(|| url.to_string())
    }

    /// Explicit encoding wins; the built-in PLATEAU URL uses Terrain-RGB, other URLs Terrarium.
    pub fn terrain_encoding(&self) -> &'static str {
        match self.terrain_encoding.as_deref() {
            Some("mapbox") => "mapbox",
            Some("terrarium") => "terrarium",
            _ if self.terrain_tiles.trim() == DEFAULT_TERRAIN_TILES => "mapbox",
            _ => "terrarium",
        }
    }

    /// Missing file → defaults; unreadable or invalid file → error.
    pub fn load(path: &Path) -> anyhow::Result<Self> {
        match std::fs::read_to_string(path) {
            Ok(text) => Ok(Self::parse(&text)?),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Self::default()),
            Err(e) => Err(e.into()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn terrain_tiles_default_and_disable() {
        let c = Config::parse("").unwrap();
        assert_eq!(
            c.terrain().as_deref(),
            Some("https://api.plateauview.mlit.go.jp/tiles/plateau-terrainrgb/{z}/{x}/{y}.png")
        );
        assert_eq!(c.terrain_encoding(), "mapbox");
        let c = Config::parse("terrain_tiles = ''").unwrap();
        assert_eq!(c.terrain(), None);
        assert_eq!(c.terrain_encoding(), "terrarium");
        let c = Config::parse("terrain_tiles = 'https://dem.local/{z}/{x}/{y}.png'").unwrap();
        assert_eq!(c.terrain().as_deref(), Some("https://dem.local/{z}/{x}/{y}.png"));
    }

    #[test]
    fn terrain_encoding_infers_from_the_resolved_url() {
        let aws = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
        let c = Config::parse(&format!("terrain_tiles = '{aws}'")).unwrap();
        assert_eq!(c.terrain().as_deref(), Some(aws));
        assert_eq!(c.terrain_encoding(), "terrarium");
        let c = Config::parse(&format!("terrain_tiles = '  {DEFAULT_TERRAIN_TILES}  '")).unwrap();
        assert_eq!(c.terrain().as_deref(), Some(DEFAULT_TERRAIN_TILES));
        assert_eq!(c.terrain_encoding(), "mapbox");
    }

    #[test]
    fn terrain_encoding_override_and_invalid_fallback() {
        for (text, expected) in [
            (
                "terrain_tiles = 'https://dem.local/{z}/{x}/{y}.png'\nterrain_encoding = 'mapbox'",
                "mapbox",
            ),
            ("terrain_encoding = 'terrarium'", "terrarium"),
            ("terrain_encoding = 'invalid'", "mapbox"),
            (
                "terrain_tiles = 'https://dem.local/{z}/{x}/{y}.png'\nterrain_encoding = 'invalid'",
                "terrarium",
            ),
            ("terrain_tiles = ''\nterrain_encoding = 'mapbox'", "mapbox"),
        ] {
            assert_eq!(
                Config::parse(text).unwrap().terrain_encoding(),
                expected,
                "{text}"
            );
        }
    }

    #[test]
    fn the_old_lte_tile_url_key_names_its_replacement() {
        let e = Config::parse("lte_tile_url = 'http://127.0.0.1:18112/{z}/{x}/{y}.gif'").unwrap_err();
        let msg = e.to_string();
        assert!(
            msg.contains("lte_tile_url") && msg.contains("PLUGINS.md"),
            "{msg}"
        );
    }

    #[test]
    fn plugins_dir_defaults_under_the_data_dir() {
        let c = Config::parse("data_dir = '/srv/rgcs'").unwrap();
        assert_eq!(c.plugins_dir(), Path::new("/srv/rgcs/plugins"));
        let c = Config::parse("data_dir = '/srv/rgcs'\nplugins_dir = '/etc/rgcs/plugins'").unwrap();
        assert_eq!(c.plugins_dir(), Path::new("/etc/rgcs/plugins"));
    }

    #[test]
    fn empty_file_gives_defaults() {
        assert_eq!(Config::parse("").unwrap(), Config::default());
    }

    #[test]
    fn fields_override_defaults() {
        let c = Config::parse(
            r#"
            listen = "127.0.0.1:9000"
            mavlink_url = "/dev/ttyACM0,115200"
            role = "edge"
            ui_dir = "/opt/rgcs/ui"
            "#,
        )
        .unwrap();
        assert_eq!(c.listen.port(), 9000);
        assert_eq!(c.mavlink_url, "/dev/ttyACM0,115200");
        assert_eq!(c.role, Role::Edge);
        assert_eq!(c.ui_dir.as_deref(), Some(Path::new("/opt/rgcs/ui")));
        assert_eq!(c.telemetry_interval_ms, 100);
    }

    #[test]
    fn map_tiles_default_to_osm_and_can_be_overridden() {
        let d = Config::default();
        assert_eq!(d.map_tile_url, "https://tile.openstreetmap.org/{z}/{x}/{y}.png");
        assert_eq!(d.map_attribution, "© OpenStreetMap contributors");
        let c = Config::parse(
            "map_tile_url = 'https://tiles.example/{z}/{x}/{y}.jpg'\nmap_attribution = 'Example'",
        )
        .unwrap();
        assert_eq!(c.map_tile_url, "https://tiles.example/{z}/{x}/{y}.jpg");
        assert_eq!(c.map_attribution, "Example");
    }

    #[test]
    fn video_defaults() {
        let d = Config::default();
        assert_eq!(d.whep_upstream, "http://127.0.0.1:8889/mt11/whep");
        assert_eq!(d.video_probe_timeout_ms, 2000);
        let c = Config::parse("whep_upstream = 'http://10.0.0.2:8889/cam/whep'").unwrap();
        assert_eq!(c.whep_upstream, "http://10.0.0.2:8889/cam/whep");
    }

    #[test]
    fn the_ai_section_is_optional_and_parsed() {
        assert_eq!(Config::default().ai.provider, rgcs_ai::ProviderKind::None);
        let c = Config::parse(
            "[ai]\nprovider = 'openai_compat'\nbase_url = 'http://127.0.0.1:18110/v1'\nmodel = 'fake'",
        )
        .unwrap();
        assert_eq!(c.ai.provider, rgcs_ai::ProviderKind::OpenaiCompat);
        assert_eq!(c.ai.model.as_deref(), Some("fake"));
        assert!(Config::parse("[ai]\nprovidr = 'none'").is_err());
    }

    #[test]
    fn the_env_section_names_key_variables_and_overrides_endpoints() {
        let d = Config::default().env;
        assert_eq!(d.openweathermap_api_key_env, "OWM_API_KEY");
        assert_eq!(d.open_meteo_api_key_env, "OPEN_METEO_API_KEY");
        let c = Config::parse(
            "[env]\nopenweathermap_api_key_env = 'MY_OWM'\n[env.endpoints]\nswpc = 'http://127.0.0.1:18111'",
        )
        .unwrap();
        assert_eq!(c.env.openweathermap_api_key_env, "MY_OWM");
        let ep = c
            .env
            .endpoints
            .apply(crate::env_fetch::EnvEndpoints::all("http://fake.local"));
        assert_eq!(ep.swpc, "http://127.0.0.1:18111");
        assert_eq!(ep.jma, "http://fake.local");
        assert!(Config::parse("[env]\nopenweathermap_api_key = 'k'").is_err());
    }

    #[test]
    fn unknown_keys_are_rejected() {
        assert!(Config::parse("mavlink = 'x'").is_err());
    }

    #[test]
    fn missing_file_is_fine() {
        assert_eq!(
            Config::load(Path::new("/nonexistent/rgcs.toml")).unwrap(),
            Config::default()
        );
    }

    #[test]
    fn log_fetch_auto_follows_the_link_speed() {
        let tcp = Config::parse("mavlink_url = 'tcp:127.0.0.1:5760'").unwrap();
        assert_eq!(tcp.log_fetch, LogFetch::Auto);
        assert!(tcp.log_fetch_enabled());
        assert!(!Config::parse("mavlink_url = '/dev/ttyAMA0,57600'")
            .unwrap()
            .log_fetch_enabled());
        assert!(Config::parse("mavlink_url = '/dev/ttyAMA0,921600'")
            .unwrap()
            .log_fetch_enabled());
        assert!(
            !Config::parse("mavlink_url = 'tcp:127.0.0.1:5760'\nlog_fetch = 'off'")
                .unwrap()
                .log_fetch_enabled()
        );
        assert!(
            Config::parse("mavlink_url = '/dev/ttyAMA0,57600'\nlog_fetch = 'on'")
                .unwrap()
                .log_fetch_enabled()
        );
    }

    #[test]
    fn default_basemaps_start_with_the_configured_map() {
        let c = Config::parse(r#"map_tile_url = "https://tiles.local/{z}/{x}/{y}.png""#).unwrap();
        let ids: Vec<_> = c.basemaps().iter().map(|b| b.id.clone()).collect();
        assert_eq!(ids, vec!["map", "gsi_std", "gsi_photo"]);
        assert_eq!(
            c.basemaps()[0].tiles,
            vec!["https://tiles.local/{z}/{x}/{y}.png".to_string()]
        );
        // no commercial imagery by default: it needs the operator's own terms (config example)
        let all: String = c.basemaps().iter().flat_map(|b| b.tiles.clone()).collect();
        assert!(
            !all.contains("arcgisonline") && !all.contains("cartocdn"),
            "{all}"
        );
        assert!(c.basemaps().iter().all(|b| b.overlay.is_none()));
        // English labels: the UI shows its own translation for these ids
        let labels: Vec<_> = c.basemaps().iter().map(|b| b.label.clone()).collect();
        assert_eq!(labels, vec!["Map", "GSI standard", "GSI photo"]);
    }

    #[test]
    fn the_example_file_parses_and_its_basemaps_example_too() {
        let text = include_str!("../../../deploy/config.toml.example");
        Config::parse(text).expect("the example as shipped");
        // the commented [[basemaps]] block, uncommented
        let block: String = text
            .lines()
            .skip_while(|l| !l.starts_with("# [[basemaps]]"))
            .take_while(|l| l.starts_with('#'))
            .map(|l| format!("{}\n", l.trim_start_matches('#').trim_start()))
            .collect();
        let c = Config::parse(&block).expect("the uncommented basemaps example");
        let ids: Vec<_> = c.basemaps().iter().map(|b| b.id.clone()).collect();
        assert_eq!(ids, vec!["map", "satellite", "gsi_photo"]);
        assert_eq!(c.basemaps()[1].overlay.as_ref().map(Vec::len), Some(2));
    }

    /// Every commented setting in the example is a real key and sits where uncommenting it keeps
    /// the file valid (top-level keys before the first table). The alternative AI provider at
    /// the end repeats keys, so it stops there.
    #[test]
    fn the_example_file_is_valid_with_every_setting_uncommented() {
        let text = include_str!("../../../deploy/config.toml.example");
        let mut out = String::new();
        for line in text.lines().take_while(|l| !l.starts_with("# A local")) {
            let body = line.strip_prefix("# ").unwrap_or(line);
            let setting = body.starts_with('[')
                || body.split_once(" = ").is_some_and(|(k, _)| {
                    !k.is_empty() && k.chars().all(|c| c.is_ascii_lowercase() || c == '_')
                });
            out.push_str(if setting { body } else { line });
            out.push('\n');
        }
        let c = Config::parse(&out).unwrap_or_else(|e| panic!("{e}\n{out}"));
        assert_eq!(c.basemaps().len(), 3);
        assert_eq!(c.plugins_dir(), Path::new("/var/lib/rgcs/plugins"));
        assert_eq!(c.telemetry_interval_ms, 100);
    }

    #[test]
    fn config_basemaps_replace_the_defaults() {
        let c = Config::parse(
            r#"
            [[basemaps]]
            id = "local"
            label = "現場オルソ"
            tiles = ["http://127.0.0.1:8080/ortho/{z}/{x}/{y}.jpg"]
            attribution = "site survey"
            max_zoom = 21
            "#,
        )
        .unwrap();
        let b = c.basemaps();
        assert_eq!(b.len(), 1);
        assert_eq!(
            (b[0].id.as_str(), b[0].max_zoom, b[0].overlay.is_none()),
            ("local", 21, true)
        );
    }
}
