//! `EnvHub` against a local axum fake on `127.0.0.1:0` only (no real internet): request
//! shapes, rounding, consent gating, failure codes, partial-failure fusion, the guard context,
//! the settings API and key redaction. Endpoints are built only from the fake's URL.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;

use axum::body::Body;
use axum::extract::State;
use axum::http::{header, Method, Request, StatusCode, Uri};
use axum::response::{IntoResponse, Response};
use http_body_util::BodyExt;
use mavlink::dialects::ardupilotmega::{
    GpsFixType, MavAutopilot, MavMessage, MavModeFlag, MavState, MavType, GLOBAL_POSITION_INT_DATA,
    GPS_RAW_INT_DATA, HEARTBEAT_DATA,
};
use mavlink::MavHeader;
use rgcs_ai::Secret;
use rgcs_core::{GuardConsent, GuardSettings, ServerMessage};
use rgcs_env::SourceId;
use rgcs_guard::{ExtLevel, ExternalContext};
use rgcs_mavlink::{Clock, Router};
use rgcs_store::Store;
use serde_json::{json, Value};
use tokio::sync::{broadcast, mpsc, Mutex};
use tower::ServiceExt;

use super::*;
use crate::app::AppState;
use crate::env_fetch::{EnvEndpoints, EnvKeys};
use crate::guard_hub::GuardHub;

/// 2026-10-25T03:45:00Z: the Kp fixtures (03:00 observed, 03:41 nowcast) are fresh.
const T0: u64 = 1_792_899_900_000;
const RAW: (f64, f64) = (36.2509, 137.6385);
const OWM_KEY: &str = "owm-test-9f3a";

macro_rules! fixture {
    ($name:literal) => {
        include_str!(concat!("../../../crates/rgcs-env/tests/fixtures/", $name))
    };
}

#[derive(Clone)]
struct Reply {
    status: u16,
    body: Arc<Vec<u8>>,
    delay_ms: u64,
}

fn reply(status: u16, body: &str) -> Reply {
    Reply {
        status,
        body: Arc::new(body.as_bytes().to_vec()),
        delay_ms: 0,
    }
}

#[derive(Clone, Default)]
struct Fake {
    replies: Arc<StdMutex<HashMap<String, Reply>>>,
    seen: Arc<StdMutex<Vec<String>>>,
}

impl Fake {
    fn on(&self, path: &str, r: Reply) {
        self.replies.lock().unwrap().insert(path.to_string(), r);
    }

    fn seen(&self) -> Vec<String> {
        self.seen.lock().unwrap().clone()
    }

    fn clear(&self) {
        self.seen.lock().unwrap().clear();
    }
}

async fn serve(State(f): State<Fake>, uri: Uri) -> Response {
    f.seen.lock().unwrap().push(uri.to_string());
    let found = f.replies.lock().unwrap().get(uri.path()).cloned();
    let Some(r) = found else {
        return StatusCode::NOT_FOUND.into_response();
    };
    if r.delay_ms > 0 {
        tokio::time::sleep(Duration::from_millis(r.delay_ms)).await;
    }
    let mut res = Response::new(Body::from(r.body.as_ref().clone()));
    *res.status_mut() = StatusCode::from_u16(r.status).unwrap();
    if r.status == 302 {
        res.headers_mut()
            .insert(header::LOCATION, "/elsewhere".parse().unwrap());
    }
    res
}

/// The fake's base URL; every route answers from `Fake.replies` by path.
async fn start_fake() -> (String, Fake) {
    let fake = Fake::default();
    let app = axum::Router::new().fallback(serve).with_state(fake.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (base, fake)
}

fn standard_replies(fake: &Fake) {
    fake.on("/v1/forecast", reply(200, fixture!("open_meteo.json")));
    fake.on("/customer/v1/forecast", reply(200, fixture!("open_meteo.json")));
    fake.on(
        "/bosai/amedas/data/latest_time.txt",
        reply(200, fixture!("amedas_latest_time.txt")),
    );
    fake.on(
        "/bosai/amedas/const/amedastable.json",
        reply(200, fixture!("amedas_table.json")),
    );
    fake.on(
        "/bosai/amedas/data/map/20261025121000.json",
        reply(200, fixture!("amedas_map.json")),
    );
    fake.on(
        "/products/noaa-planetary-k-index.json",
        reply(200, fixture!("swpc_kp_rows.json")),
    );
    fake.on(
        "/json/planetary_k_index_1m.json",
        reply(200, fixture!("swpc_kp_1m.json")),
    );
    fake.on(
        "/products/noaa-planetary-k-index-forecast.json",
        reply(200, fixture!("swpc_kp_forecast.json")),
    );
    fake.on("/products/alerts.json", reply(200, fixture!("swpc_alerts.json")));
    fake.on("/app/json/", reply(200, fixture!("gfz_kp.json")));
    fake.on("/data/2.5/weather", reply(200, fixture!("owm.json")));
}

struct Rig {
    app: AppState,
    http: axum::Router,
    fake: Fake,
    ws: broadcast::Receiver<ServerMessage>,
    _queue: mpsc::Receiver<rgcs_mavlink::QueuedCommand>,
    clock: Arc<AtomicU64>,
}

impl Rig {
    async fn new() -> Self {
        Self::with(EnvKeys::default(), None).await
    }

    /// `base` overrides the fake's URL (a closed port for `unreachable`).
    async fn with(keys: EnvKeys, base: Option<String>) -> Self {
        let (fake_base, fake) = start_fake().await;
        standard_replies(&fake);
        let store = Store::open_memory().await.unwrap();
        let router = Arc::new(Mutex::new(Router::default()));
        let (tx, ws) = broadcast::channel(4096);
        let (queue_tx, queue) = mpsc::channel(8);
        let clock = Arc::new(AtomicU64::new(T0));
        let c = clock.clone();
        let clock_fn: Arc<dyn Fn() -> u64 + Send + Sync> = Arc::new(move || c.load(Ordering::SeqCst));
        let guard = GuardHub::new(tx.clone()).with_clock(clock_fn.clone());
        let endpoints = EnvEndpoints::all(&base.unwrap_or(fake_base));
        let env = EnvHub::new(endpoints, keys, tx.clone(), guard.clone()).with_clock(clock_fn);
        let app = AppState::new(router, tx, store, queue_tx, true)
            .with_guard(guard)
            .with_env(env);
        app.env.attach(&app);
        let http = crate::app::build(app.clone(), None);
        Self {
            app,
            http,
            fake,
            ws,
            _queue: queue,
            clock,
        }
    }

    fn env(&self) -> &EnvHub {
        &self.app.env
    }

    /// Guard on with consent 1 and `external_data`.
    fn consent(&self, enabled: bool, external_data: bool) {
        self.app.guard.apply_settings(GuardSettings {
            enabled,
            consent: GuardConsent {
                monitoring: enabled,
                external_data,
                ..GuardConsent::default()
            },
            ..GuardSettings::default()
        });
    }

    async fn vehicle_at(&self, lat: f64, lon: f64) {
        let header = MavHeader {
            system_id: 1,
            component_id: 1,
            sequence: 0,
        };
        let hb = HEARTBEAT_DATA {
            custom_mode: 5,
            mavtype: MavType::MAV_TYPE_QUADROTOR,
            autopilot: MavAutopilot::MAV_AUTOPILOT_ARDUPILOTMEGA,
            base_mode: MavModeFlag::MAV_MODE_FLAG_CUSTOM_MODE_ENABLED,
            system_status: MavState::MAV_STATE_ACTIVE,
            mavlink_version: 3,
        };
        let pos = GLOBAL_POSITION_INT_DATA {
            lat: (lat * 1e7).round() as i32,
            lon: (lon * 1e7).round() as i32,
            ..GLOBAL_POSITION_INT_DATA::DEFAULT
        };
        let gps = GPS_RAW_INT_DATA {
            fix_type: GpsFixType::GPS_FIX_TYPE_3D_FIX,
            satellites_visible: 12,
            ..GPS_RAW_INT_DATA::DEFAULT
        };
        let mut router = self.app.router.lock().await;
        for m in [
            MavMessage::HEARTBEAT(hb),
            MavMessage::GLOBAL_POSITION_INT(pos),
            MavMessage::GPS_RAW_INT(gps),
        ] {
            router.on_message(&header, &m, Clock::default());
        }
    }

    async fn login(&self, user: &str, pass: &str) -> String {
        let req = Request::builder()
            .method(Method::POST)
            .uri("/api/auth/login")
            .header("x-requested-with", "rgcs")
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(
                json!({ "username": user, "password": pass }).to_string(),
            ))
            .unwrap();
        let res = self.http.clone().oneshot(req).await.unwrap();
        assert_eq!(res.status(), StatusCode::OK);
        let cookie = res.headers().get(header::SET_COOKIE).unwrap().to_str().unwrap();
        cookie.split(';').next().unwrap().to_string()
    }

    /// (status, raw body text).
    async fn call(&self, method: Method, path: &str, body: Option<Value>) -> (StatusCode, String) {
        let cookie = self.login("admin", "admin").await;
        let mut b = Request::builder()
            .method(method)
            .uri(path)
            .header("x-requested-with", "rgcs")
            .header(header::COOKIE, cookie);
        let body = match body {
            Some(v) => {
                b = b.header(header::CONTENT_TYPE, "application/json");
                Body::from(v.to_string())
            }
            None => Body::empty(),
        };
        let res = self.http.clone().oneshot(b.body(body).unwrap()).await.unwrap();
        let status = res.status();
        let bytes = res.into_body().collect().await.unwrap().to_bytes();
        (status, String::from_utf8(bytes.to_vec()).unwrap())
    }

    async fn call_json(&self, method: Method, path: &str, body: Option<Value>) -> (StatusCode, Value) {
        let (s, text) = self.call(method, path, body).await;
        (s, serde_json::from_str(&text).unwrap_or(Value::Null))
    }

    async fn fetch(&self, id: SourceId) -> rgcs_core::EnvSourceStatus {
        self.env().fetch_now(id).await
    }

    fn summaries(&mut self) -> Vec<rgcs_core::EnvSummary> {
        let mut out = Vec::new();
        while let Ok(m) = self.ws.try_recv() {
            if let ServerMessage::EnvSummary { summary } = m {
                out.push(summary);
            }
        }
        out
    }
}

fn keys(open_meteo: Option<&str>, owm: Option<&str>) -> EnvKeys {
    EnvKeys {
        open_meteo: open_meteo.map(Secret::new),
        openweathermap: owm.map(Secret::new),
    }
}

// ---- request shapes ----

#[tokio::test]
async fn open_meteo_sends_only_the_rounded_cell() {
    let rig = Rig::new().await;
    rig.consent(true, true);
    rig.vehicle_at(RAW.0, RAW.1).await;
    let st = rig.fetch(SourceId::OpenMeteo).await;
    assert_eq!(st.last_error, None, "{st:?}");
    assert_eq!(st.last_ok_ms, Some(T0));
    let seen = rig.fake.seen();
    assert_eq!(seen.len(), 1, "{seen:?}");
    assert!(
        seen[0].starts_with("/v1/forecast?latitude=36.25&longitude=137.64&"),
        "{seen:?}"
    );
    assert!(seen[0].contains("wind_speed_unit=ms"), "{seen:?}");
    assert!(!seen[0].contains("apikey"), "{seen:?}");
    assert!(seen
        .iter()
        .all(|u| !u.contains("36.2509") && !u.contains("137.6385")));
}

#[tokio::test]
async fn an_open_meteo_key_switches_to_the_customer_endpoint() {
    let rig = Rig::with(keys(Some("om-key-77aa"), None), None).await;
    rig.consent(true, true);
    rig.vehicle_at(RAW.0, RAW.1).await;
    let st = rig.fetch(SourceId::OpenMeteo).await;
    assert_eq!(st.last_error, None);
    let seen = rig.fake.seen();
    assert!(
        seen[0].starts_with("/customer/v1/forecast?latitude=36.25&"),
        "{seen:?}"
    );
    assert!(seen[0].contains("&apikey=om-key-77aa"), "{seen:?}");
}

#[tokio::test]
async fn swpc_kp_is_a_plain_get_without_a_query() {
    let rig = Rig::new().await;
    rig.consent(true, true);
    let st = rig.fetch(SourceId::SwpcKp).await;
    assert_eq!(st.last_error, None);
    assert_eq!(
        rig.fake.seen(),
        vec!["/products/noaa-planetary-k-index.json".to_string()]
    );
}

#[tokio::test]
async fn amedas_makes_three_requests_without_coordinates() {
    let rig = Rig::new().await;
    rig.consent(true, true);
    rig.vehicle_at(RAW.0, RAW.1).await;
    let st = rig.fetch(SourceId::JmaAmedas).await;
    assert_eq!(st.last_error, None, "{st:?}");
    let seen = rig.fake.seen();
    assert_eq!(
        seen,
        vec![
            "/bosai/amedas/data/latest_time.txt".to_string(),
            "/bosai/amedas/const/amedastable.json".to_string(),
            "/bosai/amedas/data/map/20261025121000.json".to_string(),
        ]
    );
    assert!(seen.iter().all(|u| !u.contains("36.") && !u.contains("137.")));
    let wind = rig
        .env()
        .summary()
        .factors
        .into_iter()
        .find(|f| f.kind == "wind")
        .unwrap();
    assert!(wind.readings.iter().any(|r| r.source == "jma_amedas"));
    // The station table is cached: a second fetch skips it.
    rig.fake.clear();
    rig.fetch(SourceId::JmaAmedas).await;
    assert_eq!(rig.fake.seen().len(), 2);
}

// ---- consent and toggle ----

// sqlx's pool times out under paused time, so the rig is built before the clock is paused.
#[tokio::test]
async fn the_scheduler_sends_nothing_while_the_guard_is_off() {
    let rig = Rig::new().await;
    rig.vehicle_at(RAW.0, RAW.1).await;
    tokio::time::pause();
    let (_tx, rx) = broadcast::channel(8);
    rig.env().spawn(rig.app.clone(), rx);
    tokio::time::sleep(Duration::from_secs(3)).await;
    assert_eq!(rig.fake.seen(), Vec::<String>::new());
}

#[tokio::test]
async fn the_scheduler_sends_nothing_without_external_data_consent() {
    let rig = Rig::new().await;
    rig.consent(true, false);
    rig.vehicle_at(RAW.0, RAW.1).await;
    tokio::time::pause();
    let (_tx, rx) = broadcast::channel(8);
    rig.env().spawn(rig.app.clone(), rx);
    tokio::time::sleep(Duration::from_secs(3)).await;
    assert_eq!(rig.fake.seen(), Vec::<String>::new());
}

#[tokio::test]
async fn a_consented_scheduler_step_fetches_every_enabled_source_once() {
    let rig = Rig::new().await;
    rig.consent(true, true);
    rig.vehicle_at(RAW.0, RAW.1).await;
    rig.env().step().await;
    for _ in 0..400 {
        if rig
            .env()
            .sources()
            .iter()
            .filter(|s| s.enabled)
            .all(|s| s.last_ok_ms.is_some())
        {
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    let seen = rig.fake.seen();
    assert!(seen.iter().any(|u| u.starts_with("/v1/forecast")), "{seen:?}");
    assert!(seen.iter().any(|u| u == "/products/alerts.json"), "{seen:?}");
    assert!(
        !seen
            .iter()
            .any(|u| u.starts_with("/app/json") || u.starts_with("/data/2.5")),
        "{seen:?}"
    );
    // Not due again until the interval passes.
    let before = rig.fake.seen().len();
    rig.env().step().await;
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert_eq!(rig.fake.seen().len(), before);
}

#[tokio::test]
async fn fetch_now_through_the_api_needs_the_guard_and_consent_2() {
    let rig = Rig::new().await;
    let (s, body) = rig
        .call_json(Method::POST, "/api/env/sources/swpc_kp/fetch", None)
        .await;
    assert_eq!(
        (s, body["error"]["code"].as_str()),
        (StatusCode::CONFLICT, Some("guard_disabled"))
    );
    rig.consent(true, false);
    let (s, body) = rig
        .call_json(Method::POST, "/api/env/sources/swpc_kp/fetch", None)
        .await;
    assert_eq!(
        (s, body["error"]["code"].as_str()),
        (StatusCode::CONFLICT, Some("consent_required"))
    );
    assert_eq!(rig.fake.seen(), Vec::<String>::new());
    rig.consent(true, true);
    let (s, body) = rig
        .call_json(Method::POST, "/api/env/sources/swpc_kp/fetch", None)
        .await;
    assert_eq!(s, StatusCode::OK, "{body}");
    assert_eq!(body["data"]["id"], "swpc_kp");
    assert!(body["data"]["last_ok_ms"].is_u64());
    let (s, _) = rig
        .call_json(Method::POST, "/api/env/sources/nope/fetch", None)
        .await;
    assert_eq!(s, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn fetch_now_while_off_makes_no_request() {
    let rig = Rig::new().await;
    rig.vehicle_at(RAW.0, RAW.1).await;
    rig.fetch(SourceId::OpenMeteo).await;
    assert_eq!(rig.fake.seen(), Vec::<String>::new());
}

// ---- failure modes ----

async fn failing(path: &str, r: Reply, id: SourceId) -> (Rig, rgcs_core::EnvSourceStatus) {
    let rig = Rig::new().await;
    rig.consent(true, true);
    rig.vehicle_at(RAW.0, RAW.1).await;
    rig.fake.on(path, r);
    let st = rig.fetch(id).await;
    (rig, st)
}

#[tokio::test]
async fn a_redirect_is_an_error_and_never_followed() {
    let (rig, st) = failing(
        "/products/noaa-planetary-k-index.json",
        reply(302, ""),
        SourceId::SwpcKp,
    )
    .await;
    assert_eq!(st.last_error.as_deref(), Some("redirect"));
    assert!(rig.fake.seen().iter().all(|u| u != "/elsewhere"));
}

#[tokio::test]
async fn a_slow_source_times_out() {
    let rig = Rig::new().await;
    rig.consent(true, true);
    let cfg = rig.env().source_cfg(SourceId::SwpcKp);
    rig.env().set_source(
        SourceId::SwpcKp,
        SourceCfg {
            timeout_ms: 1000,
            ..cfg
        },
    );
    let slow = Reply {
        delay_ms: 1600,
        ..reply(200, fixture!("swpc_kp_rows.json"))
    };
    rig.fake.on("/products/noaa-planetary-k-index.json", slow);
    let started = std::time::Instant::now();
    let st = rig.fetch(SourceId::SwpcKp).await;
    assert_eq!(st.last_error.as_deref(), Some("timeout"));
    assert!(started.elapsed() < Duration::from_millis(1500));
}

#[tokio::test]
async fn a_closed_port_is_unreachable() {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let closed = format!("http://{}", listener.local_addr().unwrap());
    drop(listener);
    let rig = Rig::with(EnvKeys::default(), Some(closed)).await;
    rig.consent(true, true);
    let st = rig.fetch(SourceId::SwpcKp).await;
    assert_eq!(st.last_error.as_deref(), Some("unreachable"));
}

#[tokio::test]
async fn server_errors_html_and_huge_bodies_have_their_codes() {
    let path = "/products/noaa-planetary-k-index.json";
    let (_, st) = failing(path, reply(500, "oops"), SourceId::SwpcKp).await;
    assert_eq!(st.last_error.as_deref(), Some("http_500"));
    let (_, st) = failing(path, reply(200, "<html>"), SourceId::SwpcKp).await;
    assert_eq!(st.last_error.as_deref(), Some("parse"));
    let huge = "x".repeat(3 * 1024 * 1024);
    let (_, st) = failing(path, reply(200, &huge), SourceId::SwpcKp).await;
    assert_eq!(st.last_error.as_deref(), Some("too_large"));
}

#[tokio::test]
async fn owm_without_a_key_is_no_key_and_sends_nothing() {
    let rig = Rig::new().await;
    rig.consent(true, true);
    rig.vehicle_at(RAW.0, RAW.1).await;
    let cfg = rig.env().source_cfg(SourceId::Openweathermap);
    rig.env()
        .set_source(SourceId::Openweathermap, SourceCfg { enabled: true, ..cfg });
    let st = rig.fetch(SourceId::Openweathermap).await;
    assert_eq!(st.last_error.as_deref(), Some("no_key"));
    assert_eq!(rig.fake.seen(), Vec::<String>::new());
}

#[tokio::test]
async fn a_location_source_without_a_position_is_no_location() {
    let rig = Rig::new().await;
    rig.consent(true, true);
    let st = rig.fetch(SourceId::OpenMeteo).await;
    assert_eq!(st.last_error.as_deref(), Some("no_location"));
    assert_eq!(rig.fake.seen(), Vec::<String>::new());
}

// ---- partial failure, guard context ----

#[tokio::test]
async fn one_failed_source_is_listed_missing_and_the_rest_still_counts() {
    let (rig, _) = failing("/v1/forecast", reply(500, ""), SourceId::OpenMeteo).await;
    rig.fetch(SourceId::SwpcKp).await;
    let s = rig.env().summary();
    assert_eq!(s.missing, vec!["open_meteo".to_string()]);
    assert!(!s.unavailable);
    assert!(
        s.factors.iter().any(|f| f.kind == "kp" && f.value.is_some()),
        "{s:?}"
    );
    assert_eq!(s.cell, Some((36.25, 137.64)));
}

#[tokio::test]
async fn everything_failing_is_unavailable() {
    let (rig, _) = failing("/v1/forecast", reply(500, ""), SourceId::OpenMeteo).await;
    rig.fake
        .on("/products/noaa-planetary-k-index.json", reply(503, ""));
    rig.fetch(SourceId::SwpcKp).await;
    let s = rig.env().summary();
    assert!(s.unavailable, "{s:?}");
    assert_eq!(s.missing, vec!["open_meteo".to_string(), "swpc_kp".to_string()]);
}

#[tokio::test]
async fn kp_fixtures_raise_the_guard_context_and_broadcast_a_summary() {
    let mut rig = Rig::new().await;
    rig.consent(true, true);
    assert_eq!(rig.app.guard.context(), ExternalContext::default());
    rig.fetch(SourceId::SwpcKp).await;
    rig.fetch(SourceId::SwpcKp1m).await;
    assert_eq!(
        rig.app.guard.context(),
        ExternalContext {
            kp: Some(ExtLevel::Strong)
        }
    );
    let frames = rig.summaries();
    let last = frames.last().expect("an env_summary frame");
    let kp = last.factors.iter().find(|f| f.kind == "kp").unwrap();
    assert_eq!(kp.level, rgcs_core::EnvLevel::Strong);
    // The level comes from the nowcast; the observed reading is still listed with its source.
    assert_eq!(kp.value.as_ref().unwrap().source, "swpc_kp_1m");
    assert!(kp
        .readings
        .iter()
        .any(|r| r.source == "swpc_kp" && r.class == rgcs_core::EnvClass::Observed));
    // Off again: the guard no longer gets external context.
    rig.consent(false, false);
    rig.env().refresh().await;
    assert_eq!(rig.app.guard.context(), ExternalContext::default());
}

#[tokio::test]
async fn swpc_alerts_become_notes() {
    let rig = Rig::new().await;
    rig.consent(true, true);
    let st = rig.fetch(SourceId::SwpcAlerts).await;
    assert_eq!(st.last_error, None);
    let notes = rig.env().summary().notes;
    assert_eq!(notes.len(), 1, "{notes:?}");
    assert!(notes[0].starts_with("K07A"), "{notes:?}");
}

#[tokio::test]
async fn vehicle_wind_gnss_and_local_sun_are_fused_without_consent() {
    let rig = Rig::new().await;
    rig.vehicle_at(RAW.0, RAW.1).await;
    rig.env().on_frame(&rgcs_mavlink::GuardFrame {
        sysid: 1,
        compid: 1,
        body: rgcs_mavlink::GuardBody::Wind {
            dir_deg: 250.0,
            speed: 13.0,
        },
    });
    rig.env().refresh().await;
    let s = rig.env().summary();
    let wind = s.factors.iter().find(|f| f.kind == "wind").unwrap();
    assert_eq!(wind.level, rgcs_core::EnvLevel::Strong);
    assert_eq!(wind.value.as_ref().unwrap().source, "vehicle");
    let gnss = s.factors.iter().find(|f| f.kind == "gnss").unwrap();
    assert_eq!(gnss.readings[0].value, 12.0);
    assert!(s.factors.iter().any(|f| f.kind == "daylight"));
    assert!(!s.unavailable, "nothing external is enabled while off");
    assert_eq!(rig.app.guard.context(), ExternalContext::default());
}

// ---- settings API ----

#[tokio::test]
async fn source_put_validates_audits_and_persists() {
    let rig = Rig::new().await;
    let (s, body) = rig
        .call_json(
            Method::PUT,
            "/api/env/sources/open_meteo",
            Some(json!({ "interval_s": 30 })),
        )
        .await;
    assert_eq!(
        (s, body["error"]["code"].as_str()),
        (StatusCode::BAD_REQUEST, Some("validation"))
    );
    let (s, body) = rig
        .call_json(
            Method::PUT,
            "/api/env/sources/open_meteo",
            Some(json!({ "interval_s": 900 })),
        )
        .await;
    assert_eq!(s, StatusCode::OK, "{body}");
    assert_eq!(body["data"]["interval_s"], 900);
    let audit = rig.app.store.recent_audit(10).await.unwrap();
    assert!(audit
        .iter()
        .any(|a| a.target == "ai_intervention" && a.command == "env_source_put"));
    // A restarted hub on the same database keeps the value.
    let again = EnvHub::new(
        rig.app.env.endpoints().clone(),
        EnvKeys::default(),
        rig.app.tx.clone(),
        rig.app.guard.clone(),
    );
    again.load(&rig.app.store).await;
    assert_eq!(again.source_cfg(SourceId::OpenMeteo).interval_s, 900);
    let (s, _) = rig
        .call_json(
            Method::PUT,
            "/api/env/sources/vehicle",
            Some(json!({ "enabled": false })),
        )
        .await;
    assert_eq!(s, StatusCode::NOT_FOUND);
}

#[tokio::test]
async fn settings_put_validates_the_rounding_step_and_audits() {
    let rig = Rig::new().await;
    let (s, body) = rig.call_json(Method::GET, "/api/env/settings", None).await;
    assert_eq!(s, StatusCode::OK);
    assert_eq!(body["data"]["rounding_deg"], 0.01);
    assert_eq!(body["data"]["copter"]["wind"], json!([8.4, 12.0]));
    let (s, _) = rig
        .call_json(
            Method::PUT,
            "/api/env/settings",
            Some(json!({ "rounding_deg": 0.02 })),
        )
        .await;
    assert_eq!(s, StatusCode::BAD_REQUEST);
    let (s, body) = rig
        .call_json(
            Method::PUT,
            "/api/env/settings",
            Some(json!({ "rounding_deg": 0.1 })),
        )
        .await;
    assert_eq!(s, StatusCode::OK, "{body}");
    assert_eq!(body["data"]["rounding_deg"], 0.1);
    let audit = rig.app.store.recent_audit(10).await.unwrap();
    assert!(audit
        .iter()
        .any(|a| a.target == "ai_intervention" && a.command == "env_settings_put"));
    let again = EnvHub::new(
        rig.app.env.endpoints().clone(),
        EnvKeys::default(),
        rig.app.tx.clone(),
        rig.app.guard.clone(),
    );
    again.load(&rig.app.store).await;
    assert_eq!(again.settings().rounding_deg, 0.1);
}

#[tokio::test]
async fn the_rounding_step_changes_the_cell_sent() {
    let rig = Rig::new().await;
    rig.consent(true, true);
    rig.vehicle_at(RAW.0, RAW.1).await;
    rig.env().apply_settings(rgcs_core::EnvSettings {
        rounding_deg: 0.1,
        ..rig.env().settings()
    });
    rig.fetch(SourceId::OpenMeteo).await;
    assert!(rig.fake.seen()[0].starts_with("/v1/forecast?latitude=36.3&longitude=137.6&"));
}

#[tokio::test]
async fn keys_never_leak() {
    let rig = Rig::with(keys(None, Some(OWM_KEY)), None).await;
    rig.consent(true, true);
    rig.vehicle_at(RAW.0, RAW.1).await;
    let cfg = rig.env().source_cfg(SourceId::Openweathermap);
    rig.env()
        .set_source(SourceId::Openweathermap, SourceCfg { enabled: true, ..cfg });
    // A good fetch sends the key to the fake (only there) …
    assert_eq!(rig.fetch(SourceId::Openweathermap).await.last_error, None);
    assert!(rig.fake.seen()[0].contains(&format!("appid={OWM_KEY}")));
    // … and failures never carry it.
    rig.fake.on("/data/2.5/weather", reply(500, OWM_KEY));
    let st = rig.fetch(SourceId::Openweathermap).await;
    assert_eq!(st.last_error.as_deref(), Some("http_500"));
    let (s, text) = rig.call(Method::GET, "/api/env/sources", None).await;
    assert_eq!(s, StatusCode::OK);
    assert!(!text.contains(OWM_KEY), "{text}");
    let body: Value = serde_json::from_str(&text).unwrap();
    let owm = body["data"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["id"] == "openweathermap")
        .unwrap()
        .clone();
    assert_eq!(owm["key_configured"], true);
    assert_eq!(owm["key_hint"], "…9f3a");
    assert_eq!(owm["needs_key"], true);
    for path in ["/api/env/factors", "/api/env/settings"] {
        let (_, text) = rig.call(Method::GET, path, None).await;
        assert!(!text.contains(OWM_KEY), "{path}: {text}");
    }
    assert!(rig
        .env()
        .sources()
        .iter()
        .all(|s| !s.last_error.clone().unwrap_or_default().contains(OWM_KEY)));
    let config = crate::config::Config::parse("[env]\nopenweathermap_api_key_env = 'OWM_API_KEY'").unwrap();
    let resolved = EnvKeys::resolve(&config.env, &|name| {
        (name == "OWM_API_KEY").then(|| OWM_KEY.to_string())
    });
    assert_eq!(
        resolved.openweathermap.as_ref().map(Secret::expose),
        Some(OWM_KEY)
    );
    assert!(!format!("{config:?}").contains(OWM_KEY));
    assert!(!format!("{resolved:?}").contains(OWM_KEY));
}

#[test]
#[should_panic(expected = "tests must use the local fake")]
fn default_endpoints_are_never_used_in_tests() {
    let _ = EnvEndpoints::default();
}

#[test]
fn the_app_state_default_hub_is_offline() {
    let ep = EnvEndpoints::offline();
    let all = [
        &ep.open_meteo,
        &ep.open_meteo_customer,
        &ep.jma,
        &ep.swpc,
        &ep.gfz,
        &ep.owm,
    ];
    assert!(all.iter().all(|u| u.starts_with("http://127.0.0.1:0")), "{ep:?}");
    // Only the shape of the real endpoints: no test names a real host.
    let real = EnvEndpoints::real();
    assert!(
        real.swpc.starts_with("https://") && !real.swpc.contains("127.0.0.1"),
        "{real:?}"
    );
}

#[tokio::test]
async fn the_clock_drives_freshness() {
    let rig = Rig::new().await;
    rig.consent(true, true);
    rig.fetch(SourceId::SwpcKp).await;
    assert!(rig
        .env()
        .summary()
        .factors
        .iter()
        .any(|f| f.kind == "kp" && f.value.is_some()));
    rig.clock.store(T0 + 6 * 3_600_000, Ordering::SeqCst);
    rig.env().refresh().await;
    let s = rig.env().summary();
    let kp = s.factors.iter().find(|f| f.kind == "kp").unwrap();
    assert!(
        kp.value.is_none() && !kp.readings[0].fresh,
        "stale Kp is shown greyed, not counted"
    );
    assert!(s.unavailable);
    assert_eq!(rig.app.guard.context(), ExternalContext::default());
}

#[path = "env_ai_tools_tests.rs"]
mod ai_tools;
