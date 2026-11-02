//! The driver's info / stream requests must never fill (or wait on) the
//! shared outgoing queue while the FC link is down.

use std::time::Duration;

use mavlink::dialects::ardupilotmega::{MavMessage, HEARTBEAT_DATA};
use mavlink::MavHeader;
use rgcs_mavlink::{MavPort, Outgoing, PayloadFrame, PAYLOAD_CAPACITY};
use tokio::sync::{broadcast, mpsc};
use tokio::time::{sleep, timeout};

use super::*;
use crate::mavlink_cam::binding::tests::cam_info;
use crate::Camera;

/// A port whose outgoing queue (capacity `cap`) is never drained: a dead or stuck link.
fn stuck_port(
    cap: usize,
) -> (
    MavPort,
    mpsc::Sender<Outgoing>,
    mpsc::Receiver<Outgoing>,
    broadcast::Sender<PayloadFrame>,
) {
    let (out_tx, out_rx) = mpsc::channel(cap);
    let (acks, _) = broadcast::channel(8);
    let (payload, _) = broadcast::channel(PAYLOAD_CAPACITY);
    (
        MavPort::new(out_tx.clone(), acks, payload.clone()),
        out_tx,
        out_rx,
        payload,
    )
}

fn frame(message: MavMessage) -> PayloadFrame {
    PayloadFrame {
        header: MavHeader {
            system_id: 1,
            component_id: 1,
            sequence: 0,
        },
        message,
    }
}

fn heartbeat() -> PayloadFrame {
    frame(MavMessage::HEARTBEAT(HEARTBEAT_DATA::DEFAULT))
}

#[tokio::test(start_paused = true)]
async fn a_dead_link_does_not_block_a_vehicle_command() {
    let (port, vehicle_queue, _out_rx, _payload) = stuck_port(4);
    let cam = MavlinkCamera::new(1, 100, port);
    cam.connect().await.expect("connect");
    sleep(Duration::from_secs(30)).await;
    let command = Outgoing {
        message: MavMessage::HEARTBEAT(HEARTBEAT_DATA::DEFAULT),
    };
    let sent = timeout(Duration::from_millis(100), vehicle_queue.send(command)).await;
    assert!(
        sent.is_ok(),
        "the camera requests filled the vehicle's outgoing queue"
    );
}

#[tokio::test(start_paused = true)]
async fn a_full_queue_never_stalls_the_actor() {
    let (port, _vehicle_queue, _out_rx, payload) = stuck_port(1);
    let cam = MavlinkCamera::new(1, 100, port);
    cam.connect().await.expect("connect");
    for _ in 0..10 {
        let _ = payload.send(heartbeat());
        sleep(Duration::from_millis(1_000)).await;
    }
    let info = MavMessage::CAMERA_INFORMATION(cam_info(1, 0x02, 0));
    let _ = payload.send(frame(info));
    sleep(Duration::from_millis(100)).await;
    assert!(cam.caps().photo, "the actor kept reading frames");
}

#[tokio::test(start_paused = true)]
async fn requests_wait_for_a_heartbeat() {
    let (port, _vehicle_queue, mut out_rx, payload) = stuck_port(16);
    let cam = MavlinkCamera::new(1, 100, port);
    cam.connect().await.expect("connect");
    sleep(Duration::from_secs(5)).await;
    assert!(out_rx.try_recv().is_err(), "no heartbeat: nothing asked");
    let _ = payload.send(heartbeat());
    sleep(Duration::from_millis(300)).await;
    assert!(out_rx.try_recv().is_ok(), "a heartbeat starts the info requests");
}
