//! Auto record failures reach the operator and are retried once.
mod common;

use std::time::Duration;

use axum::http::{Method, StatusCode};
use common::*;
use rgcs_camera::siyi::sim::SimServer;
use rgcs_core::ServerMessage;
use rgcs_server::app::AppState;
use serde_json::json;
use tokio::sync::broadcast;

async fn wait_link(state: &AppState, up: bool) {
    for _ in 0..80 {
        if state.cameras.ensure(1).await.state().borrow().connected == up {
            return;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    panic!("camera link never became {up}");
}

async fn warned(rx: &mut broadcast::Receiver<ServerMessage>, text: &str) -> bool {
    tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            match rx.recv().await {
                Ok(ServerMessage::VehicleMessage(m)) if m.text == text && m.severity == 4 => return true,
                Err(broadcast::error::RecvError::Closed) => return false,
                _ => {}
            }
        }
    })
    .await
    .unwrap_or(false)
}

async fn saw_record_toggle(sim: &mut SimServer) -> bool {
    for _ in 0..60 {
        while let Ok((_, cmd, payload)) = sim.received.try_recv() {
            if cmd == 0x0C && payload == [2] {
                return true;
            }
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    false
}

#[tokio::test]
async fn failed_arm_start_warns_and_retries_when_the_camera_returns() {
    let (app, state, sim) = spawn_app_with_sim().await;
    let port = sim.addr.port();
    seed_vehicle(&state, 1, false, false).await;
    let cookie = login(&app).await;
    let body = json!({ "kind": "siyi_mt11", "host": "127.0.0.1", "port": port });
    let (s, v, _) = call(
        &app,
        req(
            Method::PUT,
            "/api/vehicles/1/camera/profile",
            Some(&cookie),
            Some(body),
        ),
    )
    .await;
    assert_eq!(s, StatusCode::OK, "{v}");
    wait_link(&state, true).await;
    let runner = rgcs_server::auto_record::spawn(state.clone());
    tokio::time::sleep(Duration::from_millis(700)).await;
    sim.stop().await;
    wait_link(&state, false).await;

    let mut rx = state.tx.subscribe();
    seed_vehicle(&state, 1, true, false).await;
    assert!(
        warned(&mut rx, "auto_record_failed").await,
        "operator warned of the failed start"
    );

    let mut sim = SimServer::start_on(port).await;
    assert!(
        saw_record_toggle(&mut sim).await,
        "start retried once the camera is back"
    );
    runner.abort();
}
