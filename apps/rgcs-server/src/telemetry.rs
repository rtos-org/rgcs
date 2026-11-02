//! Turns router events into WebSocket frames: immediate frames for discoveries and
//! messages, and a 10 Hz diff of every vehicle state.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use rgcs_core::{
    diff, LinkStatus, MessageSource, ServerMessage, Severity, SysId, VehicleMessage, VehicleState,
    VehicleStateDiff,
};
use rgcs_mavlink::{Router, RouterEvent};
use tokio::sync::{broadcast, mpsc, Mutex};

/// Frames to send for the current states, given what each client last saw.
/// Returns the frames and the new "last sent" map.
pub fn diff_frames(
    last_sent: &HashMap<SysId, VehicleState>,
    current: &[VehicleState],
) -> (Vec<ServerMessage>, HashMap<SysId, VehicleState>) {
    let mut frames = Vec::new();
    let mut next = HashMap::with_capacity(current.len());
    for state in current {
        let frame = match last_sent.get(&state.sysid) {
            None => Some(VehicleStateDiff::full(state)),
            Some(prev) => diff(prev, state),
        };
        if let Some(d) = frame {
            frames.push(ServerMessage::Telemetry {
                sysid: state.sysid,
                diff: d,
            });
        }
        next.insert(state.sysid, state.clone());
    }
    (frames, next)
}

/// Link-change messages are minted here, not by the router; keep their ids far from its range.
pub const LINK_MESSAGE_ID_BASE: u64 = 1 << 40;
static NEXT_LINK_MESSAGE_ID: AtomicU64 = AtomicU64::new(LINK_MESSAGE_ID_BASE);

/// Text codes the UI translates (`vehicle_message`); vehicle text stays verbatim.
fn link_code(to: LinkStatus) -> (&'static str, u8, Severity) {
    match to {
        LinkStatus::Delay => ("comms_delay", 4, Severity::Warn),
        LinkStatus::Lost => ("link_lost", 4, Severity::Error),
        LinkStatus::Ok => ("link_restored", 6, Severity::Ok),
    }
}

/// The WebSocket frame for one router event, if the clients need to hear about it.
pub fn event_frame(ev: RouterEvent, now_ms: u64) -> Option<ServerMessage> {
    match ev {
        RouterEvent::Discovered(sysid) => Some(ServerMessage::VehicleDiscovered { sysid }),
        RouterEvent::Message(m) => Some(ServerMessage::VehicleMessage(m)),
        RouterEvent::LinkChanged { sysid, to, .. } => {
            let (text, severity, level) = link_code(to);
            Some(ServerMessage::VehicleMessage(VehicleMessage::with_level(
                sysid,
                NEXT_LINK_MESSAGE_ID.fetch_add(1, Ordering::Relaxed),
                severity,
                text.into(),
                now_ms,
                MessageSource::Link,
                level,
            )))
        }
        RouterEvent::Updated(_)
        | RouterEvent::ParamValue { .. }
        | RouterEvent::Mission { .. }
        | RouterEvent::Log { .. }
        | RouterEvent::Calib { .. } => None,
    }
}

/// Forwards discovery / message / link events straight to the clients; caches PARAM_VALUEs.
/// Parameters the mission validation needs; asked for as soon as a vehicle appears.
pub const FENCE_PARAMS: [&str; 4] = ["FENCE_ENABLE", "FENCE_ALT_MAX", "FENCE_RADIUS", "FENCE_TYPE"];

/// Where router events go besides the WebSocket.
#[derive(Clone)]
pub struct EventSinks {
    pub params: crate::params::ParamCache,
    pub missions: crate::missions::MissionHub,
    pub logs: crate::logs::LogHub,
    pub calib: crate::calibration::CalibHub,
    pub messages: crate::message_log::MessageLog,
    pub outgoing: mpsc::Sender<rgcs_mavlink::Outgoing>,
}

impl EventSinks {
    pub fn of(app: &crate::app::AppState) -> Self {
        Self {
            params: app.params.clone(),
            missions: app.missions.clone(),
            logs: app.logs.clone(),
            calib: app.calib.clone(),
            messages: app.messages.clone(),
            outgoing: app.outgoing.clone(),
        }
    }
}

pub async fn pump_events(
    mut events: mpsc::Receiver<RouterEvent>,
    tx: broadcast::Sender<ServerMessage>,
    sinks: EventSinks,
) {
    let EventSinks {
        params,
        missions,
        logs,
        calib,
        messages,
        outgoing,
    } = sinks;
    while let Some(ev) = events.recv().await {
        params.apply(&ev);
        match &ev {
            RouterEvent::Mission { sysid, frame } => missions.on_frame(*sysid, frame.clone()),
            RouterEvent::Log { sysid, frame } => logs.on_frame(*sysid, frame.clone()),
            RouterEvent::Calib { sysid, frame } => calib.on_frame(*sysid, frame),
            RouterEvent::Discovered(sysid) => {
                for name in FENCE_PARAMS {
                    let _ = outgoing.try_send(rgcs_mavlink::Outgoing {
                        message: rgcs_mavlink::encode_param_request_read(*sysid, name),
                    });
                }
            }
            _ => {}
        }
        match event_frame(ev, crate::app::unix_ms()) {
            // Persist first so the frame carries the message-log row id (acknowledgements use it).
            // Stored and broadcast with its row id by the recorder task; the pump never waits on SQLite.
            Some(ServerMessage::VehicleMessage(m)) => messages.submit(m),
            Some(f) => {
                let _ = tx.send(f);
            }
            None => {}
        }
    }
}

/// Emits telemetry diffs at a fixed interval for the lifetime of the server. A stalled tick
/// (long router lock) is skipped rather than replayed as a burst.
pub async fn diff_loop(router: Arc<Mutex<Router>>, tx: broadcast::Sender<ServerMessage>, interval: Duration) {
    let mut ticker = tokio::time::interval(interval);
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let mut last_sent: HashMap<SysId, VehicleState> = HashMap::new();
    loop {
        ticker.tick().await;
        let current = router.lock().await.states();
        let (frames, next) = diff_frames(&last_sent, &current);
        last_sent = next;
        for f in frames {
            let _ = tx.send(f);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rgcs_core::LinkStatus;

    #[tokio::test]
    async fn discovery_requests_the_fence_params() {
        use mavlink::dialects::ardupilotmega::MavMessage;
        let (events_tx, events_rx) = mpsc::channel(8);
        let (tx, _keep) = broadcast::channel(8);
        let (out_tx, mut out_rx) = mpsc::channel(8);
        let hub = crate::missions::MissionHub::new(tx.clone(), rgcs_core::GcsId::default());
        let params = crate::params::ParamCache::new(tx.clone());
        let logs = crate::logs::LogHub::new(tx.clone(), true);
        let store = rgcs_store::Store::open_memory().await.unwrap();
        let calib = crate::calibration::CalibHub::new(tx.clone(), store.clone());
        let messages = crate::message_log::MessageLog::spawn(store, tx.clone());
        let sinks = EventSinks {
            params,
            missions: hub,
            logs,
            calib,
            messages,
            outgoing: out_tx,
        };
        tokio::spawn(pump_events(events_rx, tx, sinks));
        events_tx.send(RouterEvent::Discovered(1)).await.unwrap();
        let mut names = Vec::new();
        for _ in 0..3 {
            let o = tokio::time::timeout(Duration::from_secs(1), out_rx.recv())
                .await
                .unwrap()
                .unwrap();
            if let MavMessage::PARAM_REQUEST_READ(p) = o.message {
                names.push(
                    String::from_utf8_lossy(&*p.param_id)
                        .trim_end_matches('\0')
                        .to_string(),
                );
            }
        }
        names.sort();
        assert_eq!(names, vec!["FENCE_ALT_MAX", "FENCE_ENABLE", "FENCE_RADIUS"]);
    }

    #[test]
    fn link_changes_become_vehicle_messages_with_stable_codes() {
        let f = |from, to| event_frame(RouterEvent::LinkChanged { sysid: 1, from, to }, 1_000);
        let texts: Vec<(u8, String)> = [
            f(LinkStatus::Ok, LinkStatus::Delay),
            f(LinkStatus::Delay, LinkStatus::Lost),
            f(LinkStatus::Lost, LinkStatus::Ok),
        ]
        .into_iter()
        .map(|fr| match fr {
            Some(ServerMessage::VehicleMessage(m)) => (m.severity, m.text),
            other => panic!("{other:?}"),
        })
        .collect();
        assert_eq!(
            texts,
            vec![
                (4, "comms_delay".into()),
                (4, "link_lost".into()),
                (6, "link_restored".into())
            ]
        );
        assert!(event_frame(RouterEvent::Updated(1), 0).is_none());
    }

    #[test]
    fn link_message_ids_are_unique_and_do_not_collide_with_router_ids() {
        let a = event_frame(
            RouterEvent::LinkChanged {
                sysid: 1,
                from: LinkStatus::Ok,
                to: LinkStatus::Delay,
            },
            0,
        );
        let b = event_frame(
            RouterEvent::LinkChanged {
                sysid: 1,
                from: LinkStatus::Delay,
                to: LinkStatus::Ok,
            },
            0,
        );
        let id = |f: Option<ServerMessage>| match f {
            Some(ServerMessage::VehicleMessage(m)) => m.id,
            other => panic!("{other:?}"),
        };
        let (ia, ib) = (id(a), id(b));
        assert_ne!(ia, ib);
        assert!(ia >= LINK_MESSAGE_ID_BASE && ib >= LINK_MESSAGE_ID_BASE);
    }

    #[test]
    fn first_sight_sends_the_full_state_then_only_changes() {
        let v = VehicleState::new(1, "UAV-01");
        let (frames, sent) = diff_frames(&HashMap::new(), std::slice::from_ref(&v));
        assert_eq!(frames.len(), 1);
        match &frames[0] {
            ServerMessage::Telemetry { sysid, diff } => {
                assert_eq!(*sysid, 1);
                assert_eq!(diff.name.as_deref(), Some("UAV-01"));
            }
            other => panic!("{other:?}"),
        }
        let (frames, _) = diff_frames(&sent, std::slice::from_ref(&v));
        assert!(frames.is_empty());
        let moved = VehicleState { alt_rel: 5.0, ..v };
        let (frames, _) = diff_frames(&sent, &[moved]);
        assert_eq!(frames.len(), 1);
        match &frames[0] {
            ServerMessage::Telemetry { diff, .. } => {
                assert_eq!((diff.alt_rel, diff.name.is_none()), (Some(5.0), true))
            }
            other => panic!("{other:?}"),
        }
    }
}
