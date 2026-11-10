//! Shared server state and the axum router.

use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use axum::response::Html;
use axum::routing::{get, post, put};
use axum::{middleware, Router as AxumRouter};
use rgcs_core::{ServerMessage, SysId};
use rgcs_mavlink::{Outgoing, QueuedCommand, Router};
use rgcs_store::{Lockout, Store};
use tokio::sync::{broadcast, mpsc, Mutex};
use tower_http::services::{ServeDir, ServeFile};
use tower_http::trace::TraceLayer;

use crate::cameras::{CameraFactory, CameraManager};
use crate::confirm::{ConfirmError, ConfirmTokens};
use crate::params::ParamCache;
use crate::settings;
use crate::video::VideoHub;
use crate::{
    api, assignment_api, auth, branding, calib_api, camera_api, commands, export_api, flight_api,
    geofence_api, guided, input_api, inspector_api, logbook_api, logs_api, messages_api, mission_api,
    network_api, overlay_api, param_api, param_pick, plugin_api, present_api, roi_api, survey_camera_api,
    video_api, ws,
};
use axum::extract::DefaultBodyLimit;
use axum::routing::delete;
use rgcs_video::{Timings, WhepRelay, MAX_OFFER_BYTES};

pub const BROADCAST_CAPACITY: usize = 1024;
/// Distinct usernames tracked for login serialization before the map is reset.
const MAX_LOGIN_GUARDS: usize = 1024;

#[derive(Clone)]
pub struct AppState {
    pub router: Arc<Mutex<Router>>,
    pub tx: broadcast::Sender<ServerMessage>,
    pub store: Store,
    pub queue: mpsc::Sender<QueuedCommand>,
    /// Frames sent straight to the link without waiting for an ACK (Guided targets, param reads).
    pub outgoing: mpsc::Sender<Outgoing>,
    pub params: ParamCache,
    pub cameras: CameraManager,
    /// The FC link's camera / gimbal port (payload tap, outgoing frames, ACKs); detached
    /// until `with_mav_port`.
    pub mav: rgcs_mavlink::MavPort,
    /// GPS ROI tasks; always built on `cameras`.
    pub roi: crate::roi::RoiHub,
    pub video: VideoHub,
    pub whep: WhepRelay,
    pub missions: crate::missions::MissionHub,
    /// The RGCS MAVLink SYSID (app setting `mavlink.gcs_sysid`, default 255), shared with the link.
    pub gcs: rgcs_core::GcsId,
    /// Every MAVLink frame received and sent (maintenance › MAVLink インスペクター).
    pub inspector: rgcs_mavlink::Inspector,
    /// ARM → DISARM flight drafts.
    pub flights: crate::flights::FlightTracker,
    /// DataFlash retrieval over LOG_REQUEST_*.
    pub logs: crate::logs::LogHub,
    /// 点検・校正 sessions.
    pub calib: crate::calibration::CalibHub,
    /// Persistent message log (footer, history sheet, acknowledgements).
    pub messages: crate::message_log::MessageLog,
    /// Live WebSocket sessions (network view client list).
    pub sessions: crate::sessions::SessionRegistry,
    /// AI chat: conversations, rate limit, budget and proposals (`config.toml [ai]`).
    pub ai: crate::ai_hub::AiHub,
    /// AI 緊急介入 (experimental): per-vehicle detection, alerts, the guarded L2 / L3 action.
    pub guard: crate::guard_hub::GuardHub,
    /// External factors (外的要因): fetchers, fusion, the guard's `ExternalContext`.
    pub env: crate::env_hub::EnvHub,
    /// Per-component receive rates and sequence loss of the FC link (network view).
    pub link_stats: rgcs_mavlink::LinkStats,
    /// `config.toml` listen / link / role, for the network view.
    pub network: Arc<crate::network::NetworkConfig>,
    /// MediaMTX reachability (network view).
    pub media: crate::media_probe::MediaProbe,
    /// Where branding files (and the database) live; `config.toml` `data_dir`.
    pub data_dir: PathBuf,
    pub hostname: String,
    pub secure_cookies: bool,
    /// Map tile source handed to the UI by `GET /api/settings/app`.
    pub map_tile_url: String,
    pub map_attribution: String,
    /// Base maps for the picker (config `[[basemaps]]` or the defaults).
    pub basemaps: Vec<crate::config::Basemap>,
    /// DEM tiles for the 3D map; `None` turns 3D off.
    pub terrain_tiles: Option<String>,
    pub terrain_encoding: String,
    /// Fetches the tiles of plugin `area` overlays (shared limits across every plugin).
    pub overlay_fetcher: crate::overlay_fetch::OverlayFetcher,
    /// Plugins read from `plugins_dir` at start; none until `with_plugins`.
    pub plugins: crate::plugins::PluginRegistry,
    started: Instant,
    started_unix_ms: u64,
    lockout: Arc<StdMutex<Lockout>>,
    /// One async mutex per username so check-lockout → verify → record is serialized
    /// (otherwise concurrent attempts slip past the 5-failure limit).
    login_guards: Arc<StdMutex<HashMap<String, Arc<Mutex<()>>>>>,
    /// Vehicles whose first Guided target was confirmed in this process.
    guided_confirmed: Arc<StdMutex<HashSet<SysId>>>,
    confirm: Arc<StdMutex<ConfirmTokens>>,
    next_command: Arc<AtomicU64>,
    dev_mode: Arc<AtomicBool>,
}

impl AppState {
    pub fn new(
        router: Arc<Mutex<Router>>,
        tx: broadcast::Sender<ServerMessage>,
        store: Store,
        queue: mpsc::Sender<QueuedCommand>,
        dev_mode: bool,
    ) -> Self {
        let hostname = std::env::var("HOSTNAME").unwrap_or_else(|_| "rgcs".into());
        // Without a link the sender has no receiver: direct sends fail → 503 link_lost.
        let (outgoing, _) = mpsc::channel(1);
        let cameras = CameraManager::new(store.clone(), tx.clone(), CameraFactory::Real);
        cameras.set_gps_time(crate::gps_time::factory(router.clone()));
        let roi = crate::roi::RoiHub::new(store.clone(), cameras.clone(), router.clone(), tx.clone());
        let video = VideoHub::new(store.clone(), tx.clone(), Timings::default());
        let gcs = rgcs_core::GcsId::default();
        let missions = crate::missions::MissionHub::new(tx.clone(), gcs.clone());
        let params = ParamCache::new(tx.clone());
        let flights = crate::flights::FlightTracker::new(store.clone(), tx.clone());
        let logs = crate::logs::LogHub::new(tx.clone(), true);
        let calib = crate::calibration::CalibHub::new(tx.clone(), store.clone());
        let messages = crate::message_log::MessageLog::spawn(store.clone(), tx.clone());
        let guard = crate::guard_hub::GuardHub::new(tx.clone());
        // Offline until main installs the configured hub: nothing here can reach the internet.
        let env = crate::env_hub::EnvHub::new(
            crate::env_fetch::EnvEndpoints::offline(),
            crate::env_fetch::EnvKeys::default(),
            tx.clone(),
            guard.clone(),
        );
        let whep = WhepRelay::new(&crate::config::Config::default().whep_upstream)
            .expect("default whep upstream parses");
        Self {
            router,
            tx,
            store,
            queue,
            outgoing,
            params,
            cameras,
            mav: rgcs_mavlink::MavPort::detached(),
            roi,
            video,
            whep,
            missions,
            flights,
            logs,
            calib,
            messages,
            sessions: crate::sessions::SessionRegistry::default(),
            ai: crate::ai_hub::AiHub::disabled(rgcs_ai::Unconfigured::Disabled),
            guard,
            env,
            link_stats: rgcs_mavlink::LinkStats::default(),
            network: Arc::new(crate::network::NetworkConfig::default()),
            media: crate::media_probe::MediaProbe::default(),
            gcs,
            inspector: rgcs_mavlink::Inspector::default(),
            data_dir: crate::config::Config::default().data_dir,
            hostname,
            secure_cookies: false,
            map_tile_url: crate::config::Config::default().map_tile_url,
            map_attribution: crate::config::Config::default().map_attribution,
            basemaps: crate::config::Config::default().basemaps(),
            terrain_tiles: crate::config::Config::default().terrain(),
            terrain_encoding: crate::config::Config::default().terrain_encoding().into(),
            overlay_fetcher: crate::overlay_fetch::OverlayFetcher::default(),
            plugins: crate::plugins::PluginRegistry::default(),
            started: Instant::now(),
            started_unix_ms: unix_ms(),
            lockout: Arc::new(StdMutex::new(Lockout::default())),
            login_guards: Arc::new(StdMutex::new(HashMap::new())),
            guided_confirmed: Arc::new(StdMutex::new(HashSet::new())),
            confirm: Arc::new(StdMutex::new(ConfirmTokens::default())),
            next_command: Arc::new(AtomicU64::new(1)),
            dev_mode: Arc::new(AtomicBool::new(dev_mode)),
        }
    }

    pub fn with_outgoing(self, outgoing: mpsc::Sender<Outgoing>) -> Self {
        Self { outgoing, ..self }
    }

    /// Installs the AI hub built from `config.toml [ai]` (or a test fake).
    pub fn with_ai(self, ai: crate::ai_hub::AiHub) -> Self {
        Self { ai, ..self }
    }

    /// Installs a guard hub (tests: one with a manual clock). Call before `GuardHub::spawn`.
    pub fn with_guard(self, guard: crate::guard_hub::GuardHub) -> Self {
        let env = self.env.clone().with_guard(guard.clone());
        Self { guard, env, ..self }
    }

    /// Installs the external-factor hub (main: configured endpoints + keys; tests: the fake).
    /// It is re-pointed at this state's guard hub.
    pub fn with_env(self, env: crate::env_hub::EnvHub) -> Self {
        let env = env.with_guard(self.guard.clone());
        Self { env, ..self }
    }

    /// `config.toml` `log_fetch` resolved for this link (see `Config::log_fetch_enabled`).
    pub fn with_log_fetch(self, enabled: bool) -> Self {
        Self {
            logs: self.logs.clone().with_enabled(enabled),
            ..self
        }
    }

    /// Swaps the camera manager; the ROI hub is rebuilt so it drives the same drivers.
    pub fn with_cameras(self, cameras: CameraManager) -> Self {
        cameras.set_gps_time(crate::gps_time::factory(self.router.clone()));
        cameras.set_mav_port(self.mav.clone());
        let roi = crate::roi::RoiHub::new(
            self.store.clone(),
            cameras.clone(),
            self.router.clone(),
            self.tx.clone(),
        );
        Self { cameras, roi, ..self }
    }

    /// Installs the FC link's MAVLink port; `mavlink` camera drivers built from now on use it.
    pub fn with_mav_port(self, port: rgcs_mavlink::MavPort) -> Self {
        self.cameras.set_mav_port(port.clone());
        Self { mav: port, ..self }
    }

    /// Points the WHEP relay at another MediaMTX (`config.toml` or a test fake).
    pub fn with_whep_upstream(self, upstream: &str) -> Self {
        let whep = WhepRelay::new(upstream).unwrap_or_else(|e| {
            tracing::error!(error = %e, "whep_upstream is invalid; keeping the default");
            self.whep.clone()
        });
        Self { whep, ..self }
    }

    /// Spawns the background tasks that act on their own (ARM / DISARM auto record).
    pub fn spawn_background(&self) {
        crate::auto_record::spawn(self.clone());
    }

    /// Boot: start every configured camera driver and its video monitor without waiting for
    /// a request (the detail panel must show the camera right after a Pi reboot).
    pub async fn bring_up_configured(&self) {
        let sysids = self.store.camera_profile_sysids().await.unwrap_or_default();
        for sysid in sysids {
            self.cameras.ensure(sysid).await;
            self.video.status(sysid).await;
        }
    }

    /// `config.toml` listen / link / role shown by the network view.
    pub fn with_network(self, network: crate::network::NetworkConfig) -> Self {
        Self {
            network: Arc::new(network),
            ..self
        }
    }

    pub fn with_data_dir(self, data_dir: PathBuf) -> Self {
        Self { data_dir, ..self }
    }

    pub fn with_video_timings(self, timings: Timings) -> Self {
        let video = VideoHub::new(self.store.clone(), self.tx.clone(), timings);
        Self { video, ..self }
    }

    pub fn guided_confirmed(&self, sysid: SysId) -> bool {
        self.guided_confirmed
            .lock()
            .expect("guided mutex")
            .contains(&sysid)
    }

    pub fn mark_guided_confirmed(&self, sysid: SysId) {
        self.guided_confirmed.lock().expect("guided mutex").insert(sysid);
    }

    pub fn with_basemaps(self, basemaps: Vec<crate::config::Basemap>) -> Self {
        Self { basemaps, ..self }
    }

    pub fn with_terrain(self, terrain_tiles: Option<String>, terrain_encoding: &str) -> Self {
        Self {
            terrain_tiles,
            terrain_encoding: terrain_encoding.into(),
            ..self
        }
    }

    /// Tests: a fetcher with short timings.
    pub fn with_overlay_fetcher(self, overlay_fetcher: crate::overlay_fetch::OverlayFetcher) -> Self {
        Self {
            overlay_fetcher,
            ..self
        }
    }

    /// Installs the plugins (main: scanned from `plugins_dir`; tests: a temp directory).
    pub fn with_plugins(self, plugins: crate::plugins::PluginRegistry) -> Self {
        Self { plugins, ..self }
    }

    pub fn with_map(self, tile_url: String, attribution: String) -> Self {
        Self {
            map_tile_url: tile_url,
            map_attribution: attribution,
            ..self
        }
    }

    /// Monotonic seconds since start (lockouts and confirm tokens).
    pub fn now_secs(&self) -> u64 {
        self.started.elapsed().as_secs()
    }

    /// Wall-clock start of this process (Unix ms).
    pub fn started_unix_ms(&self) -> u64 {
        self.started_unix_ms
    }

    pub fn dev_mode(&self) -> bool {
        self.dev_mode.load(Ordering::Relaxed)
    }

    pub fn locked_for(&self, user: &str) -> Option<u64> {
        self.lockout
            .lock()
            .expect("lockout mutex")
            .locked_for(user, self.now_secs())
    }

    /// Guard to hold for the whole login attempt of `user`.
    pub fn login_guard(&self, user: &str) -> Arc<Mutex<()>> {
        let mut guards = self.login_guards.lock().expect("login guards mutex");
        if guards.len() > MAX_LOGIN_GUARDS && !guards.contains_key(user) {
            // Drop only guards nobody holds: an in-flight attempt keeps its Arc alive, and a
            // concurrent attempt for the same user must share that very mutex.
            guards.retain(|_, m| Arc::strong_count(m) > 1);
        }
        guards.entry(user.to_string()).or_default().clone()
    }

    pub fn login_failed(&self, user: &str) {
        let mut l = self.lockout.lock().expect("lockout mutex");
        *l = l.fail(user, self.now_secs());
    }

    pub fn login_succeeded(&self, user: &str) {
        let mut l = self.lockout.lock().expect("lockout mutex");
        *l = l.succeed(user);
    }

    pub fn issue_confirm(&self, sysid: SysId, cmd: &str) -> String {
        let mut c = self.confirm.lock().expect("confirm mutex");
        let (next, token) = c.issue(sysid, cmd, self.now_secs());
        *c = next;
        token
    }

    pub fn consume_confirm(&self, token: &str, sysid: SysId, cmd: &str) -> Result<(), ConfirmError> {
        let mut c = self.confirm.lock().expect("confirm mutex");
        let (next, verdict) = c.consume(token, sysid, cmd, self.now_secs());
        *c = next;
        verdict
    }

    pub fn next_command_id(&self) -> u64 {
        self.next_command.fetch_add(1, Ordering::Relaxed)
    }
}

pub fn unix_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Where the browser UI comes from.
pub enum UiSource {
    /// `config.toml` `ui_dir` (a built `ui/dist` on disk).
    Dir(PathBuf),
    /// Compiled into the binary (`embed-ui` feature, or a test fixture).
    Embedded(&'static include_dir::Dir<'static>),
    /// No UI: a placeholder page.
    None,
}

/// `ui_dir` wins; otherwise the embedded UI when the binary carries one; otherwise a placeholder.
pub fn build(state: AppState, ui_dir: Option<PathBuf>) -> AxumRouter {
    let ui = match ui_dir {
        Some(dir) => UiSource::Dir(dir),
        #[cfg(feature = "embed-ui")]
        None => UiSource::Embedded(&crate::ui_embed::UI_DIST),
        #[cfg(not(feature = "embed-ui"))]
        None => UiSource::None,
    };
    build_with_ui(state, ui)
}

pub fn build_with_ui(state: AppState, ui: UiSource) -> AxumRouter {
    let api = AxumRouter::new()
        .route("/health", get(api::health))
        .route("/auth/login", post(auth::login))
        .route("/auth/logout", post(auth::logout))
        .route("/auth/me", get(auth::me))
        .route("/vehicles", get(api::list_vehicles))
        .route("/vehicles/{sysid}", get(api::get_vehicle))
        .route("/vehicles/{sysid}/confirm", post(commands::confirm))
        .route("/vehicles/{sysid}/command", post(commands::command))
        .route("/ai/status", get(crate::ai_api::status))
        .route("/ai/chat", post(crate::ai_api::chat))
        .route("/ai/proposals/{id}/dismiss", post(crate::ai_api::dismiss))
        .route("/vehicles/{sysid}/guided", post(guided::guided))
        .route(
            "/guard/settings",
            get(crate::guard_api::get_settings).put(crate::guard_api::put_settings),
        )
        .route("/guard/alerts", get(crate::guard_api::alerts))
        .route("/guard/alerts/{id}/cancel", post(crate::guard_api::cancel))
        .route("/guard/decisions", get(crate::guard_api::decisions))
        .route("/env/factors", get(crate::env_api::factors))
        .route("/env/sources", get(crate::env_api::sources))
        .route(
            "/env/sources/{id}",
            axum::routing::put(crate::env_api::put_source),
        )
        .route("/env/sources/{id}/fetch", post(crate::env_api::fetch))
        .route(
            "/env/settings",
            get(crate::env_api::get_settings).put(crate::env_api::put_settings),
        )
        .route(
            "/vehicles/{sysid}/mission",
            get(mission_api::get_mission).put(mission_api::put_mission),
        )
        .route(
            "/vehicles/{sysid}/mission/upload",
            post(mission_api::upload_saved),
        )
        .route(
            "/vehicles/{sysid}/mission/progress",
            get(mission_api::get_progress),
        )
        .route("/vehicles/{sysid}/mission/known", get(mission_api::get_known))
        .route(
            "/vehicles/{sysid}/fence",
            get(geofence_api::get_fence).put(geofence_api::put_fence),
        )
        .route(
            "/vehicles/{sysid}/fence/params",
            get(geofence_api::get_fence_params),
        )
        .route(
            "/vehicles/{sysid}/rally",
            get(geofence_api::get_rally).put(geofence_api::put_rally),
        )
        .route(
            "/vehicles/{sysid}/params",
            get(param_api::list).put(param_api::write),
        )
        .route("/vehicles/{sysid}/params/refresh", post(param_api::refresh))
        .route("/vehicles/{sysid}/params/progress", get(param_api::progress))
        .route("/vehicles/{sysid}/params/pick", get(param_pick::pick))
        .route("/history/params", get(param_api::history))
        .route(
            "/vehicles/{sysid}/registry",
            get(logbook_api::get_registry).put(logbook_api::put_registry),
        )
        .route(
            "/users/me/pilot",
            get(logbook_api::get_my_pilot).put(logbook_api::put_my_pilot),
        )
        .route(
            "/inspection/templates",
            get(logbook_api::list_templates).post(logbook_api::create_template),
        )
        .route(
            "/inspection/templates/{id}",
            axum::routing::put(logbook_api::update_template).delete(logbook_api::delete_template),
        )
        .route(
            "/vehicles/{sysid}/inspections",
            get(logbook_api::list_inspections).post(logbook_api::create_inspection),
        )
        .route(
            "/vehicles/{sysid}/inspections/template",
            get(logbook_api::vehicle_template),
        )
        .route(
            "/vehicles/{sysid}/flights",
            get(flight_api::list_flights).post(flight_api::create_flight),
        )
        .route(
            "/vehicles/{sysid}/flights/{id}",
            axum::routing::patch(flight_api::patch_flight).delete(flight_api::delete_flight),
        )
        .route(
            "/vehicles/{sysid}/flights/{id}/squawks",
            post(flight_api::add_squawk),
        )
        .route(
            "/vehicles/{sysid}/maintenance",
            get(flight_api::list_maintenance).post(flight_api::create_maintenance),
        )
        .route(
            "/vehicles/{sysid}/calibration",
            get(calib_api::overview).post(calib_api::start),
        )
        .route("/vehicles/{sysid}/calibration/next", post(calib_api::next))
        .route("/vehicles/{sysid}/calibration/cancel", post(calib_api::cancel))
        .route("/vehicles/{sysid}/calibration/finish", post(calib_api::finish))
        .route("/vehicles/{sysid}/motor-test", post(calib_api::motor_test))
        .route("/vehicles/{sysid}/logs", get(logs_api::list))
        .route("/vehicles/{sysid}/logs/fc", get(logs_api::list_fc))
        .route("/vehicles/{sysid}/logs/fetch", post(logs_api::fetch))
        .route(
            "/vehicles/{sysid}/logs/upload",
            post(logs_api::upload).layer(DefaultBodyLimit::max(logs_api::MAX_UPLOAD_BYTES)),
        )
        .route(
            "/vehicles/{sysid}/logs/{id}",
            axum::routing::patch(logs_api::attach),
        )
        .route("/vehicles/{sysid}/logs/{id}/file", get(logs_api::file))
        .route("/vehicles/{sysid}/logbook/export", get(export_api::export))
        .route("/mavlink/inspector", get(inspector_api::list))
        .route("/network", get(network_api::get))
        .route(
            "/mavlink/inspector/{dir}/{sysid}/{compid}/{msg_id}",
            get(inspector_api::detail),
        )
        .route("/messages", get(messages_api::list_all))
        .route("/vehicles/{sysid}/messages", get(messages_api::list_vehicle))
        .route("/vehicles/{sysid}/messages/{id}/ack", post(messages_api::ack))
        .route("/plugins", get(plugin_api::list))
        .route("/plugins/{id}", put(plugin_api::set_enabled))
        .route(
            "/plugins/{p}/overlays/{o}/areas",
            get(overlay_api::list).post(overlay_api::create),
        )
        .route(
            "/plugins/{p}/overlays/{o}/areas/estimate",
            post(overlay_api::estimate),
        )
        .route(
            "/plugins/{p}/overlays/{o}/areas/{id}/refresh",
            post(overlay_api::refresh),
        )
        .route(
            "/plugins/{p}/overlays/{o}/areas/{id}",
            delete(overlay_api::delete),
        )
        .route(
            "/plugins/{p}/overlays/{o}/tiles/{z}/{x}/{y}",
            get(overlay_api::tile),
        )
        .route("/assignments", get(assignment_api::list_assignments))
        .route("/assignments/{sysid}", put(assignment_api::put_assignment))
        .route(
            "/missions",
            get(mission_api::list_missions).post(mission_api::create_mission),
        )
        .route(
            "/missions/{id}",
            get(mission_api::get_saved_mission)
                .put(mission_api::update_mission)
                .delete(mission_api::delete_mission),
        )
        .route("/missions/{id}/export", get(mission_api::export_mission))
        .route(
            "/missions/import",
            post(mission_api::import_mission).layer(DefaultBodyLimit::max(mission_api::MAX_IMPORT_BYTES)),
        )
        .route("/missions/validate", post(mission_api::validate_mission))
        .route(
            "/survey-cameras",
            get(survey_camera_api::list_survey_cameras).post(survey_camera_api::create_survey_camera),
        )
        .route(
            "/survey-cameras/{id}",
            axum::routing::put(survey_camera_api::update_survey_camera)
                .delete(survey_camera_api::delete_survey_camera),
        )
        .route("/vehicles/{sysid}/camera", get(camera_api::get_camera))
        .route("/vehicles/{sysid}/camera/command", post(camera_api::command))
        .route(
            "/vehicles/{sysid}/camera/profile",
            get(camera_api::get_profile).put(camera_api::put_profile),
        )
        .route(
            "/vehicles/{sysid}/roi/targets",
            get(roi_api::get_targets).put(roi_api::put_targets),
        )
        .route(
            "/vehicles/{sysid}/roi/control",
            get(roi_api::get_control).put(roi_api::put_control),
        )
        .route("/vehicles/{sysid}/roi/start", post(roi_api::start))
        .route("/vehicles/{sysid}/roi/stop", post(roi_api::stop))
        .route(
            "/vehicles/{sysid}/video/whep",
            post(video_api::whep).layer(DefaultBodyLimit::max(MAX_OFFER_BYTES)),
        )
        .route(
            "/vehicles/{sysid}/video/source",
            get(video_api::get_source).put(video_api::put_source),
        )
        .route("/history/audit", get(api::audit_history))
        .route(
            "/settings/app",
            get(settings::app_settings).put(settings::put_app_settings),
        )
        .route(
            "/settings/input/gimbal",
            get(input_api::get_gimbal).put(input_api::put_gimbal),
        )
        .route(
            "/settings/presentation/tokens",
            get(present_api::list_tokens).post(present_api::create_token),
        )
        .route(
            "/settings/presentation/tokens/{prefix}",
            delete(present_api::revoke_token),
        )
        .route(
            "/settings/branding/logo",
            axum::routing::put(branding::put_logo)
                .delete(branding::delete_logo)
                .layer(DefaultBodyLimit::max(branding::MAX_LOGO_BYTES + 1024)),
        )
        .layer(middleware::from_fn(auth::csrf_guard));
    let present = AxumRouter::new()
        .route("/config", get(present_api::config))
        .route("/vehicle", get(present_api::vehicle))
        .route("/logo", get(present_api::logo))
        .route(
            "/whep",
            post(present_api::whep).layer(DefaultBodyLimit::max(MAX_OFFER_BYTES)),
        )
        .layer(middleware::from_fn_with_state(
            state.clone(),
            present_api::require_token,
        ));
    let app = AxumRouter::new()
        .nest("/api", api)
        .nest("/present", present)
        .route("/ws", get(ws::handler));
    let app = match ui {
        UiSource::Dir(dir) => {
            app.fallback_service(ServeDir::new(&dir).fallback(ServeFile::new(dir.join("index.html"))))
        }
        UiSource::Embedded(dir) => {
            app.fallback(move |req: axum::extract::Request| async move { crate::ui_embed::serve(dir, &req) })
        }
        UiSource::None => app.fallback(placeholder),
    };
    app.layer(TraceLayer::new_for_http()).with_state(state)
}

async fn placeholder() -> Html<&'static str> {
    Html("<!doctype html><title>RGCS</title><p>RGCS server is running. Build the UI and set <code>ui_dir</code> in config.toml.")
}

#[cfg(test)]
mod tests {
    use super::*;
    use rgcs_store::Store;

    async fn state() -> AppState {
        let store = Store::open_memory().await.unwrap();
        let (tx, _rx) = broadcast::channel(8);
        let (queue, _queue_rx) = mpsc::channel(1);
        AppState::new(Arc::new(Mutex::new(Router::default())), tx, store, queue, true)
    }

    #[tokio::test]
    async fn login_guard_reset_keeps_guards_that_are_in_flight() {
        let app = state().await;
        let alice = app.login_guard("alice");
        let _held = alice.lock().await;
        for i in 0..=MAX_LOGIN_GUARDS {
            app.login_guard(&format!("user{i}"));
        }
        // The map was reset while alice's attempt is still running …
        let again = app.login_guard("alice");
        // … so a concurrent attempt for alice must get the very same mutex.
        assert!(Arc::ptr_eq(&alice, &again));
        assert!(app.login_guards.lock().unwrap().len() <= MAX_LOGIN_GUARDS + 2);
    }
}
