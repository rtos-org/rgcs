//! In-process test harness: in-memory store, a bare `Router`, and a stub command queue that
//! accepts everything. Shared by the integration tests under `tests/`.
#![allow(dead_code)]
#![allow(deprecated)] // MISSION_REQUEST: the fake vehicle can speak the legacy protocol

use std::sync::Arc;

use axum::body::Body;
use axum::http::{header, HeaderMap, Method, Request, StatusCode};
use axum::Router as AxumRouter;
use http_body_util::BodyExt;
use mavlink::dialects::ardupilotmega::{
    GpsFixType, MavAutopilot, MavMessage, MavMissionResult, MavMissionType, MavModeFlag, MavState, MavType,
    GLOBAL_POSITION_INT_DATA, GPS_RAW_INT_DATA, HEARTBEAT_DATA, LOG_DATA_DATA, LOG_ENTRY_DATA,
    MISSION_ACK_DATA, MISSION_COUNT_DATA, MISSION_ITEM_INT_DATA, MISSION_REQUEST_DATA,
    MISSION_REQUEST_INT_DATA,
};
use mavlink::MavHeader;
use rgcs_camera::mavlink_cam::fake::{FakeConfig, FakeMav};
use rgcs_camera::siyi::sim::SimServer;
use rgcs_core::ParamEntry;
use rgcs_mavlink::{Clock, Outcome, Outgoing, QueuedCommand, Router};
use rgcs_mavlink::{LogFrame, MissionFrame};
use rgcs_server::app::{self, AppState, BROADCAST_CAPACITY};
use rgcs_server::cameras::{CameraFactory, CameraManager};
use rgcs_server::logs::LogHub;
use rgcs_server::missions::MissionHub;
use rgcs_server::params::ParamCache;
use rgcs_store::Store;
use serde_json::Value;
use tokio::sync::{broadcast, mpsc, Mutex};
use tower::ServiceExt;

pub const CSRF: (&str, &str) = ("x-requested-with", "rgcs");

pub async fn spawn_app() -> (AxumRouter, AppState) {
    let (app, state, _rx) = spawn_app_with_link().await;
    (app, state)
}

/// Like `spawn_app`, but also hands back the receiver of frames sent straight to the link.
pub async fn spawn_app_with_link() -> (AxumRouter, AppState, mpsc::Receiver<Outgoing>) {
    spawn_app_full(None).await
}

/// `spawn_app_with_link` that also hands back every command the queue accepted, in order.
pub async fn spawn_app_recording() -> (
    AxumRouter,
    AppState,
    mpsc::UnboundedReceiver<rgcs_core::VehicleCommand>,
    mpsc::Receiver<Outgoing>,
) {
    let (rec_tx, rec_rx) = mpsc::unbounded_channel();
    let (app, state, out) = spawn_app_inner(None, Some(rec_tx)).await;
    (app, state, rec_rx, out)
}

/// `spawn_app` plus an MT11 simulator the camera manager connects to instead of the profile host.
pub async fn spawn_app_with_sim() -> (AxumRouter, AppState, SimServer) {
    let sim = SimServer::start().await;
    let (app, state, _rx) = spawn_app_full(Some(sim.addr)).await;
    (app, state, sim)
}

/// `spawn_app` whose MAVLink camera driver talks to a fake ArduPilot camera / gimbal manager.
pub async fn spawn_app_with_fake_mav(cfg: FakeConfig) -> (AxumRouter, AppState, FakeMav) {
    let fake = FakeMav::start(1, cfg);
    let (_app, state, _rx) = spawn_app_full(None).await;
    let state = state.with_mav_port(fake.port());
    (app::build(state.clone(), None), state, fake)
}

/// `spawn_app` with the WHEP relay pointed at `upstream` (a fake MediaMTX in tests).
pub async fn spawn_app_with_whep(upstream: &str) -> (AxumRouter, AppState) {
    let (_app, state, _rx) = spawn_app_full(None).await;
    let state = state.with_whep_upstream(upstream);
    (app::build(state.clone(), None), state)
}

/// Unique scratch directory for branding files etc.
pub fn temp_data_dir() -> std::path::PathBuf {
    let dir = std::env::temp_dir().join(format!("rgcs-test-{}", uuid::Uuid::new_v4().simple()));
    std::fs::create_dir_all(&dir).expect("temp data dir");
    dir
}

/// Logs in as `username` / `password` and returns the cookie pair.
pub async fn login_as(app: &AxumRouter, username: &str, password: &str) -> String {
    let (status, _, headers) = call(
        app,
        req(
            Method::POST,
            "/api/auth/login",
            None,
            Some(login_body(username, password)),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "login as {username}");
    cookie_pair(&headers)
}

async fn spawn_app_full(
    sim: Option<std::net::SocketAddr>,
) -> (AxumRouter, AppState, mpsc::Receiver<Outgoing>) {
    spawn_app_inner(sim, None).await
}

async fn spawn_app_inner(
    sim: Option<std::net::SocketAddr>,
    record: Option<mpsc::UnboundedSender<rgcs_core::VehicleCommand>>,
) -> (AxumRouter, AppState, mpsc::Receiver<Outgoing>) {
    let (outgoing_tx, outgoing_rx) = mpsc::channel::<Outgoing>(16);
    let store = Store::open_memory().await.expect("memory store");
    let dev_mode = store.dev_mode().await.expect("dev_mode");
    let router = Arc::new(Mutex::new(Router::default()));
    let (tx, _keep) = broadcast::channel(BROADCAST_CAPACITY);
    let (queue_tx, mut queue_rx) = mpsc::channel::<QueuedCommand>(8);
    tokio::spawn(async move {
        while let Some(job) = queue_rx.recv().await {
            if let Some(r) = &record {
                let _ = r.send(job.cmd.clone());
            }
            let _ = job.done.send(Outcome::Accepted);
        }
    });
    // Keep one receiver alive so `broadcast::send` succeeds like it does in production.
    tokio::spawn(async move {
        let mut rx = _keep;
        while rx.recv().await.is_ok() {}
    });
    let factory = sim.map_or(CameraFactory::Real, CameraFactory::Sim);
    let cameras = CameraManager::new(store.clone(), tx.clone(), factory);
    let state = AppState::new(router, tx, store, queue_tx, dev_mode)
        .with_outgoing(outgoing_tx)
        .with_cameras(cameras)
        .with_data_dir(temp_data_dir());
    (app::build(state.clone(), None), state, outgoing_rx)
}

/// ArduCopter custom mode numbers used by the tests.
pub const COPTER_STABILIZE: u32 = 0;
pub const COPTER_GUIDED: u32 = 4;

pub fn seed_param(app: &AppState, sysid: u8, name: &str, value: f32) {
    app.params.set(sysid, name, value);
}

/// Registers an ArduCopter flight controller for `sysid`; `lost` ages the link past 10 s.
pub async fn seed_vehicle(app: &AppState, sysid: u8, armed: bool, lost: bool) {
    seed_copter(app, sysid, COPTER_STABILIZE, armed, lost).await;
}

pub async fn seed_copter(app: &AppState, sysid: u8, custom_mode: u32, armed: bool, lost: bool) {
    seed_type(app, sysid, MavType::MAV_TYPE_QUADROTOR, custom_mode, armed, lost).await;
}

/// A disarmed ArduRover in HOLD (custom mode 4).
pub async fn seed_rover(app: &AppState, sysid: u8) {
    seed_type(app, sysid, MavType::MAV_TYPE_GROUND_ROVER, 4, false, false).await;
}

async fn seed_type(app: &AppState, sysid: u8, mavtype: MavType, custom_mode: u32, armed: bool, lost: bool) {
    let header = MavHeader {
        system_id: sysid,
        component_id: 1,
        sequence: 0,
    };
    let mut base_mode = MavModeFlag::MAV_MODE_FLAG_CUSTOM_MODE_ENABLED;
    if armed {
        base_mode |= MavModeFlag::MAV_MODE_FLAG_SAFETY_ARMED;
    }
    let hb = HEARTBEAT_DATA {
        custom_mode,
        mavtype,
        autopilot: MavAutopilot::MAV_AUTOPILOT_ARDUPILOTMEGA,
        base_mode,
        system_status: MavState::MAV_STATE_ACTIVE,
        mavlink_version: 3,
    };
    let mut router = app.router.lock().await;
    router.on_message(&header, &MavMessage::HEARTBEAT(hb), Clock::default());
    if lost {
        router.tick(Clock {
            mono_ms: 11_000,
            unix_ms: 11_000,
        });
    }
}

/// Gives `sysid` a position (degrees) and a GPS fix type (3 = 3D).
pub async fn seed_position(app: &AppState, sysid: u8, lat: f64, lon: f64, fix: u8) {
    let header = MavHeader {
        system_id: sysid,
        component_id: 1,
        sequence: 0,
    };
    let pos = GLOBAL_POSITION_INT_DATA {
        lat: (lat * 1e7) as i32,
        lon: (lon * 1e7) as i32,
        ..GLOBAL_POSITION_INT_DATA::DEFAULT
    };
    let gps = GPS_RAW_INT_DATA {
        fix_type: match fix {
            0 => GpsFixType::GPS_FIX_TYPE_NO_GPS,
            1 => GpsFixType::GPS_FIX_TYPE_NO_FIX,
            2 => GpsFixType::GPS_FIX_TYPE_2D_FIX,
            _ => GpsFixType::GPS_FIX_TYPE_3D_FIX,
        },
        satellites_visible: 12,
        ..GPS_RAW_INT_DATA::DEFAULT
    };
    let mut router = app.router.lock().await;
    router.on_message(&header, &MavMessage::GLOBAL_POSITION_INT(pos), Clock::default());
    router.on_message(&header, &MavMessage::GPS_RAW_INT(gps), Clock::default());
}

/// Gives `sysid` a position with altitude (mm MSL) and heading (cdeg; 65535 = unknown).
pub async fn seed_pose(app: &AppState, sysid: u8, lat: f64, lon: f64, alt_mm: i32, hdg_cdeg: u16) {
    let header = MavHeader {
        system_id: sysid,
        component_id: 1,
        sequence: 0,
    };
    let pos = GLOBAL_POSITION_INT_DATA {
        lat: (lat * 1e7) as i32,
        lon: (lon * 1e7) as i32,
        alt: alt_mm,
        hdg: hdg_cdeg,
        ..GLOBAL_POSITION_INT_DATA::DEFAULT
    };
    let mut router = app.router.lock().await;
    router.on_message(&header, &MavMessage::GLOBAL_POSITION_INT(pos), Clock::default());
}

pub fn req(method: Method, path: &str, cookie: Option<&str>, json: Option<Value>) -> Request<Body> {
    build(method, path, cookie, json, true)
}

pub fn req_nocsrf(method: Method, path: &str, json: Option<Value>) -> Request<Body> {
    build(method, path, None, json, false)
}

fn build(method: Method, path: &str, cookie: Option<&str>, json: Option<Value>, csrf: bool) -> Request<Body> {
    let mut b = Request::builder().method(method).uri(path);
    if csrf {
        b = b.header(CSRF.0, CSRF.1);
    }
    if let Some(c) = cookie {
        b = b.header(header::COOKIE, c);
    }
    match json {
        Some(v) => b
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(v.to_string()))
            .expect("request"),
        None => b.body(Body::empty()).expect("request"),
    }
}

pub async fn call(app: &AxumRouter, request: Request<Body>) -> (StatusCode, Value, HeaderMap) {
    let res = app.clone().oneshot(request).await.expect("response");
    let status = res.status();
    let headers = res.headers().clone();
    let bytes = res.into_body().collect().await.expect("body").to_bytes();
    let json = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
    (status, json, headers)
}

pub fn login_body(username: &str, password: &str) -> Value {
    serde_json::json!({ "username": username, "password": password })
}

/// Logs in as admin/admin and returns the `rgcs_session=<token>` cookie pair.
pub async fn login(app: &AxumRouter) -> String {
    let (status, _, headers) = call(
        app,
        req(
            Method::POST,
            "/api/auth/login",
            None,
            Some(login_body("admin", "admin")),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "login should succeed");
    cookie_pair(&headers)
}

pub fn cookie_pair(headers: &HeaderMap) -> String {
    headers
        .get(header::SET_COOKIE)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.split(';').next())
        .map(str::to_string)
        .expect("Set-Cookie with rgcs_session")
}

pub fn error_code(body: &Value) -> &str {
    body["error"]["code"].as_str().unwrap_or("")
}

/// How the fake vehicle behaves during a mission transaction.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FakeMode {
    Normal,
    /// Asks with the deprecated MISSION_REQUEST instead of MISSION_REQUEST_INT.
    Legacy,
    /// Consumes every frame and never answers.
    Silent,
    /// Completes the transfer but answers MISSION_ACK with MAV_MISSION_ERROR.
    RejectAck,
}

const GCS: u8 = 255;
const GCS_COMP: u8 = 190;
const MISSION: MavMissionType = MavMissionType::MAV_MISSION_TYPE_MISSION;

#[allow(deprecated)]
fn fake_request(seq: u16, mode: FakeMode, mission_type: MavMissionType) -> MissionFrame {
    if mode == FakeMode::Legacy {
        MissionFrame::Request(MISSION_REQUEST_DATA {
            seq,
            target_system: GCS,
            target_component: GCS_COMP,
            mission_type,
        })
    } else {
        MissionFrame::RequestInt(MISSION_REQUEST_INT_DATA {
            seq,
            target_system: GCS,
            target_component: GCS_COMP,
            mission_type,
        })
    }
}

fn fake_ack(result: MavMissionResult, mission_type: MavMissionType) -> MissionFrame {
    MissionFrame::Ack(MISSION_ACK_DATA {
        target_system: GCS,
        target_component: GCS_COMP,
        mavtype: result,
        mission_type,
        opaque_id: 0,
    })
}

/// A vehicle on the other end of the `outgoing` channel: stores uploads, serves downloads.
/// Every list type (mission, fence, rally) goes to `stored`; replies echo the request's type.
pub fn fake_vehicle_mission(
    mut rx: mpsc::Receiver<Outgoing>,
    hub: MissionHub,
    sysid: u8,
    stored: Arc<std::sync::Mutex<Vec<MISSION_ITEM_INT_DATA>>>,
    mode: FakeMode,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut expected: u16 = 0;
        let mut kind = MISSION;
        let mut staging: Vec<MISSION_ITEM_INT_DATA> = Vec::new();
        while let Some(out) = rx.recv().await {
            if mode == FakeMode::Silent {
                continue;
            }
            match out.message {
                MavMessage::MISSION_COUNT(c) => {
                    expected = c.count;
                    kind = c.mission_type;
                    staging.clear();
                    hub.on_frame(sysid, fake_request(0, mode, kind));
                }
                MavMessage::MISSION_ITEM_INT(d) => {
                    staging.push(d);
                    if (staging.len() as u16) < expected {
                        hub.on_frame(sysid, fake_request(staging.len() as u16, mode, kind));
                    } else if mode == FakeMode::RejectAck {
                        hub.on_frame(sysid, fake_ack(MavMissionResult::MAV_MISSION_ERROR, kind));
                    } else {
                        *stored.lock().unwrap() = staging.clone();
                        hub.on_frame(sysid, fake_ack(MavMissionResult::MAV_MISSION_ACCEPTED, kind));
                    }
                }
                MavMessage::MISSION_REQUEST_LIST(r) => {
                    kind = r.mission_type;
                    let n = stored.lock().unwrap().len() as u16;
                    hub.on_frame(
                        sysid,
                        MissionFrame::Count(MISSION_COUNT_DATA {
                            count: n,
                            target_system: GCS,
                            target_component: GCS_COMP,
                            mission_type: kind,
                            opaque_id: 0,
                        }),
                    );
                }
                MavMessage::MISSION_REQUEST_INT(r) => {
                    let item = stored.lock().unwrap().get(r.seq as usize).cloned();
                    if let Some(mut d) = item {
                        d.target_system = GCS;
                        d.target_component = GCS_COMP;
                        d.mission_type = r.mission_type;
                        hub.on_frame(sysid, MissionFrame::ItemInt(d));
                    }
                }
                _ => {}
            }
        }
    })
}

/// How the fake vehicle answers parameter traffic.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FakeParamMode {
    Normal,
    /// These indexes are dropped from the PARAM_REQUEST_LIST stream (answered on index read).
    Gaps(Vec<u16>),
    /// PARAM_SET is swallowed: no echo.
    SilentSet,
    /// A PARAM_SET is first answered with the OLD value (as a list stream would), the real echo
    /// follows 200 ms later.
    StaleThenEcho,
}

pub const FAKE_PARAM_COUNT: u16 = 1200;

fn fake_param_entry(index: u16) -> ParamEntry {
    ParamEntry {
        name: format!("P{index:04}"),
        value: index as f32,
        index,
        ptype: 9,
    }
}

/// Streams a 1,200-parameter list, answers index reads and echoes PARAM_SET like ArduPilot.
/// `index_reads` counts PARAM_REQUEST_READ frames; `sets` counts PARAM_SET frames.
pub fn fake_vehicle_params(
    rx: mpsc::Receiver<Outgoing>,
    cache: ParamCache,
    sysid: u8,
    mode: FakeParamMode,
    index_reads: Arc<std::sync::atomic::AtomicUsize>,
) -> tokio::task::JoinHandle<()> {
    fake_vehicle_params_counting(
        rx,
        cache,
        sysid,
        mode,
        index_reads,
        Arc::new(std::sync::atomic::AtomicUsize::new(0)),
    )
}

pub fn fake_vehicle_params_counting(
    mut rx: mpsc::Receiver<Outgoing>,
    cache: ParamCache,
    sysid: u8,
    mode: FakeParamMode,
    index_reads: Arc<std::sync::atomic::AtomicUsize>,
    sets: Arc<std::sync::atomic::AtomicUsize>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut values: std::collections::HashMap<u16, ParamEntry> =
            (0..FAKE_PARAM_COUNT).map(|i| (i, fake_param_entry(i))).collect();
        while let Some(out) = rx.recv().await {
            match out.message {
                MavMessage::PARAM_REQUEST_LIST(_) => {
                    let gaps = match &mode {
                        FakeParamMode::Gaps(g) => g.clone(),
                        _ => Vec::new(),
                    };
                    for i in 0..FAKE_PARAM_COUNT {
                        if gaps.contains(&i) {
                            continue;
                        }
                        cache.on_value(sysid, values[&i].clone(), FAKE_PARAM_COUNT);
                    }
                }
                MavMessage::PARAM_REQUEST_READ(r) => {
                    index_reads.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                    let entry = if r.param_index >= 0 {
                        values.get(&(r.param_index as u16)).cloned()
                    } else {
                        let name = String::from_utf8_lossy(&*r.param_id)
                            .trim_end_matches('\0')
                            .to_string();
                        values.values().find(|e| e.name == name).cloned()
                    };
                    if let Some(e) = entry {
                        cache.on_value(sysid, e, FAKE_PARAM_COUNT);
                    }
                }
                MavMessage::PARAM_SET(d) => {
                    sets.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                    if mode == FakeParamMode::SilentSet {
                        continue;
                    }
                    let name = String::from_utf8_lossy(&*d.param_id)
                        .trim_end_matches('\0')
                        .to_string();
                    let index = values
                        .values()
                        .find(|e| e.name == name)
                        .map(|e| e.index)
                        .unwrap_or(0);
                    if mode == FakeParamMode::StaleThenEcho {
                        let old = values.get(&index).map(|e| e.value).unwrap_or(0.0);
                        let stale = ParamEntry {
                            name: name.clone(),
                            value: old,
                            index: u16::MAX,
                            ptype: 9,
                        };
                        cache.on_value(sysid, stale, FAKE_PARAM_COUNT);
                        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
                    }
                    let e = ParamEntry {
                        name,
                        value: d.param_value,
                        index,
                        ptype: 9,
                    };
                    values.insert(index, e.clone());
                    // ArduPilot's PARAM_SET echo carries param_index = -1 (65535).
                    cache.on_value(sysid, ParamEntry { index: u16::MAX, ..e }, FAKE_PARAM_COUNT);
                }
                _ => {}
            }
        }
    })
}

pub const FAKE_LOG_ID: u16 = 7;
pub const FAKE_LOG_TIME_UTC: u32 = 1_700_000_000;

/// Deterministic pseudo-random log bytes.
pub fn fake_log_bytes(len: usize) -> Vec<u8> {
    let mut x: u32 = 0x9E37_79B9;
    (0..len)
        .map(|_| {
            x ^= x << 13;
            x ^= x >> 17;
            x ^= x << 5;
            (x & 0xFF) as u8
        })
        .collect()
}

/// A flight controller on the other end of `outgoing` that owns exactly one DataFlash log
/// (`FAKE_LOG_ID`). LOG_REQUEST_LIST → one LOG_ENTRY; LOG_REQUEST_DATA → 90-byte LOG_DATA
/// frames. The chunk starting at `drop_first_chunk_at` is skipped the first time it is asked
/// for. `requests` counts every LOG_REQUEST_DATA by offset.
pub fn fake_vehicle_logs(
    mut rx: mpsc::Receiver<Outgoing>,
    hub: LogHub,
    sysid: u8,
    log: Vec<u8>,
    drop_first_chunk_at: Option<u32>,
    requests: Arc<std::sync::Mutex<Vec<u32>>>,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut dropped = false;
        while let Some(out) = rx.recv().await {
            match out.message {
                MavMessage::LOG_REQUEST_LIST(_) => hub.on_frame(
                    sysid,
                    LogFrame::Entry(LOG_ENTRY_DATA {
                        id: FAKE_LOG_ID,
                        num_logs: 1,
                        last_log_num: FAKE_LOG_ID,
                        time_utc: FAKE_LOG_TIME_UTC,
                        size: log.len() as u32,
                    }),
                ),
                MavMessage::LOG_REQUEST_DATA(r) if r.id == FAKE_LOG_ID => {
                    requests.lock().unwrap().push(r.ofs);
                    let end = (r.ofs as usize + r.count as usize).min(log.len());
                    let mut ofs = r.ofs as usize;
                    while ofs < end {
                        let n = (end - ofs).min(90);
                        if drop_first_chunk_at == Some(ofs as u32) && !dropped {
                            dropped = true;
                        } else {
                            let mut data = [0u8; 90];
                            data[..n].copy_from_slice(&log[ofs..ofs + n]);
                            hub.on_frame(
                                sysid,
                                LogFrame::Data(LOG_DATA_DATA {
                                    ofs: ofs as u32,
                                    id: FAKE_LOG_ID,
                                    count: n as u8,
                                    data,
                                }),
                            );
                        }
                        ofs += n;
                    }
                }
                _ => {}
            }
        }
    })
}
