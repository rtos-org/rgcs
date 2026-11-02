//! `/ws`: snapshot on connect, then every broadcast frame. Client frames are parsed and,
//! until the input gate lands (M2), answered with an error frame.

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{ConnectInfo, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Extension;
use futures::{SinkExt, StreamExt};
use rgcs_core::{CameraCommand, ClientMessage, Operator, ServerMessage, SysId};
use rgcs_input::{Action, Gate};
use std::net::SocketAddr;
use tokio::sync::broadcast;
use tracing::warn;

use crate::app::{unix_ms, AppState};
use crate::auth::AuthUser;
use crate::roi::ManualVerdict;

/// Client frames are small control messages; anything bigger is not ours.
/// Deadman check cadence: 250 ms keeps the worst case under 1.75 s (1.5 s).
const DEADMAN_TICK: std::time::Duration = std::time::Duration::from_millis(250);
const MAX_MESSAGE_SIZE: usize = 16 * 1024;
/// Keepalive: a Ping this often; a session with no frame from the client (Pong or any other)
/// for `WS_IDLE_TIMEOUT` is half-open and is dropped, so it leaves no ghost client row.
const WS_PING_EVERY: std::time::Duration = std::time::Duration::from_secs(15);
const WS_IDLE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(45);

pub async fn handler(
    ws: WebSocketUpgrade,
    headers: HeaderMap,
    connect: Option<Extension<ConnectInfo<SocketAddr>>>,
    State(app): State<AppState>,
    AuthUser(op): AuthUser,
) -> Response {
    let origin = headers.get("origin").and_then(|v| v.to_str().ok());
    let host = headers.get("host").and_then(|v| v.to_str().ok());
    if !origin_allowed(origin, host) {
        return (StatusCode::FORBIDDEN, "origin not allowed").into_response();
    }
    let addr = connect.map(|Extension(ConnectInfo(a))| a);
    let user_agent = headers
        .get("user-agent")
        .and_then(|v| v.to_str().ok())
        .map(str::to_string);
    ws.max_message_size(MAX_MESSAGE_SIZE)
        .on_upgrade(move |socket| session(socket, app, op, addr, user_agent))
        .into_response()
}

/// Same-origin only: the UI is served by this server, so a browser `Origin` must match the
/// `Host` it connected to. Non-browser clients send no `Origin` and are allowed.
pub fn origin_allowed(origin: Option<&str>, host: Option<&str>) -> bool {
    match (origin, host) {
        (None, _) => true,
        (Some(o), Some(h)) => {
            let authority = o
                .strip_prefix("http://")
                .or_else(|| o.strip_prefix("https://"))
                .unwrap_or("");
            !authority.is_empty() && authority.eq_ignore_ascii_case(h)
        }
        (Some(_), None) => false,
    }
}

/// `operator` is the logged-in user who opened the socket: the audit names them for joystick cancels.
async fn session(
    socket: WebSocket,
    app: AppState,
    op: Operator,
    addr: Option<SocketAddr>,
    user_agent: Option<String>,
) {
    // Held until every exit path of this function: its Drop removes the registry row.
    let _guard = app
        .sessions
        .register(&op.username, op.role, addr, user_agent.as_deref(), unix_ms());
    let operator = op.username;
    let (mut sink, mut stream) = socket.split();
    // Subscribe before taking the snapshot so no frame is lost in between.
    let mut rx = app.tx.subscribe();
    if send(&mut sink, &snapshot(&app).await).await.is_err() {
        return;
    }
    let mut gate = Gate::default();
    let mut deadman = tokio::time::interval(DEADMAN_TICK);
    deadman.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let mut keepalive = tokio::time::interval_at(tokio::time::Instant::now() + WS_PING_EVERY, WS_PING_EVERY);
    keepalive.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let mut last_rx = tokio::time::Instant::now();
    loop {
        tokio::select! {
            frame = rx.recv() => match frame {
                Ok(f) => { if send(&mut sink, &f).await.is_err() { break; } }
                Err(broadcast::error::RecvError::Lagged(n)) => {
                    // Diffs were dropped: the client's state is stale until it gets a full snapshot.
                    warn!(skipped = n, "ws client lagged, resyncing");
                    if send(&mut sink, &snapshot(&app).await).await.is_err() { break; }
                }
                Err(broadcast::error::RecvError::Closed) => break,
            },
            incoming = stream.next() => match incoming {
                Some(Ok(Message::Text(text))) => {
                    last_rx = tokio::time::Instant::now();
                    let (next, replies) = handle_client(&gate, &app, &operator, &text, unix_ms()).await;
                    gate = next;
                    for reply in replies {
                        if send(&mut sink, &reply).await.is_err() { break; }
                    }
                }
                Some(Ok(Message::Close(_))) | None | Some(Err(_)) => break,
                Some(Ok(_)) => last_rx = tokio::time::Instant::now(),
            },
            _ = keepalive.tick() => {
                if last_rx.elapsed() >= WS_IDLE_TIMEOUT {
                    warn!(operator = %operator, "ws client silent, dropping half-open session");
                    break;
                }
                if sink.send(Message::Ping(Default::default())).await.is_err() { break; }
            },
            _ = deadman.tick() => {
                let (next, replies) = deadman_tick(&gate, &app, &operator, unix_ms()).await;
                gate = next;
                for reply in replies {
                    if send(&mut sink, &reply).await.is_err() { break; }
                }
            }
        }
    }
    close_session(&gate, &app, &operator).await;
}

/// The deadman check: a silent session stops its gimbal once; returns the replies.
pub async fn deadman_tick(
    gate: &Gate,
    app: &AppState,
    operator: &str,
    now_ms: u64,
) -> (Gate, Vec<ServerMessage>) {
    let (next, actions) = gate.tick(now_ms);
    (next, perform(app, operator, actions).await)
}

/// The session ended: zero the gimbal it was turning (none when it was not).
pub async fn close_session(gate: &Gate, app: &AppState, operator: &str) {
    perform(app, operator, gate.close()).await;
}

/// Parses a client frame; a malformed one becomes the `error` reply to send back.
pub fn parse_client(text: &str) -> Result<ClientMessage, Box<ServerMessage>> {
    serde_json::from_str::<ClientMessage>(text).map_err(|e| {
        Box::new(ServerMessage::Error {
            code: "validation".into(),
            message: e.to_string(),
        })
    })
}

/// Runs one client frame through the gate and performs its actions; returns the replies.
pub async fn handle_client(
    gate: &Gate,
    app: &AppState,
    operator: &str,
    text: &str,
    now_ms: u64,
) -> (Gate, Vec<ServerMessage>) {
    let msg = match parse_client(text) {
        Ok(m) => m,
        Err(reply) => return (gate.clone(), vec![*reply]),
    };
    let (next, actions) = match msg {
        ClientMessage::GimbalRate {
            sysid, yaw, pitch, ..
        } => gate.on_gimbal_rate(sysid, i16::from(yaw), i16::from(pitch), now_ms),
        ClientMessage::InputHb { sysid } => gate.on_hb(sysid, now_ms),
        ClientMessage::Select { sysid } => gate.on_select(sysid, now_ms),
    };
    (next, perform(app, operator, actions).await)
}

/// Forwards / zeroes go to the camera (errors are logged, never echoed); replies come back.
async fn perform(app: &AppState, operator: &str, actions: Vec<Action>) -> Vec<ServerMessage> {
    let mut replies = Vec::new();
    for a in actions {
        match a {
            Action::Forward { sysid, yaw, pitch } => forward(app, operator, sysid, yaw, pitch).await,
            Action::Zero { sysid } => {
                if app.roi.on_zero(sysid) == ManualVerdict::Forward {
                    rate(app, sysid, 0, 0).await
                }
            }
            Action::Reply(m) => replies.push(*m),
        }
    }
    replies
}

/// While ROI owns the gimbal, zeros and small speeds are dropped and a large speed cancels
/// ROI first; `on_manual_rate` returns only after the cancel's zero went out (Review Focus 4).
async fn forward(app: &AppState, operator: &str, sysid: SysId, yaw: i8, pitch: i8) {
    if (yaw, pitch) == (0, 0) {
        if app.roi.on_zero(sysid) == ManualVerdict::Forward {
            rate(app, sysid, 0, 0).await;
        }
        return;
    }
    let was_active = app.roi.active_target(sysid).is_some();
    if app.roi.on_manual_rate(sysid, yaw, pitch).await == ManualVerdict::Drop {
        return;
    }
    if was_active && app.roi.active_target(sysid).is_none() {
        crate::roi_api::audit_manual_stop(app, operator, sysid, "manual_input").await;
    }
    rate(app, sysid, yaw, pitch).await;
}

async fn rate(app: &AppState, sysid: SysId, yaw: i8, pitch: i8) {
    if let Err(e) = app
        .cameras
        .send(sysid, CameraCommand::GimbalRate { yaw, pitch })
        .await
    {
        tracing::debug!(sysid, error = %e, "gimbal rate not delivered");
    }
}

pub async fn snapshot(app: &AppState) -> ServerMessage {
    ServerMessage::Snapshot {
        vehicles: app.router.lock().await.states(),
        cameras: app.cameras.snapshot().await,
        video_sources: app.video.snapshot().await,
    }
}

async fn send(
    sink: &mut futures::stream::SplitSink<WebSocket, Message>,
    frame: &ServerMessage,
) -> Result<(), ()> {
    let text = serde_json::to_string(frame).map_err(|_| ())?;
    sink.send(Message::Text(text.into())).await.map_err(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cameras::{CameraFactory, CameraManager};
    use rgcs_camera::siyi::sim::{SimServer, Transport};
    use rgcs_input::Gate;
    use rgcs_store::Store;
    use std::sync::Arc;
    use tokio::sync::{broadcast, mpsc, Mutex};

    #[test]
    fn origin_must_match_host_when_present() {
        assert!(origin_allowed(None, Some("pi.local:8000")));
        assert!(origin_allowed(
            Some("http://pi.local:8000"),
            Some("pi.local:8000")
        ));
        assert!(origin_allowed(Some("https://HUB.example"), Some("hub.example")));
        assert!(!origin_allowed(
            Some("http://evil.example"),
            Some("pi.local:8000")
        ));
        assert!(!origin_allowed(Some("http://pi.local:8000"), None));
        assert!(!origin_allowed(Some("null"), Some("pi.local:8000")));
    }

    #[test]
    fn malformed_client_frames_get_a_validation_error() {
        match parse_client("{\"t\":\"bogus\"}").map_err(|b| *b) {
            Err(ServerMessage::Error { code, .. }) => assert_eq!(code, "validation"),
            other => panic!("{other:?}"),
        }
        assert!(parse_client("{\"t\":\"input_hb\",\"sysid\":1}").is_ok());
    }

    async fn sim_app() -> (AppState, SimServer) {
        let sim = SimServer::start().await;
        let store = Store::open_memory().await.unwrap();
        let (tx, _rx) = broadcast::channel(16);
        let (queue, _queue_rx) = mpsc::channel(1);
        let cameras = CameraManager::new(store.clone(), tx.clone(), CameraFactory::Sim(sim.addr));
        let app = AppState::new(
            Arc::new(Mutex::new(rgcs_mavlink::Router::default())),
            tx,
            store,
            queue,
            true,
        )
        .with_cameras(cameras);
        let profile = rgcs_core::CameraProfile {
            kind: rgcs_core::CameraKind::SiyiMt11,
            host: "127.0.0.1".into(),
            port: sim.addr.port(),
            ..rgcs_core::CameraProfile::default_for(1)
        };
        app.store.put_camera_profile(&profile).await.unwrap();
        app.cameras.ensure(1).await;
        let mut rx = app.cameras.ensure(1).await.state();
        tokio::time::timeout(std::time::Duration::from_secs(3), async {
            while !rx.borrow().connected {
                rx.changed().await.unwrap();
            }
        })
        .await
        .expect("sim camera connects");
        (app, sim)
    }

    #[tokio::test]
    async fn gimbal_rate_frames_reach_the_camera_and_bad_ones_get_an_error() {
        let (app, mut sim) = sim_app().await;
        while sim.received.try_recv().is_ok() {}
        let (gate, replies) = handle_client(
            &Gate::default(),
            &app,
            "pilot",
            "{\"t\":\"gimbal_rate\",\"sysid\":1,\"yaw\":12,\"pitch\":-3,\"seq\":1}",
            1_000,
        )
        .await;
        assert!(replies.is_empty());
        let mut seen = false;
        for _ in 0..20 {
            // The driver's boot zero  may arrive first; look for our frame.
            if let Ok((Transport::Udp, 0x07, p)) = sim.received.try_recv() {
                if p == [12, 0xFD] {
                    seen = true;
                    break;
                }
                continue;
            }
            tokio::time::sleep(std::time::Duration::from_millis(25)).await;
        }
        assert!(seen, "0x07 with [12, -3] reached the simulator");
        let (_, replies) = handle_client(
            &gate,
            &app,
            "pilot",
            "{\"t\":\"gimbal_rate\",\"sysid\":1,\"yaw\":200,\"pitch\":0,\"seq\":2}",
            1_100,
        )
        .await;
        assert!(matches!(&replies[..], [ServerMessage::Error { code, .. }] if code == "validation"));
    }

    async fn send_text(gate: &Gate, app: &AppState, text: &str, now_ms: u64) -> Gate {
        handle_client(gate, app, "pilot", text, now_ms).await.0
    }

    /// The MT11 still gets its deadman and close zeros.
    #[tokio::test]
    async fn mt11_deadman_and_close_zeros_still_go_out() {
        let (app, mut sim) = sim_app().await;
        let hb = "{\"t\":\"input_hb\",\"sysid\":1}";
        let gate = send_text(&Gate::default(), &app, hb, 1_000).await;
        rate_payloads(&mut sim, 200).await;
        let (gate, _) = deadman_tick(&gate, &app, "pilot", 2_600).await;
        assert!(
            rate_payloads(&mut sim, 300).await.contains(&vec![0, 0]),
            "deadman zero"
        );
        let gate = send_text(&gate, &app, &rate_frame(20, 1), 2_700).await;
        rate_payloads(&mut sim, 200).await;
        close_session(&gate, &app, "pilot").await;
        assert_eq!(rate_payloads(&mut sim, 300).await, vec![vec![0, 0]], "close zero");
    }

    #[tokio::test]
    async fn a_session_that_never_moved_sends_no_zero_on_close() {
        let (app, mut sim) = sim_app().await;
        let select = "{\"t\":\"select\",\"sysid\":1}";
        let gate = send_text(&Gate::default(), &app, select, 1_000).await;
        rate_payloads(&mut sim, 200).await;
        close_session(&gate, &app, "pilot").await;
        assert!(rate_payloads(&mut sim, 300).await.is_empty());
    }

    /// `sim_app` with `roi_1` set and ROI running on it.
    async fn sim_app_with_roi() -> (AppState, SimServer) {
        let (app, sim) = sim_app().await;
        let mut targets = rgcs_core::default_roi_targets();
        targets[0] = rgcs_core::RoiTarget {
            name: "North".into(),
            lat: 35.009,
            lon: 139.0,
            ..targets[0].clone()
        };
        app.store.put_roi_targets(1, &targets).await.unwrap();
        app.roi.start(1, "roi_1").await.unwrap();
        (app, sim)
    }

    fn rate_frame(yaw: i8, seq: u32) -> String {
        format!("{{\"t\":\"gimbal_rate\",\"sysid\":1,\"yaw\":{yaw},\"pitch\":0,\"seq\":{seq}}}")
    }

    async fn rate_payloads(sim: &mut SimServer, ms: u64) -> Vec<Vec<u8>> {
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_millis(ms);
        let mut out = Vec::new();
        while let Ok(Some(f)) = tokio::time::timeout_at(deadline, sim.received.recv()).await {
            if f.0 == Transport::Udp && f.1 == 0x07 {
                out.push(f.2);
            }
        }
        out
    }

    #[tokio::test]
    async fn ws_small_rate_is_ignored_while_active() {
        let (app, mut sim) = sim_app_with_roi().await;
        let (gate, _) = handle_client(&Gate::default(), &app, "pilot", &rate_frame(3, 1), 1_000).await;
        assert_eq!(app.roi.active_target(1).as_deref(), Some("roi_1"));
        assert!(!rate_payloads(&mut sim, 300).await.contains(&vec![3, 0]));
        let (_, _) = handle_client(&gate, &app, "pilot", &rate_frame(40, 2), 1_100).await;
        assert_eq!(app.roi.active_target(1), None);
        let frames = rate_payloads(&mut sim, 300).await;
        let manual = frames
            .iter()
            .position(|p| p == &vec![40, 0])
            .expect("[40, 0] forwarded");
        assert!(frames[..manual].contains(&vec![0, 0]), "{frames:?}");
        let rows = app.store.recent_audit(10).await.unwrap();
        let row = serde_json::to_value(&rows).unwrap();
        assert!(
            row.as_array().unwrap().iter().any(|r| r["operator"] == "pilot"
                && r["target"] == "roi"
                && r["command"] == "stop"
                && r["reason"] == "manual_input"),
            "{row}"
        );
    }
}
