//! While the MAVLink transport is down (reconnects keep failing), the router must still be
//! ticked so heartbeat ages grow and the vehicle goes delay → lost (3 s, 10 s).

use std::sync::Arc;
use std::time::Duration;

use mavlink::dialects::ardupilotmega::{MavAutopilot, MavMessage, MavType, HEARTBEAT_DATA};
use mavlink::MavHeader;
use rgcs_core::LinkStatus;
use rgcs_mavlink::{run_link, Clock, LinkChannels, LinkUrl, Router, RouterEvent};
use tokio::sync::{broadcast, mpsc, Mutex};

fn fc_heartbeat() -> MavMessage {
    MavMessage::HEARTBEAT(HEARTBEAT_DATA {
        mavtype: MavType::MAV_TYPE_QUADROTOR,
        autopilot: MavAutopilot::MAV_AUTOPILOT_ARDUPILOTMEGA,
        ..HEARTBEAT_DATA::DEFAULT
    })
}

/// A localhost port nobody listens on, so every connect is refused.
fn refused_port() -> u16 {
    let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    l.local_addr().unwrap().port()
}

#[tokio::test(start_paused = true)]
async fn vehicle_goes_lost_while_the_link_is_down() {
    let mut router = Router::default();
    let header = MavHeader {
        system_id: 1,
        component_id: 1,
        sequence: 0,
    };
    router.on_message(&header, &fc_heartbeat(), Clock::default());
    let router = Arc::new(Mutex::new(router));
    let (events, mut events_rx) = mpsc::channel(64);
    let (_out_tx, outgoing) = mpsc::channel(1);
    let (acks, _) = broadcast::channel(1);
    let (payload, _) = broadcast::channel(4);
    let ch = LinkChannels {
        events,
        outgoing,
        acks,
        gcs: rgcs_core::GcsId::default(),
        inspector: rgcs_mavlink::Inspector::default(),
        payload,
        stats: rgcs_mavlink::LinkStats::default(),
        guard: broadcast::channel(rgcs_mavlink::GUARD_CAPACITY).0,
    };
    let url: LinkUrl = format!("tcp:127.0.0.1:{}", refused_port()).parse().unwrap();
    let task = tokio::spawn(run_link(url, router.clone(), ch));

    let mut seen = Vec::new();
    let deadline = tokio::time::Instant::now() + Duration::from_secs(13);
    while !seen.contains(&LinkStatus::Lost) {
        let ev = tokio::time::timeout_at(deadline, events_rx.recv())
            .await
            .expect("vehicle never went lost while the link was down")
            .expect("event channel closed");
        if let RouterEvent::LinkChanged { sysid: 1, to, .. } = ev {
            seen.push(to);
        }
    }
    assert_eq!(seen, vec![LinkStatus::Delay, LinkStatus::Lost]);
    let state = router.lock().await.state(1).cloned().unwrap();
    assert_eq!(state.link, LinkStatus::Lost);
    assert!(state.last_rx_ms >= 10_000, "{}", state.last_rx_ms);
    task.abort();
}
