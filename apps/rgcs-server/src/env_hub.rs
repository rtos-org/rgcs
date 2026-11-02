//! External-factor hub.
//!
//! - A 1 s scheduler starts each due source on its own task; nothing external is fetched
//!   unless the guard is enabled with consent 1 and consent 2 (`external_data`).
//! - Readings are kept per (source, rounded cell). Fusion runs after every fetch and every
//!   10 s, together with the vehicle's own wind / GNSS and the local sun / WMM readings.
//! - The guard only ever reads the latest Kp level through `GuardHub::set_context`; a hanging
//!   fetch never blocks it (review focus 4).

use std::collections::HashMap;
use std::sync::{Arc, Mutex as StdMutex, MutexGuard, OnceLock};
use std::time::Duration;

use rgcs_core::{EnvSettings, EnvSourceStatus, EnvSummary, ServerMessage, SysId, VehicleState};
use rgcs_env::{Note, Reading, SourceId, Station};
use rgcs_guard::ExternalContext;
use rgcs_mavlink::{GuardBody, GuardFrame, Router};
use rgcs_store::env_sources::EnvSourceRow;
use rgcs_store::Store;
use tokio::sync::{broadcast, Mutex};

use crate::app::AppState;
use crate::env_fetch::{fetch_source, key_hint, Cell, EnvEndpoints, EnvKeys, Fetched, Plan};
use crate::env_view::{self as view, SourceCfg};
use crate::guard_hub::GuardHub;

const TICK: Duration = Duration::from_secs(1);
/// Fusion re-runs at least this often (vehicle / local readings age).
const FUSE_EVERY_MS: u64 = 10_000;

type ClockFn = Arc<dyn Fn() -> u64 + Send + Sync>;

#[derive(Debug, Clone)]
struct SourceState {
    cfg: SourceCfg,
    last_ok_ms: Option<u64>,
    last_error: Option<String>,
    next_due_ms: Option<u64>,
    in_flight: bool,
}

struct EnvState {
    sources: HashMap<SourceId, SourceState>,
    /// Latest readings per (source, cell key); `""` for location-free sources.
    readings: HashMap<(SourceId, String), Vec<Reading>>,
    notes: Vec<Note>,
    table: Option<(u64, Vec<Station>)>,
    settings: EnvSettings,
    wind: HashMap<SysId, Reading>,
    summary: EnvSummary,
    last_fuse_ms: u64,
}

impl EnvState {
    fn new() -> Self {
        let sources = SourceId::EXTERNAL
            .into_iter()
            .map(|id| {
                let st = SourceState {
                    cfg: view::default_cfg(id),
                    last_ok_ms: None,
                    last_error: None,
                    next_due_ms: None,
                    in_flight: false,
                };
                (id, st)
            })
            .collect();
        Self {
            sources,
            readings: HashMap::new(),
            notes: Vec::new(),
            table: None,
            settings: view::default_settings(),
            wind: HashMap::new(),
            summary: EnvSummary {
                cell: None,
                factors: Vec::new(),
                missing: Vec::new(),
                unavailable: false,
                notes: Vec::new(),
                ts: 0,
            },
            last_fuse_ms: 0,
        }
    }
}

/// What the hub reads from `AppState` (no `EnvHub` inside, so no cycle).
#[derive(Clone)]
struct EnvIo {
    router: Arc<Mutex<Router>>,
    params: crate::params::ParamCache,
}

#[derive(Clone)]
pub struct EnvHub {
    inner: Arc<StdMutex<EnvState>>,
    endpoints: Arc<EnvEndpoints>,
    keys: Arc<EnvKeys>,
    tx: broadcast::Sender<ServerMessage>,
    guard: GuardHub,
    client: reqwest::Client,
    clock: ClockFn,
    io: Arc<OnceLock<EnvIo>>,
}

impl EnvHub {
    pub fn new(
        endpoints: EnvEndpoints,
        keys: EnvKeys,
        tx: broadcast::Sender<ServerMessage>,
        guard: GuardHub,
    ) -> Self {
        Self {
            inner: Arc::new(StdMutex::new(EnvState::new())),
            endpoints: Arc::new(endpoints),
            keys: Arc::new(keys),
            tx,
            guard,
            client: crate::env_fetch::client(),
            clock: Arc::new(crate::app::unix_ms),
            io: Arc::new(OnceLock::new()),
        }
    }

    /// Replaces the wall clock (Unix ms); tests drive freshness by hand.
    pub fn with_clock(self, clock: ClockFn) -> Self {
        Self { clock, ..self }
    }

    /// The guard hub that receives the `ExternalContext`.
    pub fn with_guard(self, guard: GuardHub) -> Self {
        Self { guard, ..self }
    }

    pub fn endpoints(&self) -> &EnvEndpoints {
        &self.endpoints
    }

    pub fn now_ms(&self) -> u64 {
        (self.clock)()
    }

    fn lock(&self) -> MutexGuard<'_, EnvState> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Stored settings and per-source overrides (absent → defaults; invalid → defaults).
    pub async fn load(&self, store: &Store) {
        let settings = match store.app_setting(rgcs_store::app_settings::ENV_SETTINGS).await {
            Ok(Some(text)) => serde_json::from_str::<EnvSettings>(&text)
                .ok()
                .filter(|s| view::validate_settings(s).is_ok()),
            _ => None,
        };
        if let Some(s) = settings {
            self.apply_settings(s);
        }
        for id in SourceId::EXTERNAL {
            if let Ok(Some(row)) = store.env_source(id.as_str()).await {
                let cfg = SourceCfg {
                    enabled: row.enabled,
                    interval_s: row.interval_s,
                    timeout_ms: row.timeout_ms,
                };
                let valid = view::apply_source_put(cfg, &view::SourcePut::default()).is_ok();
                if valid {
                    self.set_source(id, cfg);
                }
            }
        }
    }

    pub async fn save_source(store: &Store, id: SourceId, cfg: SourceCfg) -> rgcs_store::Result<()> {
        let row = EnvSourceRow {
            id: id.as_str().into(),
            enabled: cfg.enabled,
            interval_s: cfg.interval_s,
            timeout_ms: cfg.timeout_ms,
        };
        store.put_env_source(&row).await
    }

    pub async fn save_settings(store: &Store, s: &EnvSettings) -> rgcs_store::Result<()> {
        let text = serde_json::to_string(s).unwrap_or_default();
        store
            .put_app_setting(rgcs_store::app_settings::ENV_SETTINGS, &text)
            .await
    }

    /// Reads vehicles and parameters from `app`. Idempotent.
    pub fn attach(&self, app: &AppState) {
        let _ = self.io.set(EnvIo {
            router: app.router.clone(),
            params: app.params.clone(),
        });
    }

    /// `attach`, then the guard-tap consumer (vehicle wind) and the 1 s scheduler.
    pub fn spawn(&self, app: AppState, mut frames: broadcast::Receiver<GuardFrame>) {
        self.attach(&app);
        let hub = self.clone();
        tokio::spawn(async move {
            loop {
                match frames.recv().await {
                    Ok(f) => hub.on_frame(&f),
                    Err(broadcast::error::RecvError::Lagged(_)) => {}
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
        });
        let hub = self.clone();
        tokio::spawn(async move {
            let mut ticker = tokio::time::interval(TICK);
            ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            loop {
                ticker.tick().await;
                hub.step().await;
            }
        });
    }

    /// `WIND` from the vehicle (Measured).
    pub fn on_frame(&self, f: &GuardFrame) {
        if let GuardBody::Wind { dir_deg, speed } = f.body {
            let r = view::wind_reading(dir_deg, speed, self.now_ms());
            self.lock().wind.insert(f.sysid, r);
        }
    }

    /// Whether anything may be fetched from outside: `guard_disabled` /
    /// `consent_required`.
    pub fn gate(&self) -> Result<(), &'static str> {
        let g = self.guard.settings();
        if !g.enabled || !g.consent.monitoring {
            return Err("guard_disabled");
        }
        if !g.consent.external_data {
            return Err("consent_required");
        }
        Ok(())
    }

    /// One scheduler tick: start every due, enabled source on its own task; re-fuse every 10 s.
    pub async fn step(&self) {
        let now = self.now_ms();
        if self.gate().is_ok() {
            for id in self.claim_due(now) {
                let hub = self.clone();
                tokio::spawn(async move { hub.run_fetch(id).await });
            }
        }
        let fuse_due = now.saturating_sub(self.lock().last_fuse_ms) >= FUSE_EVERY_MS;
        if fuse_due {
            self.refresh().await;
        }
    }

    /// Marks due sources in flight and returns them.
    fn claim_due(&self, now: u64) -> Vec<SourceId> {
        let mut st = self.lock();
        st.sources
            .iter_mut()
            .filter(|(_, s)| s.cfg.enabled && !s.in_flight && s.next_due_ms.is_none_or(|d| now >= d))
            .map(|(id, s)| {
                s.in_flight = true;
                *id
            })
            .collect()
    }

    /// Fetches `id` now (admin 今すぐ取得). Refused by the gate → the status, unchanged, and no
    /// request.
    pub async fn fetch_now(&self, id: SourceId) -> EnvSourceStatus {
        if self.gate().is_ok() && id.is_external() {
            self.run_fetch(id).await;
        }
        self.source(id)
    }

    async fn run_fetch(&self, id: SourceId) {
        let vehicles = self.vehicles().await;
        let (cfg, step, table) = {
            let st = self.lock();
            let cfg = st
                .sources
                .get(&id)
                .map(|s| s.cfg)
                .unwrap_or(view::default_cfg(id));
            (cfg, st.settings.rounding_deg, st.table.clone())
        };
        let cells = view::cells(&view::positions(&vehicles), step);
        let now = self.now_ms();
        let plan = Plan {
            endpoints: &self.endpoints,
            keys: &self.keys,
            timeout: Duration::from_millis(u64::from(cfg.timeout_ms)),
            now_ms: now,
            cells: &cells,
            table,
        };
        let result = fetch_source(&self.client, id, plan).await;
        self.record(id, now, result);
        self.refresh().await;
    }

    fn record(&self, id: SourceId, now: u64, result: Result<Fetched, String>) {
        let mut st = self.lock();
        let ok = match result {
            Ok(f) => {
                if f.table.is_some() {
                    st.table = f.table;
                }
                if id == SourceId::SwpcAlerts {
                    st.notes = f.notes;
                }
                st.readings.retain(|(s, _), _| *s != id);
                for (cell, readings) in f.per_cell {
                    st.readings.insert((id, cell), readings);
                }
                None
            }
            Err(code) => Some(code),
        };
        if let Some(s) = st.sources.get_mut(&id) {
            if ok.is_none() {
                s.last_ok_ms = Some(now);
            }
            s.last_error = ok;
            s.next_due_ms = Some(now + u64::from(s.cfg.interval_s) * 1000);
            s.in_flight = false;
        }
    }

    async fn vehicles(&self) -> Vec<VehicleState> {
        match self.io.get() {
            Some(io) => io.router.lock().await.states(),
            None => Vec::new(),
        }
    }

    /// Vehicle wind / GNSS and local WMM / sun readings at `now`.
    fn local_readings(&self, vehicles: &[VehicleState], now: u64) -> Vec<Reading> {
        let params = self.io.get().map(|io| io.params.clone());
        let decl = vehicles.iter().filter_map(|v| {
            let p = params.as_ref()?;
            let dec = p.get(v.sysid, "COMPASS_DEC");
            view::declination_reading(v, dec, p.get(v.sysid, "COMPASS_AUTODEC"), now)
        });
        let sun = view::positions(vehicles)
            .first()
            .and_then(|&(lat, lon)| view::daylight_reading(lat, lon, now));
        let wind: Vec<Reading> = self.lock().wind.values().cloned().collect();
        view::gnss_readings(vehicles, now)
            .into_iter()
            .chain(decl)
            .chain(sun)
            .chain(wind)
            .collect()
    }

    /// Re-fuses everything, broadcasts `env_summary` and hands the Kp level to the guard.
    pub async fn refresh(&self) {
        let vehicles = self.vehicles().await;
        let now = self.now_ms();
        let open = self.gate().is_ok();
        let local = self.local_readings(&vehicles, now);
        let summary = {
            let mut st = self.lock();
            let summary = build_summary(&st, &vehicles, local, open, now);
            st.summary = summary.clone();
            st.last_fuse_ms = now;
            summary
        };
        let kp = summary
            .factors
            .iter()
            .find(|f| f.kind == "kp")
            .filter(|f| f.value.is_some());
        let ctx = ExternalContext {
            kp: kp.map(|f| match f.level {
                rgcs_core::EnvLevel::Ok => rgcs_guard::ExtLevel::Ok,
                rgcs_core::EnvLevel::Warn => rgcs_guard::ExtLevel::Warn,
                rgcs_core::EnvLevel::Strong => rgcs_guard::ExtLevel::Strong,
            }),
        };
        self.guard.set_context(ctx);
        let _ = self.tx.send(ServerMessage::EnvSummary { summary });
    }

    pub fn summary(&self) -> EnvSummary {
        self.lock().summary.clone()
    }

    pub fn sources(&self) -> Vec<EnvSourceStatus> {
        SourceId::EXTERNAL.into_iter().map(|id| self.source(id)).collect()
    }

    pub fn source(&self, id: SourceId) -> EnvSourceStatus {
        let st = self.lock();
        let s = st.sources.get(&id);
        let key = self.keys.for_source(id);
        let cfg = s.map(|s| s.cfg).unwrap_or(view::default_cfg(id));
        EnvSourceStatus {
            id: id.as_str().into(),
            label: view::label(id).into(),
            enabled: cfg.enabled,
            needs_key: id == SourceId::Openweathermap,
            key_configured: key.is_some(),
            key_hint: key.map(key_hint),
            uses_location: id.uses_location(),
            interval_s: cfg.interval_s,
            timeout_ms: cfg.timeout_ms,
            last_ok_ms: s.and_then(|s| s.last_ok_ms),
            last_error: s.and_then(|s| s.last_error.clone()),
            next_due_ms: s.and_then(|s| s.next_due_ms),
            terms: view::terms(id).into(),
        }
    }

    pub fn source_cfg(&self, id: SourceId) -> SourceCfg {
        self.lock()
            .sources
            .get(&id)
            .map(|s| s.cfg)
            .unwrap_or(view::default_cfg(id))
    }

    /// New settings for one source. A shorter interval takes effect at the next tick.
    pub fn set_source(&self, id: SourceId, cfg: SourceCfg) {
        let mut st = self.lock();
        if let Some(s) = st.sources.get_mut(&id) {
            let next_due_ms = s.last_ok_ms.map(|t| t + u64::from(cfg.interval_s) * 1000);
            *s = SourceState {
                cfg,
                next_due_ms: next_due_ms.or(s.next_due_ms),
                ..s.clone()
            };
        }
    }

    pub fn settings(&self) -> EnvSettings {
        self.lock().settings.clone()
    }

    pub fn apply_settings(&self, s: EnvSettings) {
        self.lock().settings = s;
    }
}

/// The fused summary. While the gate is closed, external readings are left out (and no
/// external source counts as enabled), so the guard gets no external context.
fn build_summary(
    st: &EnvState,
    vehicles: &[VehicleState],
    local: Vec<Reading>,
    open: bool,
    now: u64,
) -> EnvSummary {
    let enabled: Vec<SourceId> = SourceId::EXTERNAL
        .into_iter()
        .filter(|id| open && st.sources.get(id).is_some_and(|s| s.cfg.enabled))
        .collect();
    let failed: Vec<SourceId> = enabled
        .iter()
        .copied()
        .filter(|id| st.sources.get(id).is_some_and(|s| s.last_error.is_some()))
        .collect();
    let external = st
        .readings
        .iter()
        .filter(|((id, _), _)| enabled.contains(id))
        .flat_map(|(_, rs)| rs.iter().cloned());
    let readings: Vec<Reading> = local.into_iter().chain(external).collect();
    let th = view::thresholds_for(&st.settings, vehicles);
    let fused = rgcs_env::fuse(&readings, &th, &enabled, &failed, now);
    let cell = view::cells(&view::positions(vehicles), st.settings.rounding_deg)
        .first()
        .map(Cell::coords);
    let notes = if enabled.contains(&SourceId::SwpcAlerts) {
        st.notes.iter().map(note_text).collect()
    } else {
        Vec::new()
    };
    EnvSummary {
        cell,
        factors: view::factors(&fused),
        missing: fused.missing.iter().map(|s| s.as_str().to_string()).collect(),
        unavailable: fused.unavailable,
        notes,
        ts: now,
    }
}

/// `"K07A 2026-10-25T03:12Z — <untrusted text>"`.
fn note_text(n: &Note) -> String {
    let at = time::OffsetDateTime::from_unix_timestamp((n.at_ms / 1000) as i64)
        .map(|t| {
            format!(
                "{:04}-{:02}-{:02}T{:02}:{:02}Z",
                t.year(),
                u8::from(t.month()),
                t.day(),
                t.hour(),
                t.minute()
            )
        })
        .unwrap_or_default();
    format!("{} {at} — {}", n.id, n.untrusted_text)
}

#[cfg(test)]
#[path = "env_tests.rs"]
mod tests;
