//! External-factor fetchers: one HTTP client
//! with no redirects, a per-source timeout and a 2 MiB body cap. Only rounded cells ever go into
//! a URL, and URLs are never logged whole (an API key may be a query parameter): a fetch logs
//! the source id, the host and the rounded cell only. Errors are short codes, never the URL,
//! the key or the response body.

use std::time::Duration;

use rgcs_ai::Secret;
use rgcs_env::{parse, Note, Reading, SourceId, Station};
use time::OffsetDateTime;

/// Response bodies above this are refused as `too_large`.
pub const BODY_CAP: usize = 2 * 1024 * 1024;
/// AMeDAS: the nearest station must lie within this distance of the cell.
pub const AMEDAS_MAX_KM: f64 = 30.0;
/// AMeDAS station table cache lifetime.
pub const AMEDAS_TABLE_TTL_MS: u64 = 86_400_000;
const USER_AGENT: &str = concat!("RGCS/", env!("CARGO_PKG_VERSION"));
const OPEN_METEO_QUERY: &str = "current=temperature_2m,precipitation,wind_speed_10m,wind_gusts_10m,\
wind_direction_10m&hourly=wind_speed_80m,wind_speed_120m,precipitation_probability&forecast_hours=3\
&wind_speed_unit=ms&timezone=UTC&models=best_match";

/// Base URL of every source; injectable so tests and the live check use a local fake.
#[derive(Debug, Clone, PartialEq)]
pub struct EnvEndpoints {
    pub open_meteo: String,
    pub open_meteo_customer: String,
    pub jma: String,
    pub swpc: String,
    pub gfz: String,
    pub owm: String,
}

impl EnvEndpoints {
    /// The public hosts.
    pub fn real() -> Self {
        Self {
            open_meteo: "https://api.open-meteo.com".into(),
            open_meteo_customer: "https://customer-api.open-meteo.com".into(),
            jma: "https://www.jma.go.jp".into(),
            swpc: "https://services.swpc.noaa.gov".into(),
            gfz: "https://kp.gfz.de".into(),
            owm: "https://api.openweathermap.org".into(),
        }
    }

    /// Every source on one base URL (tests, the scratch fake env server).
    pub fn all(base: &str) -> Self {
        let b = base.trim_end_matches('/').to_string();
        Self {
            open_meteo: b.clone(),
            open_meteo_customer: format!("{b}/customer"),
            jma: b.clone(),
            swpc: b.clone(),
            gfz: b.clone(),
            owm: b,
        }
    }

    /// The `AppState::new` default: nothing routable, so a hub that main did not configure
    /// can never reach the internet.
    pub fn offline() -> Self {
        Self::all("http://127.0.0.1:0")
    }
}

impl Default for EnvEndpoints {
    /// The public hosts. Panics under `#[cfg(test)]`: tests build endpoints from the fake only.
    fn default() -> Self {
        if cfg!(test) {
            panic!("EnvEndpoints::default() points at real hosts; tests must use the local fake");
        }
        Self::real()
    }
}

/// API keys from config / env only. `Secret` redacts `Debug`.
#[derive(Debug, Clone, Default)]
pub struct EnvKeys {
    pub open_meteo: Option<Secret>,
    pub openweathermap: Option<Secret>,
}

impl EnvKeys {
    /// Reads the variables named in `[env]` through `env` (tests never touch `std::env`).
    pub fn resolve(cfg: &crate::config::EnvConfig, env: &dyn Fn(&str) -> Option<String>) -> Self {
        let read = |name: &str| {
            env(name)
                .map(|k| k.trim().to_string())
                .filter(|k| !k.is_empty())
                .map(Secret::new)
        };
        Self {
            open_meteo: read(&cfg.open_meteo_api_key_env),
            openweathermap: read(&cfg.openweathermap_api_key_env),
        }
    }

    pub fn for_source(&self, id: SourceId) -> Option<&Secret> {
        match id {
            SourceId::OpenMeteo => self.open_meteo.as_ref(),
            SourceId::Openweathermap => self.openweathermap.as_ref(),
            _ => None,
        }
    }
}

/// `"…ab12"`: the last 4 characters of a key of at least 8, else only `"…"`.
pub fn key_hint(key: &Secret) -> String {
    let chars: Vec<char> = key.expose().chars().collect();
    if chars.len() < 8 {
        return "…".into();
    }
    let tail: String = chars[chars.len() - 4..].iter().collect();
    format!("…{tail}")
}

/// A rounded location cell, already formatted with the step's decimals.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Cell {
    pub lat: String,
    pub lon: String,
}

impl Cell {
    pub fn key(&self) -> String {
        format!("{},{}", self.lat, self.lon)
    }

    pub fn coords(&self) -> (f64, f64) {
        (
            self.lat.parse().unwrap_or(f64::NAN),
            self.lon.parse().unwrap_or(f64::NAN),
        )
    }
}

/// What one fetch of a source needs.
pub struct Plan<'a> {
    pub endpoints: &'a EnvEndpoints,
    pub keys: &'a EnvKeys,
    pub timeout: Duration,
    pub now_ms: u64,
    pub cells: &'a [Cell],
    /// The cached AMeDAS station table and when it was fetched.
    pub table: Option<(u64, Vec<Station>)>,
}

/// One successful fetch: readings per cell key (`""` for location-free sources), notes, and
/// the AMeDAS table to cache.
#[derive(Debug, Clone, Default)]
pub struct Fetched {
    pub per_cell: Vec<(String, Vec<Reading>)>,
    pub notes: Vec<Note>,
    pub table: Option<(u64, Vec<Station>)>,
}

pub fn client() -> reqwest::Client {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .user_agent(USER_AGENT)
        .build()
        .expect("static reqwest client")
}

fn send_error(e: &reqwest::Error) -> String {
    let code = if e.is_timeout() {
        "timeout"
    } else if e.is_redirect() {
        "redirect"
    } else {
        "unreachable"
    };
    code.into()
}

/// GET `url` as text under `timeout`, with no redirects and the body cap.
pub async fn get_text(client: &reqwest::Client, url: &str, timeout: Duration) -> Result<String, String> {
    let request = async {
        let mut res = client
            .get(url)
            .timeout(timeout)
            .send()
            .await
            .map_err(|e| send_error(&e))?;
        let status = res.status();
        if status.is_redirection() {
            return Err("redirect".to_string());
        }
        if !status.is_success() {
            return Err(format!("http_{}", status.as_u16()));
        }
        if res.content_length().is_some_and(|n| n > BODY_CAP as u64) {
            return Err("too_large".into());
        }
        let mut body: Vec<u8> = Vec::new();
        while let Some(chunk) = res.chunk().await.map_err(|e| send_error(&e))? {
            if body.len() + chunk.len() > BODY_CAP {
                return Err("too_large".into());
            }
            body.extend_from_slice(&chunk);
        }
        String::from_utf8(body).map_err(|_| "parse".to_string())
    };
    tokio::time::timeout(timeout, request)
        .await
        .unwrap_or_else(|_| Err("timeout".into()))
}

fn host_of(url: &str) -> String {
    url::Url::parse(url)
        .ok()
        .and_then(|u| u.host_str().map(str::to_string))
        .unwrap_or_default()
}

/// The only log line a fetch writes (review focus 4).
fn log_fetch(id: SourceId, url: &str, cell: &str) {
    let host = host_of(url);
    tracing::info!(source = %id.as_str(), host = %host, cell = %cell, "env fetch");
}

fn parsed<T>(r: Result<T, rgcs_env::ParseError>) -> Result<T, String> {
    r.map_err(|_| "parse".to_string())
}

pub fn open_meteo_url(ep: &EnvEndpoints, key: Option<&Secret>, cell: &Cell) -> String {
    let base = if key.is_some() {
        &ep.open_meteo_customer
    } else {
        &ep.open_meteo
    };
    let url = format!(
        "{base}/v1/forecast?latitude={}&longitude={}&{OPEN_METEO_QUERY}",
        cell.lat, cell.lon
    );
    match key {
        Some(k) => format!("{url}&apikey={}", k.expose()),
        None => url,
    }
}

pub fn owm_url(ep: &EnvEndpoints, key: &Secret, cell: &Cell) -> String {
    format!(
        "{}/data/2.5/weather?lat={}&lon={}&appid={}&units=metric",
        ep.owm,
        cell.lat,
        cell.lon,
        key.expose()
    )
}

fn iso_seconds(ms: u64) -> String {
    let t = OffsetDateTime::from_unix_timestamp((ms / 1000) as i64).unwrap_or(OffsetDateTime::UNIX_EPOCH);
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z",
        t.year(),
        u8::from(t.month()),
        t.day(),
        t.hour(),
        t.minute(),
        t.second()
    )
}

pub fn gfz_url(ep: &EnvEndpoints, now_ms: u64) -> String {
    let start = iso_seconds(now_ms.saturating_sub(86_400_000));
    format!(
        "{}/app/json/?start={start}&end={}&index=Kp",
        ep.gfz,
        iso_seconds(now_ms)
    )
}

/// The SWPC product path of a SWPC source.
pub fn swpc_url(ep: &EnvEndpoints, id: SourceId) -> Option<String> {
    let path = match id {
        SourceId::SwpcKp => "products/noaa-planetary-k-index.json",
        SourceId::SwpcKp1m => "json/planetary_k_index_1m.json",
        SourceId::SwpcKpForecast => "products/noaa-planetary-k-index-forecast.json",
        SourceId::SwpcAlerts => "products/alerts.json",
        _ => return None,
    };
    Some(format!("{}/{path}", ep.swpc))
}

/// Fetches and parses one source. `no_key` / `no_location` are decided before any request.
pub async fn fetch_source(client: &reqwest::Client, id: SourceId, plan: Plan<'_>) -> Result<Fetched, String> {
    let get = |url: String, cell: String| async move {
        log_fetch(id, &url, &cell);
        get_text(client, &url, plan.timeout).await
    };
    match id {
        SourceId::OpenMeteo | SourceId::Openweathermap => {
            let key = plan.keys.for_source(id);
            if id == SourceId::Openweathermap && key.is_none() {
                return Err("no_key".into());
            }
            if plan.cells.is_empty() {
                return Err("no_location".into());
            }
            let mut per_cell = Vec::new();
            for cell in plan.cells {
                let readings = match (id, key) {
                    (SourceId::Openweathermap, Some(k)) => {
                        parse::owm(&get(owm_url(plan.endpoints, k, cell), cell.key()).await?)
                    }
                    _ => {
                        parse::open_meteo(&get(open_meteo_url(plan.endpoints, key, cell), cell.key()).await?)
                    }
                };
                per_cell.push((cell.key(), parsed(readings)?));
            }
            Ok(Fetched {
                per_cell,
                ..Fetched::default()
            })
        }
        SourceId::JmaAmedas => crate::env_amedas::fetch(client, plan).await,
        SourceId::GfzKp => {
            let body = get(gfz_url(plan.endpoints, plan.now_ms), String::new()).await?;
            single(parsed(parse::gfz_kp(&body))?)
        }
        SourceId::SwpcAlerts => {
            let url = swpc_url(plan.endpoints, id).unwrap_or_default();
            let notes = parsed(parse::swpc_alerts(&get(url, String::new()).await?))?;
            Ok(Fetched {
                notes,
                ..Fetched::default()
            })
        }
        SourceId::SwpcKp | SourceId::SwpcKp1m | SourceId::SwpcKpForecast => {
            let url = swpc_url(plan.endpoints, id).unwrap_or_default();
            let body = get(url, String::new()).await?;
            let readings = match id {
                SourceId::SwpcKp => parse::swpc_kp(&body),
                SourceId::SwpcKp1m => parse::swpc_kp_1m(&body),
                _ => parse::swpc_kp_forecast(&body, plan.now_ms),
            };
            single(parsed(readings)?)
        }
        SourceId::Vehicle | SourceId::Local => Err("unreachable".into()),
    }
}

fn single(readings: Vec<Reading>) -> Result<Fetched, String> {
    Ok(Fetched {
        per_cell: vec![(String::new(), readings)],
        ..Fetched::default()
    })
}

/// Shared by the AMeDAS fetcher.
pub(crate) async fn get_logged(
    client: &reqwest::Client,
    id: SourceId,
    url: String,
    timeout: Duration,
) -> Result<String, String> {
    log_fetch(id, &url, "");
    get_text(client, &url, timeout).await
}

pub(crate) fn parse_err<T>(r: Result<T, rgcs_env::ParseError>) -> Result<T, String> {
    parsed(r)
}
