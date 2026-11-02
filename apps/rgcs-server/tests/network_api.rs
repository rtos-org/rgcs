//! Network view: `GET /api/network` and the 1 Hz `network_status` frame.

mod common;

use std::time::{Duration, Instant};

use axum::http::{Method, StatusCode};
use common::{call, login, req, spawn_app};
use rgcs_core::ServerMessage;

#[tokio::test]
async fn get_network_requires_login() {
    let (app, _state) = spawn_app().await;
    let (status, _, _) = call(&app, req(Method::GET, "/api/network", None, None)).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn get_network_returns_topology() {
    let (app, _state) = spawn_app().await;
    let cookie = login(&app).await;
    let (status, body, _) = call(&app, req(Method::GET, "/api/network", Some(&cookie), None)).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["data"]["server"]["role"], "standalone");
    assert_eq!(body["data"]["links"][0]["id"], "link0");
    assert_eq!(body["data"]["unconfigured"].as_array().unwrap().len(), 6);
    assert!(body["data"]["media"]["reachable"].is_null());
}

/// Real time: a paused clock trips the in-memory store's pool timeout. Ticks are checked by
/// lower bounds only (first frame one period after start, not at once), so load cannot flake it.
#[tokio::test]
async fn status_broadcasts_every_period() {
    let (_app, state) = spawn_app().await;
    let mut rx = state.tx.subscribe();
    let period = Duration::from_millis(300);
    let start = Instant::now();
    tokio::spawn(rgcs_server::network::run_status(state.clone(), period));
    let first = next_status(&mut rx).await;
    assert!(first >= start + period, "first frame after one period");
    let second = next_status(&mut rx).await;
    assert!(second >= start + period * 2, "second frame one period later");
}

async fn next_status(rx: &mut tokio::sync::broadcast::Receiver<ServerMessage>) -> Instant {
    tokio::time::timeout(Duration::from_secs(20), async {
        loop {
            if let Ok(ServerMessage::NetworkStatus { topology }) = rx.recv().await {
                assert_eq!(topology.links[0].id, "link0");
                return Instant::now();
            }
        }
    })
    .await
    .expect("network_status within 20 s")
}
