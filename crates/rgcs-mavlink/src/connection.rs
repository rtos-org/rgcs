//! Async link task: connect, feed every frame to the [`Router`], ask for missing streams,
//! transmit queued messages, publish COMMAND_ACKs, reconnect after errors. One task per link.
//!
//! Receiving runs in its own task and hands frames over a channel, so the `select!` below
//! never cancels an in-flight `recv()` (which could drop half a frame on TCP / serial).

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use mavlink::dialects::ardupilotmega::{MavCmd, MavMessage, COMMAND_LONG_DATA};
use mavlink::{AsyncMavConnection, MavHeader};
use rgcs_core::SysId;
use tokio::sync::{broadcast, mpsc, Mutex};
use tokio::time::Instant;
use tracing::{info, warn};

use crate::heartbeat::is_flight_controller;
use crate::interval::IntervalRequester;
use crate::link::LinkUrl;
use crate::queue::{Ack, Outgoing};
use crate::router::{Clock, Router, RouterEvent};

pub const GCS_COMPONENT_ID: u8 = 190;
const RECONNECT_WAIT: Duration = Duration::from_secs(2);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const FRAME_QUEUE: usize = 256;

type Conn = Arc<dyn AsyncMavConnection<MavMessage> + Sync + Send>;

/// Channels that connect the link to the rest of the server.
pub struct LinkChannels {
    /// Router events (discoveries, STATUSTEXT) for the WebSocket.
    pub events: mpsc::Sender<RouterEvent>,
    /// Messages to transmit (from the command queue).
    pub outgoing: mpsc::Receiver<Outgoing>,
    /// Every COMMAND_ACK received, for the command queue.
    pub acks: broadcast::Sender<Ack>,
    /// The GCS SYSID put in every header (configurable, default 255).
    pub gcs: rgcs_core::GcsId,
    /// Records every frame received and sent (maintenance › MAVLink インスペクター).
    pub inspector: crate::inspector::Inspector,
    /// Camera / gimbal frames from any component, for the MAVLink camera driver.
    pub payload: broadcast::Sender<crate::port::PayloadFrame>,
    /// Per-component rates, bytes and sequence loss plus connection state (network view).
    pub stats: crate::link_stats::LinkStats,
    /// AI guard telemetry (lossy: a slow guard drops frames, the link never waits).
    pub guard: broadcast::Sender<crate::guard_tap::GuardFrame>,
}

/// Wall + monotonic clock for the router, anchored at task start (tokio's clock, so tests
/// can pause time).
#[derive(Clone, Copy)]
struct TaskClock {
    started: Instant,
}

impl TaskClock {
    fn now(&self) -> Clock {
        let mono_ms = self.started.elapsed().as_millis() as u64;
        let unix_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);
        Clock { mono_ms, unix_ms }
    }
}

/// Per-link mutable state: stream requesters per flight controller and the outgoing sequence.
#[derive(Default)]
struct LinkState {
    requesters: HashMap<SysId, IntervalRequester>,
    sequence: u8,
    gcs: rgcs_core::GcsId,
    inspector: crate::inspector::Inspector,
}

/// Aborts the router ticker when `run_link` returns.
struct AbortOnDrop(tokio::task::JoinHandle<()>);

impl Drop for AbortOnDrop {
    fn drop(&mut self) {
        self.0.abort();
    }
}

/// Ticks the router once a second whether or not the transport is up, so heartbeat ages keep
/// growing and link health reaches delay / lost while reconnects fail.
async fn tick_router(router: Arc<Mutex<Router>>, events: mpsc::Sender<RouterEvent>, clock: TaskClock) {
    let mut ticker = tokio::time::interval(Duration::from_secs(1));
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    loop {
        ticker.tick().await;
        let evs = router.lock().await.tick(clock.now());
        if forward(&events, evs).await.is_err() {
            return;
        }
    }
}

/// Runs until the `events` receiver is dropped. Reconnects after any link error.
pub async fn run_link(url: LinkUrl, router: Arc<Mutex<Router>>, mut ch: LinkChannels) {
    let address = url.mavlink_address();
    let clock = TaskClock {
        started: Instant::now(),
    };
    let _ticker = AbortOnDrop(tokio::spawn(tick_router(
        router.clone(),
        ch.events.clone(),
        clock,
    )));
    let mut link = LinkState {
        gcs: ch.gcs.clone(),
        inspector: ch.inspector.clone(),
        ..LinkState::default()
    };
    loop {
        match tokio::time::timeout(CONNECT_TIMEOUT, mavlink::connect_async::<MavMessage>(&address)).await {
            Ok(Ok(conn)) => {
                info!(link = %url, "mavlink link connected");
                ch.stats.on_connected(clock.now().unix_ms, ch.stats.now_ms());
                let conn: Conn = Arc::from(conn);
                match receive_loop(conn, &router, &mut ch, clock, &mut link).await {
                    Ok(reason) => ch.stats.on_disconnected(Some(reason)),
                    Err(()) => {
                        ch.stats.on_disconnected(Some("link closed".into()));
                        return;
                    }
                }
            }
            Ok(Err(e)) => {
                warn!(link = %url, error = %e, "mavlink connect failed");
                ch.stats.on_disconnected(Some(e.to_string()));
            }
            Err(_) => {
                warn!(link = %url, "mavlink connect timed out");
                ch.stats.on_disconnected(Some("connect timed out".into()));
            }
        }
        if ch.events.is_closed() {
            return;
        }
        tokio::time::sleep(RECONNECT_WAIT).await;
    }
}

/// A received frame, or the receive error that ended the reader.
type ReaderItem = Result<(MavHeader, MavMessage), String>;

/// Reads frames until the link errors (the error is the last item); dropping the receiver
/// stops it.
fn spawn_reader(conn: Conn) -> mpsc::Receiver<ReaderItem> {
    let (tx, rx) = mpsc::channel(FRAME_QUEUE);
    tokio::spawn(async move {
        loop {
            match conn.recv().await {
                Ok(frame) => {
                    if tx.send(Ok(frame)).await.is_err() {
                        break;
                    }
                }
                Err(e) => {
                    warn!(error = %e, "mavlink receive error");
                    let _ = tx.send(Err(e.to_string())).await;
                    break;
                }
            }
        }
    });
    rx
}

/// Returns `Err` only when the event channel is gone (shutdown); a link error returns
/// `Ok(reason)` with the reader's error text.
async fn receive_loop(
    conn: Conn,
    router: &Arc<Mutex<Router>>,
    ch: &mut LinkChannels,
    clock: TaskClock,
    link: &mut LinkState,
) -> Result<String, ()> {
    let mut frames = spawn_reader(conn.clone());
    loop {
        tokio::select! {
            frame = frames.recv() => match frame {
                Some(Ok((header, msg))) => {
                    let now = clock.now();
                    link.inspector.record(rgcs_core::InspectorDir::Rx, &header, &msg, link.inspector.now_ms());
                    ch.stats.record(&header, &msg, ch.stats.now_ms());
                    publish_payload(ch, &header, &msg);
                    publish_guard(ch, &header, &msg);
                    let evs = router.lock().await.on_message(&header, &msg, now);
                    forward(&ch.events, evs).await?;
                    handle_special(&conn, router, ch, link, &header, &msg, now).await;
                }
                Some(Err(reason)) => return Ok(reason),
                None => return Ok("link closed".into()),
            },
            out = ch.outgoing.recv() => match out {
                Some(o) => {
                    let header = tx_frame(link, &o.message);
                    if let Err(e) = conn.send(&header, &o.message).await {
                        warn!(error = %e, "mavlink send failed");
                    }
                }
                None => return Err(()),
            },
        }
    }
}

/// Heartbeats drive stream requests; COMMAND_ACKs go to the command queue.
async fn handle_special(
    conn: &Conn,
    router: &Arc<Mutex<Router>>,
    ch: &LinkChannels,
    link: &mut LinkState,
    header: &MavHeader,
    msg: &MavMessage,
    now: Clock,
) {
    match msg {
        MavMessage::HEARTBEAT(hb) if is_flight_controller(hb.autopilot) => {
            request_streams(conn, router, link, header, now).await;
        }
        MavMessage::COMMAND_ACK(ack) => {
            let _ = ch.acks.send(Ack {
                sysid: header.system_id,
                command: ack.command,
                result: ack.result,
            });
        }
        _ => {}
    }
}

/// Camera / gimbal frames go to the payload tap; never waits (no receiver is fine).
fn publish_payload(ch: &LinkChannels, header: &MavHeader, msg: &MavMessage) {
    if let Some(frame) = crate::port::tap(header, msg) {
        let _ = ch.payload.send(frame);
    }
}

/// Guard frames go to the lossy guard tap; never waits and ignores "no receiver".
fn publish_guard(ch: &LinkChannels, header: &MavHeader, msg: &MavMessage) {
    if let Some(frame) = crate::guard_tap::tap(header, msg) {
        let _ = ch.guard.send(frame);
    }
}

/// `Updated` is high-rate and consumed through the `watch` channels, not the event queue.
async fn forward(events: &mpsc::Sender<RouterEvent>, evs: Vec<RouterEvent>) -> Result<(), ()> {
    for ev in evs.into_iter().filter(|e| !matches!(e, RouterEvent::Updated(_))) {
        events.send(ev).await.map_err(|_| ())?;
    }
    Ok(())
}

async fn request_streams(
    conn: &Conn,
    router: &Arc<Mutex<Router>>,
    link: &mut LinkState,
    fc: &MavHeader,
    now: Clock,
) {
    let last_seen: HashMap<u32, u64> = router.lock().await.last_seen(fc.system_id);
    let requester = link.requesters.remove(&fc.system_id).unwrap_or_default();
    let (next, requests) = requester.on_heartbeat(now.mono_ms, &last_seen);
    link.requesters.insert(fc.system_id, next);
    for r in requests {
        let cmd = MavMessage::COMMAND_LONG(COMMAND_LONG_DATA {
            param1: r.msg_id as f32,
            param2: r.interval_us as f32,
            command: MavCmd::MAV_CMD_SET_MESSAGE_INTERVAL,
            target_system: fc.system_id,
            target_component: fc.component_id,
            ..COMMAND_LONG_DATA::DEFAULT
        });
        let header = tx_frame(link, &cmd);
        match conn.send(&header, &cmd).await {
            Ok(_) => info!(
                sysid = fc.system_id,
                msg_id = r.msg_id,
                interval_us = r.interval_us,
                "requested stream"
            ),
            Err(e) => warn!(error = %e, msg_id = r.msg_id, "SET_MESSAGE_INTERVAL send failed"),
        }
    }
}

/// The header for one outgoing frame, recorded in the inspector as RGCS's own traffic.
fn tx_frame(link: &mut LinkState, msg: &MavMessage) -> MavHeader {
    let now_ms = link.inspector.now_ms();
    let header = next_header(link);
    link.inspector
        .record(rgcs_core::InspectorDir::Tx, &header, msg, now_ms);
    header
}

fn next_header(link: &mut LinkState) -> MavHeader {
    let sequence = link.sequence;
    link.sequence = link.sequence.wrapping_add(1);
    MavHeader {
        system_id: link.gcs.get(),
        component_id: GCS_COMPONENT_ID,
        sequence,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn outgoing_sequence_increments_and_wraps() {
        let mut link = LinkState {
            sequence: 254,
            ..LinkState::default()
        };
        assert_eq!(next_header(&mut link).sequence, 254);
        assert_eq!(next_header(&mut link).sequence, 255);
        assert_eq!(next_header(&mut link).sequence, 0);
        assert_eq!(
            next_header(&mut link).system_id,
            rgcs_core::gcs::DEFAULT_GCS_SYSID
        );
    }

    #[test]
    fn tx_frames_are_recorded_with_the_gcs_sysid() {
        let gcs = rgcs_core::GcsId::default();
        gcs.set(77);
        let inspector = crate::inspector::Inspector::default();
        let mut link = LinkState {
            gcs,
            inspector: inspector.clone(),
            ..LinkState::default()
        };
        let msg = MavMessage::HEARTBEAT(mavlink::dialects::ardupilotmega::HEARTBEAT_DATA::DEFAULT);
        let header = tx_frame(&mut link, &msg);
        assert_eq!(header.system_id, 77);
        let rows = inspector.rows(inspector.now_ms());
        assert_eq!(rows.len(), 1);
        assert_eq!(
            (rows[0].dir, rows[0].sysid, rows[0].compid),
            (rgcs_core::InspectorDir::Tx, 77, GCS_COMPONENT_ID)
        );
    }

    #[test]
    fn next_header_uses_the_current_gcs_sysid() {
        let gcs = rgcs_core::GcsId::default();
        let mut link = LinkState {
            gcs: gcs.clone(),
            ..LinkState::default()
        };
        assert_eq!(next_header(&mut link).system_id, 255);
        gcs.set(42);
        assert_eq!(next_header(&mut link).system_id, 42);
        assert_eq!(next_header(&mut link).component_id, GCS_COMPONENT_ID);
    }

    #[tokio::test]
    async fn link_channels_carry_a_payload_sender() {
        let (events, _events_rx) = mpsc::channel(1);
        let (_out_tx, outgoing) = mpsc::channel(1);
        let (acks, _) = broadcast::channel(1);
        let (payload, mut payload_rx) = broadcast::channel(crate::port::PAYLOAD_CAPACITY);
        let ch = LinkChannels {
            events,
            outgoing,
            acks,
            gcs: rgcs_core::GcsId::default(),
            inspector: crate::inspector::Inspector::default(),
            payload,
            stats: crate::link_stats::LinkStats::default(),
            guard: broadcast::channel(1).0,
        };
        let msg = MavMessage::CAMERA_INFORMATION(
            mavlink::dialects::ardupilotmega::CAMERA_INFORMATION_DATA::DEFAULT,
        );
        let header = MavHeader {
            system_id: 1,
            component_id: 100,
            sequence: 0,
        };
        publish_payload(&ch, &header, &msg);
        assert_eq!(payload_rx.recv().await.unwrap().header.component_id, 100);
    }

    fn test_channels() -> (LinkChannels, mpsc::Receiver<RouterEvent>, mpsc::Sender<Outgoing>) {
        let (events, events_rx) = mpsc::channel(16);
        let (out_tx, outgoing) = mpsc::channel(1);
        let (acks, _) = broadcast::channel(1);
        let (payload, _) = broadcast::channel(1);
        let (guard, _) = broadcast::channel(crate::guard_tap::GUARD_CAPACITY);
        let ch = LinkChannels {
            events,
            outgoing,
            acks,
            gcs: rgcs_core::GcsId::default(),
            inspector: crate::inspector::Inspector::default(),
            payload,
            stats: crate::link_stats::LinkStats::default(),
            guard,
        };
        (ch, events_rx, out_tx)
    }

    #[tokio::test]
    async fn receive_loop_returns_the_reader_error() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let address = format!("tcpout:127.0.0.1:{port}");
        let (conn, accepted) =
            tokio::join!(mavlink::connect_async::<MavMessage>(&address), listener.accept());
        drop(accepted.unwrap());
        let conn: Conn = Arc::from(conn.unwrap());
        let (mut ch, _events_rx, _out_tx) = test_channels();
        let router = Arc::new(Mutex::new(Router::default()));
        let clock = TaskClock {
            started: Instant::now(),
        };
        let mut link = LinkState::default();
        let reason = receive_loop(conn, &router, &mut ch, clock, &mut link)
            .await
            .expect("a link error is not a shutdown");
        assert!(!reason.is_empty());
        assert_ne!(reason, "link closed");
    }

    #[tokio::test]
    async fn forward_drops_updated_events() {
        let (tx, mut rx) = mpsc::channel(4);
        forward(&tx, vec![RouterEvent::Updated(1), RouterEvent::Discovered(1)])
            .await
            .unwrap();
        assert_eq!(rx.try_recv().unwrap(), RouterEvent::Discovered(1));
        assert!(rx.try_recv().is_err());
    }

    /// A link task on a local TCP pair; returns the peer socket that plays the vehicle.
    async fn link_pair() -> (Conn, tokio::net::TcpStream) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let address = format!("tcpout:127.0.0.1:{port}");
        let (conn, accepted) =
            tokio::join!(mavlink::connect_async::<MavMessage>(&address), listener.accept());
        (Arc::from(conn.unwrap()), accepted.unwrap().0)
    }

    /// Writes MAVLink 2 frames from sysid 1 / compid 1 to the peer socket.
    async fn send_frames(peer: &mut tokio::net::TcpStream, msgs: &[MavMessage]) {
        use tokio::io::AsyncWriteExt;
        let mut bytes = Vec::new();
        for (i, msg) in msgs.iter().enumerate() {
            let header = MavHeader {
                system_id: 1,
                component_id: 1,
                sequence: i as u8,
            };
            mavlink::write_v2_msg(&mut bytes, header, msg).unwrap();
        }
        peer.write_all(&bytes).await.unwrap();
    }

    fn fc_heartbeat() -> MavMessage {
        use mavlink::dialects::ardupilotmega::{MavAutopilot, MavType, HEARTBEAT_DATA};
        MavMessage::HEARTBEAT(HEARTBEAT_DATA {
            mavtype: MavType::MAV_TYPE_QUADROTOR,
            autopilot: MavAutopilot::MAV_AUTOPILOT_ARDUPILOTMEGA,
            ..HEARTBEAT_DATA::DEFAULT
        })
    }

    fn ekf_report() -> MavMessage {
        MavMessage::EKF_STATUS_REPORT(mavlink::dialects::ardupilotmega::EKF_STATUS_REPORT_DATA {
            compass_variance: 0.62,
            ..mavlink::dialects::ardupilotmega::EKF_STATUS_REPORT_DATA::DEFAULT
        })
    }

    #[tokio::test]
    async fn received_ekf_reports_reach_a_guard_subscriber() {
        let (conn, mut peer) = link_pair().await;
        let (mut ch, _events_rx, _out_tx) = test_channels();
        let mut guard_rx = ch.guard.subscribe();
        let router = Arc::new(Mutex::new(Router::default()));
        let clock = TaskClock {
            started: Instant::now(),
        };
        let task = tokio::spawn(async move {
            let mut link = LinkState::default();
            receive_loop(conn, &router, &mut ch, clock, &mut link).await
        });
        send_frames(&mut peer, &[ekf_report()]).await;
        let frame = tokio::time::timeout(Duration::from_secs(5), guard_rx.recv())
            .await
            .expect("guard frame in time")
            .unwrap();
        assert_eq!((frame.sysid, frame.compid), (1, 1));
        assert!(matches!(
            frame.body,
            crate::guard_tap::GuardBody::Ekf { compass_var, .. } if compass_var == 0.62
        ));
        task.abort();
    }

    #[tokio::test]
    async fn the_link_keeps_going_without_a_guard_subscriber() {
        let (conn, mut peer) = link_pair().await;
        let (mut ch, mut events_rx, _out_tx) = test_channels();
        assert_eq!(ch.guard.receiver_count(), 0);
        let router = Arc::new(Mutex::new(Router::default()));
        let clock = TaskClock {
            started: Instant::now(),
        };
        let task = tokio::spawn(async move {
            let mut link = LinkState::default();
            receive_loop(conn, &router, &mut ch, clock, &mut link).await
        });
        send_frames(&mut peer, &[ekf_report(), ekf_report(), fc_heartbeat()]).await;
        let ev = tokio::time::timeout(Duration::from_secs(5), events_rx.recv())
            .await
            .expect("the frame after the guard frames is still routed");
        assert_eq!(ev, Some(RouterEvent::Discovered(1)));
        task.abort();
    }
}
