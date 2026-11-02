//! `GuardHub` end to end in-process: settings API, detection, L1–L3, takeover, audit and
//! decision records. No SITL: synthetic `GuardFrame`s, vehicle state from a test router, a
//! manual clock, and a command queue whose receiver the test holds.

use std::f64::consts::PI;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use axum::body::Body;
use axum::http::{header, Method, Request, StatusCode};
use http_body_util::BodyExt;
use mavlink::dialects::ardupilotmega::{
    MavAutopilot, MavMessage, MavModeFlag, MavState, MavType, MavVtolState, EXTENDED_SYS_STATE_DATA,
    HEARTBEAT_DATA,
};
use mavlink::MavHeader;
use rgcs_core::operator::Role;
use rgcs_core::{GuardAlert, GuardPhase, ServerMessage, VehicleCommand};
use rgcs_guard::{DecisionRecord, ExtLevel, ExternalContext, TbState};
use rgcs_mavlink::{Clock, GuardBody, GuardFrame, Outcome, QueuedCommand, Router};
use rgcs_store::Store;
use serde_json::{json, Value};
use tokio::sync::{broadcast, mpsc, Mutex};
use tower::ServiceExt;

use super::*;
use crate::app::AppState;

const T0: u64 = 1_761_350_400_000;
const HOME: (f64, f64) = (36.2509, 137.6385);
const COPTER_LOITER: u32 = 5;
const COPTER_ALT_HOLD: u32 = 2;
const COPTER_STABILIZE: u32 = 0;
const PLANE_QLOITER: u32 = 19;

struct Rig {
    app: AppState,
    http: axum::Router,
    queue: mpsc::Receiver<QueuedCommand>,
    ws: broadcast::Receiver<ServerMessage>,
    clock: Arc<AtomicU64>,
    admin: String,
    op: String,
}

impl Rig {
    async fn new() -> Self {
        let store = Store::open_memory().await.unwrap();
        store
            .create_user("op", "op-password-1", Role::Operator)
            .await
            .unwrap();
        let router = Arc::new(Mutex::new(Router::default()));
        let (tx, ws) = broadcast::channel(8192);
        let (queue_tx, queue) = mpsc::channel(8);
        let clock = Arc::new(AtomicU64::new(T0));
        let c = clock.clone();
        let hub = GuardHub::new(tx.clone()).with_clock(Arc::new(move || c.load(Ordering::SeqCst)));
        let app = AppState::new(router, tx, store, queue_tx, true).with_guard(hub);
        app.guard.attach(&app);
        let http = crate::app::build(app.clone(), None);
        let admin = login(&http, "admin", "admin").await;
        let op = login(&http, "op", "op-password-1").await;
        Self {
            app,
            http,
            queue,
            ws,
            clock,
            admin,
            op,
        }
    }

    fn now(&self) -> u64 {
        self.clock.load(Ordering::SeqCst)
    }

    fn set_now(&self, t: u64) {
        self.clock.store(t, Ordering::SeqCst);
    }

    async fn call(
        &self,
        method: Method,
        path: &str,
        cookie: &str,
        body: Option<Value>,
    ) -> (StatusCode, Value) {
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
        (status, serde_json::from_slice(&bytes).unwrap_or(Value::Null))
    }

    async fn put_settings(&self, body: Value) -> (StatusCode, Value) {
        let admin = self.admin.clone();
        self.call(Method::PUT, "/api/guard/settings", &admin, Some(body))
            .await
    }

    /// Enables the guard with every consent at `level`.
    async fn enable(&self, level: &str) {
        let consent = json!({ "monitoring": true, "external_data": false, "auto_ops": level != "l1" });
        let (status, body) = self
            .put_settings(json!({ "enabled": true, "consent": consent, "toilet_bowl": level }))
            .await;
        assert_eq!(status, StatusCode::OK, "{body}");
    }

    async fn heartbeat(&self, sysid: u8, mavtype: MavType, custom_mode: u32, armed: bool) {
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
        self.route(sysid, &MavMessage::HEARTBEAT(hb)).await;
    }

    async fn route(&self, sysid: u8, msg: &MavMessage) {
        let header = MavHeader {
            system_id: sysid,
            component_id: 1,
            sequence: 0,
        };
        self.app
            .router
            .lock()
            .await
            .on_message(&header, msg, Clock::default());
    }

    async fn copter(&self, mode: u32, armed: bool) {
        self.heartbeat(1, MavType::MAV_TYPE_QUADROTOR, mode, armed).await;
    }

    /// The guard sees `sysid` disarmed first (a vehicle first seen armed is alert-only), then
    /// it arms.
    async fn boot_then_arm(&self, sysid: u8, mavtype: MavType, mode: u32) {
        self.heartbeat(sysid, mavtype, mode, false).await;
        let wind = GuardBody::Wind {
            dir_deg: 0.0,
            speed: 0.0,
        };
        self.frame(sysid, 1, wind).await;
        self.heartbeat(sysid, mavtype, mode, true).await;
    }

    async fn frame(&self, sysid: u8, compid: u8, body: GuardBody) {
        self.app.guard.on_frame(GuardFrame { sysid, compid, body }).await;
    }

    async fn flush(&self) {
        self.app.guard.flush().await;
    }

    fn alerts(&mut self) -> Vec<GuardAlert> {
        let mut out = Vec::new();
        while let Ok(m) = self.ws.try_recv() {
            if let ServerMessage::GuardAlert { alert } = m {
                out.push(alert);
            }
        }
        out
    }

    fn phase(&self) -> Option<GuardPhase> {
        self.app.guard.active_alerts().first().map(|a| a.phase)
    }

    /// Waits (real time) until the active alert reaches `phase`.
    async fn wait_phase(&self, phase: GuardPhase) {
        for _ in 0..400 {
            self.flush().await;
            if self.phase() == Some(phase) {
                return;
            }
            tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        }
        panic!("phase {phase:?} never reached; now {:?}", self.phase());
    }

    fn queued(&mut self) -> Vec<QueuedCommand> {
        let mut out = Vec::new();
        while let Ok(job) = self.queue.try_recv() {
            out.push(job);
        }
        out
    }

    async fn audit(&self) -> Vec<rgcs_store::audit::AuditEntry> {
        self.flush().await;
        self.app.store.recent_audit(50).await.unwrap()
    }

    async fn messages(&self) -> Vec<rgcs_core::LogEntry> {
        self.flush().await;
        let all = rgcs_store::messages::SeverityFilter::All;
        self.app.store.messages(Some(1), None, all, 50).await.unwrap()
    }
}

async fn login(http: &axum::Router, username: &str, password: &str) -> String {
    let req = Request::builder()
        .method(Method::POST)
        .uri("/api/auth/login")
        .header("x-requested-with", "rgcs")
        .header(header::CONTENT_TYPE, "application/json")
        .body(Body::from(
            json!({ "username": username, "password": password }).to_string(),
        ))
        .unwrap();
    let res = http.clone().oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::OK, "login {username}");
    let cookie = res.headers().get(header::SET_COOKIE).unwrap().to_str().unwrap();
    cookie.split(';').next().unwrap().to_string()
}

/// (east, north, ve, vn) at `t` seconds.
type Motion = Box<dyn Fn(f64) -> (f64, f64, f64, f64)>;

fn spiral(omega: f64) -> Motion {
    let (r0, growth) = (2.0, 0.3);
    Box::new(move |t| {
        let (r, th) = (r0 + growth * t, omega * t);
        let ve = growth * th.cos() - r * omega * th.sin();
        let vn = growth * th.sin() + r * omega * th.cos();
        (r * th.cos(), r * th.sin(), ve, vn)
    })
}

fn toilet_bowl() -> Motion {
    spiral(2.0 * PI / 8.0)
}

fn wind_drift() -> Motion {
    Box::new(|t| (2.0 * t, 0.0, 2.0, 0.0))
}

fn latlon(e: f64, n: f64) -> (f64, f64) {
    const R: f64 = 6_371_008.8;
    let lat = HOME.0 + (n / R).to_degrees();
    let lon = HOME.1 + (e / (R * HOME.0.to_radians().cos())).to_degrees();
    (lat, lon)
}

/// A 10 Hz trajectory fed one step at a time (EKF at 2 Hz, optional RC at 5 Hz).
struct Feed {
    motion: Motion,
    compass_var: f32,
    compid: u8,
    rc: Option<[u16; 4]>,
    start: u64,
    i: u64,
}

impl Feed {
    fn new(r: &Rig, motion: Motion) -> Self {
        Self {
            motion,
            compass_var: 0.6,
            compid: 1,
            rc: None,
            start: r.now(),
            i: 0,
        }
    }

    async fn step(&mut self, r: &Rig) {
        let t_ms = self.start + self.i * 100;
        r.set_now(t_ms);
        if self.i % 5 == 0 {
            let ekf = GuardBody::Ekf {
                compass_var: self.compass_var,
                pos_horiz_var: 0.1,
                vel_var: 0.1,
                flags: 0,
            };
            r.frame(1, self.compid, ekf).await;
        }
        if let Some(sticks) = self.rc.filter(|_| self.i % 2 == 0) {
            let chans = vec![sticks[0], sticks[1], sticks[2], sticks[3], 1000, 1000, 1000, 1000];
            r.frame(1, self.compid, GuardBody::Rc { chans, rssi: 255 }).await;
        }
        let (e, n, ve, vn) = (self.motion)(self.i as f64 / 10.0);
        let (lat, lon) = latlon(e, n);
        let pos = GuardBody::Position {
            lat,
            lon,
            vn: vn as f32,
            ve: ve as f32,
            hdg: Some(0.0),
        };
        r.frame(1, self.compid, pos).await;
        self.i += 1;
    }

    async fn run_secs(&mut self, r: &Rig, secs: f64) {
        for _ in 0..(secs * 10.0).round() as u64 {
            self.step(r).await;
        }
    }

    /// Steps until an alert is active (at most 20 s); panics otherwise.
    async fn until_alert(&mut self, r: &Rig) -> GuardAlert {
        for _ in 0..200 {
            self.step(r).await;
            if let Some(a) = r.app.guard.active_alerts().first() {
                return a.clone();
            }
        }
        panic!("no alert");
    }
}

async fn copter_rig() -> Rig {
    let r = Rig::new().await;
    r.boot_then_arm(1, MavType::MAV_TYPE_QUADROTOR, COPTER_LOITER)
        .await;
    r
}

#[tokio::test]
async fn settings_need_consent_and_an_admin() {
    let r = Rig::new().await;
    let (status, body) = r.put_settings(json!({ "enabled": true })).await;
    assert_eq!(
        (status, body["error"]["code"].as_str()),
        (StatusCode::BAD_REQUEST, Some("consent_required"))
    );
    let consent = json!({ "monitoring": true, "external_data": false, "auto_ops": false });
    let (status, body) = r
        .put_settings(json!({ "enabled": true, "consent": consent }))
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["data"]["enabled"], true);
    assert_eq!(body["data"]["consent"]["by"], "admin");
    let row = &r.audit().await[0];
    assert_eq!(
        (row.target.as_str(), row.command.as_str(), row.operator.as_str()),
        ("ai_intervention", "enable", "admin")
    );
    let (status, body) = r.put_settings(json!({ "toilet_bowl": "l2" })).await;
    assert_eq!(
        (status, body["error"]["code"].as_str()),
        (StatusCode::BAD_REQUEST, Some("auto_ops_consent_required"))
    );
    for bad in [
        json!({ "countdown_s": 2 }),
        json!({ "takeover_wait_s": 121 }),
        json!({ "params": { "min_turn_deg": -1.0 } }),
    ] {
        let (status, body) = r.put_settings(bad.clone()).await;
        assert_eq!(
            (status, body["error"]["code"].as_str()),
            (StatusCode::BAD_REQUEST, Some("validation")),
            "{bad}"
        );
    }
    let op = r.op.clone();
    let (status, _) = r
        .call(
            Method::PUT,
            "/api/guard/settings",
            &op,
            Some(json!({ "enabled": false })),
        )
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let (status, body) = r.call(Method::GET, "/api/guard/settings", &op, None).await;
    assert_eq!((status, &body["data"]["enabled"]), (StatusCode::OK, &json!(true)));
    let (status, body) = r.put_settings(json!({ "enabled": false })).await;
    assert_eq!(status, StatusCode::OK);
    let c = &body["data"]["consent"];
    assert_eq!(
        (&c["monitoring"], &c["external_data"], &c["auto_ops"], &c["by"]),
        (&json!(false), &json!(false), &json!(false), &Value::Null)
    );
    assert_eq!(r.audit().await[0].command, "disable");
    let stored = r.app.store.app_setting("guard.settings").await.unwrap().unwrap();
    assert!(stored.contains("\"enabled\":false"));
}

#[tokio::test]
async fn params_and_level_changes_are_audited() {
    let r = Rig::new().await;
    r.enable("l2").await;
    let (status, body) = r
        .put_settings(json!({ "countdown_s": 8, "params": { "min_turn_deg": 300.0 } }))
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["data"]["params"]["min_turn_deg"], 300.0);
    let row = &r.audit().await[0];
    assert_eq!(row.command, "set_guard_params");
    assert!(row.args.as_deref().unwrap().contains("countdown_s"));
    r.put_settings(json!({ "toilet_bowl": "l3" })).await;
    assert_eq!(r.audit().await[0].command, "set_level");
}

#[tokio::test]
async fn off_means_off() {
    let mut r = copter_rig().await;
    Feed::new(&r, toilet_bowl()).run_secs(&r, 14.0).await;
    r.flush().await;
    assert!(r.alerts().is_empty());
    assert!(r.messages().await.is_empty());
    assert!(r.queued().is_empty());
    assert!(r.app.store.decisions(None, 10).await.unwrap().is_empty());
}

#[tokio::test]
async fn l1_warns_once_and_sends_nothing() {
    let mut r = copter_rig().await;
    r.enable("l1").await;
    Feed::new(&r, toilet_bowl()).run_secs(&r, 14.0).await;
    r.flush().await;
    let alerts = r.alerts();
    assert_eq!(alerts.len(), 1, "{alerts:?}");
    let a = &alerts[0];
    assert_eq!((a.phase, a.sound, a.sysid), (GuardPhase::Alerting, true, 1));
    assert_eq!(
        a.text,
        "UAV-01 Unstable circling (toilet bowl). Take over manually"
    );
    assert!(a.id.starts_with("g-") && a.rc_stale && !a.kp_raised);
    let msgs = r.messages().await;
    assert_eq!(msgs.len(), 1);
    assert_eq!(msgs[0].text, a.text);
    assert_eq!(
        (
            msgs[0].source.as_str(),
            msgs[0].severity.as_str(),
            msgs[0].ackable
        ),
        ("system", "error", false)
    );
    assert!(r.queued().is_empty());
    let rows = r.app.store.decisions(Some(1), 10).await.unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(
        (
            rows[0].phase.as_str(),
            rows[0].level.as_str(),
            rows[0].alert_id.as_str()
        ),
        ("alerting", "l1", a.id.as_str())
    );
    let (status, body) = r
        .call(Method::GET, "/api/guard/alerts", &r.op.clone(), None)
        .await;
    assert_eq!((status, &body["data"][0]["id"]), (StatusCode::OK, &json!(a.id)));
}

#[tokio::test]
async fn l2_counts_down_then_switches_to_alt_hold_once() {
    let mut r = copter_rig().await;
    r.enable("l2").await;
    let mut feed = Feed::new(&r, toilet_bowl());
    let a = feed.until_alert(&r).await;
    assert_eq!(
        (a.phase, a.deadline_ms),
        (GuardPhase::Countdown, Some(a.ts + 5_000))
    );
    assert_eq!(a.action_mode.as_deref(), Some("ALT_HOLD"));
    feed.run_secs(&r, 4.8).await;
    r.flush().await;
    assert!(r.queued().is_empty(), "nothing before the deadline");
    feed.run_secs(&r, 0.3).await;
    r.flush().await;
    let mut jobs = r.queued();
    assert_eq!(jobs.len(), 1);
    let job = jobs.remove(0);
    assert_eq!(
        (job.sysid, &job.cmd),
        (
            1,
            &VehicleCommand::SetMode {
                mode: "ALT_HOLD".into()
            }
        )
    );
    let countdowns = r
        .alerts()
        .iter()
        .filter(|x| x.phase == GuardPhase::Countdown)
        .count();
    assert!(countdowns >= 5, "1 Hz re-send: {countdowns}");
    job.done.send(Outcome::Accepted).unwrap();
    r.wait_phase(GuardPhase::Executed).await;
    feed.run_secs(&r, 3.0).await;
    r.flush().await;
    assert!(r.queued().is_empty(), "at most one action");
    let row = r
        .audit()
        .await
        .into_iter()
        .find(|e| e.command == "set_mode")
        .unwrap();
    assert_eq!(
        (row.operator.as_str(), row.target.as_str(), row.result.as_str()),
        ("ai-guard", "ai_intervention", "ok")
    );
    let args: Value = serde_json::from_str(row.args.as_deref().unwrap()).unwrap();
    assert_eq!(
        (&args["alert_id"], &args["mode"]),
        (&json!(a.id), &json!("ALT_HOLD"))
    );
    assert!(args["decision_id"].is_i64());
    let texts: Vec<String> = r.messages().await.into_iter().map(|m| m.text).collect();
    assert!(texts
        .contains(&"Switched to ALT_HOLD: the vehicle drifts with the wind. Take over manually".to_string()));
}

#[tokio::test]
async fn l2_cancel_stops_the_action_for_the_flight() {
    let mut r = copter_rig().await;
    r.enable("l2").await;
    let mut feed = Feed::new(&r, toilet_bowl());
    let a = feed.until_alert(&r).await;
    feed.run_secs(&r, 2.0).await;
    let op = r.op.clone();
    let path = format!("/api/guard/alerts/{}/cancel", a.id);
    let (status, body) = r.call(Method::POST, &path, &op, None).await;
    assert_eq!(
        (status, &body["data"]["phase"]),
        (StatusCode::OK, &json!("cancelled"))
    );
    let (status, _) = r.call(Method::POST, &path, &op, None).await;
    assert_eq!(status, StatusCode::CONFLICT);
    let (status, _) = r
        .call(Method::POST, "/api/guard/alerts/g-nope/cancel", &op, None)
        .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let row = r
        .audit()
        .await
        .into_iter()
        .find(|e| e.command == "cancel")
        .unwrap();
    assert_eq!(
        (row.operator.as_str(), row.target.as_str(), row.sysid),
        ("op", "ai_intervention", Some(1))
    );
    feed.run_secs(&r, 8.0).await;
    r.flush().await;
    assert!(r.queued().is_empty());
    assert_eq!(r.phase(), Some(GuardPhase::Cancelled), "the warning stays");
}

#[tokio::test]
async fn l2_operator_command_is_a_takeover() {
    let mut r = copter_rig().await;
    r.enable("l2").await;
    let mut feed = Feed::new(&r, toilet_bowl());
    feed.until_alert(&r).await;
    feed.run_secs(&r, 1.0).await;
    let op = r.op.clone();
    let cmd = json!({ "cmd": "set_mode", "args": { "mode": "LOITER" } });
    let (status, body) = r
        .call(Method::POST, "/api/vehicles/1/command", &op, Some(cmd))
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(r.phase(), Some(GuardPhase::TakenOver));
    feed.run_secs(&r, 9.0).await;
    r.flush().await;
    let cmds: Vec<VehicleCommand> = r.queued().into_iter().map(|j| j.cmd).collect();
    assert_eq!(
        cmds,
        vec![VehicleCommand::SetMode {
            mode: "LOITER".into()
        }]
    );
}

#[tokio::test]
async fn l2_stick_movement_is_a_takeover() {
    let mut r = copter_rig().await;
    r.enable("l2").await;
    let mut feed = Feed::new(&r, toilet_bowl());
    feed.rc = Some([1500, 1500, 1500, 1500]);
    let a = feed.until_alert(&r).await;
    assert!(!a.rc_stale);
    feed.run_secs(&r, 1.0).await;
    feed.rc = Some([1500, 1600, 1500, 1500]);
    feed.run_secs(&r, 0.2).await;
    assert_eq!(
        r.phase(),
        Some(GuardPhase::Countdown),
        "a short blip is not a takeover"
    );
    feed.run_secs(&r, 0.4).await;
    assert_eq!(r.phase(), Some(GuardPhase::TakenOver));
    feed.run_secs(&r, 8.0).await;
    r.flush().await;
    assert!(r.queued().is_empty());
}

#[tokio::test]
async fn l3_acts_at_once_then_goes_hands_off_until_disarm() {
    let mut r = copter_rig().await;
    r.enable("l3").await;
    let mut feed = Feed::new(&r, toilet_bowl());
    feed.until_alert(&r).await;
    r.flush().await;
    let mut jobs = r.queued();
    assert_eq!(jobs.len(), 1);
    jobs.remove(0).done.send(Outcome::Accepted).unwrap();
    r.wait_phase(GuardPhase::Executed).await;
    let t = r.now();
    for s in 1..=21 {
        r.set_now(t + s * 1_000);
        r.app.guard.tick();
    }
    r.flush().await;
    let last = r.alerts().into_iter().last().unwrap();
    assert_eq!((last.phase, last.sound), (GuardPhase::Unanswered, true));
    let mut again = Feed::new(&r, toilet_bowl());
    again.run_secs(&r, 15.0).await;
    r.flush().await;
    assert!(r.queued().is_empty(), "never again this flight");
    r.copter(COPTER_LOITER, false).await;
    Feed::new(&r, toilet_bowl()).run_secs(&r, 0.5).await;
    r.copter(COPTER_LOITER, true).await;
    Feed::new(&r, toilet_bowl()).until_alert(&r).await;
    r.flush().await;
    assert_eq!(r.queued().len(), 1, "disarm re-arms the latch");
}

#[tokio::test]
async fn the_guards_own_mode_change_is_not_a_takeover_but_the_pilots_is() {
    let mut r = copter_rig().await;
    r.enable("l3").await;
    Feed::new(&r, toilet_bowl()).until_alert(&r).await;
    r.flush().await;
    r.queued().remove(0).done.send(Outcome::Accepted).unwrap();
    r.wait_phase(GuardPhase::Executed).await;
    r.copter(COPTER_ALT_HOLD, true).await;
    r.app.guard.tick();
    assert_eq!(r.phase(), Some(GuardPhase::Executed));
    r.copter(COPTER_STABILIZE, true).await;
    r.app.guard.tick();
    assert_eq!(r.phase(), Some(GuardPhase::TakenOver));
}

#[tokio::test]
async fn quadplane_switches_to_qhover() {
    let mut r = Rig::new().await;
    r.boot_then_arm(1, MavType::MAV_TYPE_FIXED_WING, PLANE_QLOITER)
        .await;
    let ext = EXTENDED_SYS_STATE_DATA {
        vtol_state: MavVtolState::MAV_VTOL_STATE_MC,
        ..EXTENDED_SYS_STATE_DATA::DEFAULT
    };
    r.route(1, &MavMessage::EXTENDED_SYS_STATE(ext)).await;
    r.enable("l3").await;
    r.frame(1, 1, GuardBody::VtolState(3)).await;
    Feed::new(&r, toilet_bowl()).until_alert(&r).await;
    r.flush().await;
    let jobs = r.queued();
    assert_eq!(jobs.len(), 1);
    assert_eq!(
        jobs[0].cmd,
        VehicleCommand::SetMode {
            mode: "QHOVER".into()
        }
    );
}

#[tokio::test]
async fn a_lost_link_at_execution_refuses() {
    let mut r = copter_rig().await;
    r.enable("l2").await;
    let mut feed = Feed::new(&r, toilet_bowl());
    feed.until_alert(&r).await;
    r.app.router.lock().await.tick(Clock {
        mono_ms: 11_000,
        unix_ms: 11_000,
    });
    feed.run_secs(&r, 5.5).await;
    r.wait_phase(GuardPhase::Refused).await;
    assert!(r.queued().is_empty());
    let row = r
        .audit()
        .await
        .into_iter()
        .find(|e| e.command == "set_mode")
        .unwrap();
    assert_eq!(
        (row.result.as_str(), row.operator.as_str()),
        ("rejected", "ai-guard")
    );
}

#[tokio::test]
async fn frames_from_another_component_are_ignored() {
    let mut r = copter_rig().await;
    r.enable("l1").await;
    let mut feed = Feed::new(&r, toilet_bowl());
    feed.compid = 100;
    feed.run_secs(&r, 14.0).await;
    r.flush().await;
    assert!(r.alerts().is_empty());
}

async fn kp_case(ctx: ExtLevel, motion: Motion) -> Vec<GuardAlert> {
    let mut r = copter_rig().await;
    r.enable("l1").await;
    r.app.guard.set_context(ExternalContext { kp: Some(ctx) });
    Feed::new(&r, motion).run_secs(&r, 14.0).await;
    r.flush().await;
    r.alerts()
}

#[tokio::test]
async fn a_strong_kp_raises_sensitivity_but_never_triggers_alone() {
    let slow = || spiral(2.0 * PI / 16.0);
    let strong = kp_case(ExtLevel::Strong, slow()).await;
    assert_eq!(strong.len(), 1);
    assert!(strong[0].kp_raised);
    assert!(kp_case(ExtLevel::Ok, slow()).await.is_empty());
    assert!(kp_case(ExtLevel::Strong, wind_drift()).await.is_empty());
}

#[tokio::test]
async fn decisions_replay_and_need_an_admin() {
    let r = copter_rig().await;
    r.enable("l2").await;
    let mut feed = Feed::new(&r, toilet_bowl());
    let a = feed.until_alert(&r).await;
    feed.run_secs(&r, 1.0).await;
    let op = r.op.clone();
    r.call(
        Method::POST,
        &format!("/api/guard/alerts/{}/cancel", a.id),
        &op,
        None,
    )
    .await;
    r.flush().await;
    let (status, _) = r
        .call(Method::GET, "/api/guard/decisions?sysid=1", &op, None)
        .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    let admin = r.admin.clone();
    let (status, body) = r
        .call(Method::GET, "/api/guard/decisions?sysid=1", &admin, None)
        .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let rows = body["data"].as_array().unwrap();
    let phases: Vec<&str> = rows.iter().map(|x| x["phase"].as_str().unwrap()).collect();
    assert_eq!(phases, vec!["countdown", "cancelled"]);
    let record: DecisionRecord = serde_json::from_value(rows[0]["record"].clone()).unwrap();
    assert_eq!(rgcs_guard::replay(&record).state, TbState::Detected);
    assert_eq!(record.verdict.state, TbState::Detected);
    let cancelled: DecisionRecord = serde_json::from_value(rows[1]["record"].clone()).unwrap();
    assert_eq!(cancelled.by, "op");
}

#[tokio::test]
async fn disabling_during_a_countdown_sends_nothing() {
    let mut r = copter_rig().await;
    r.enable("l2").await;
    let mut feed = Feed::new(&r, toilet_bowl());
    feed.until_alert(&r).await;
    feed.run_secs(&r, 1.0).await;
    r.alerts();
    let (status, _) = r.put_settings(json!({ "enabled": false })).await;
    assert_eq!(status, StatusCode::OK);
    let phases: Vec<GuardPhase> = r.alerts().into_iter().map(|a| a.phase).collect();
    assert_eq!(phases, vec![GuardPhase::Cancelled, GuardPhase::Cleared]);
    feed.run_secs(&r, 9.0).await;
    r.flush().await;
    assert!(r.queued().is_empty());
    assert!(r.app.guard.active_alerts().is_empty());
    assert!(r.alerts().is_empty());
}

#[path = "guard_ai_tools_tests.rs"]
mod ai_tools;

#[path = "guard_hub_review_tests.rs"]
mod review;
