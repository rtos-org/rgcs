//! Review focus 3 and 4: the client address survives `into_make_service_with_connect_info`,
//! and a closed socket leaves no ghost session.

mod common;

use std::net::SocketAddr;
use std::time::Duration;

use futures::StreamExt;
use rgcs_server::app;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::HeaderValue;

async fn wait_for(what: &str, mut ok: impl FnMut() -> bool) {
    for _ in 0..100 {
        if ok() {
            return;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    panic!("timed out waiting for {what}");
}

#[tokio::test]
async fn ws_session_is_listed_with_address_and_removed_on_close() {
    let (router, state) = common::spawn_app().await;
    let cookie = common::login(&router).await;
    let served = app::build(state.clone(), None).into_make_service_with_connect_info::<SocketAddr>();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let server = tokio::spawn(async move { axum::serve(listener, served).await });

    let mut req = format!("ws://127.0.0.1:{port}/ws").into_client_request().unwrap();
    req.headers_mut()
        .insert("cookie", HeaderValue::from_str(&cookie).unwrap());
    req.headers_mut()
        .insert("user-agent", HeaderValue::from_static("test Firefox/131.0"));
    let (mut socket, _) = tokio_tungstenite::connect_async(req).await.expect("ws connect");
    let first = socket.next().await.expect("snapshot frame").expect("frame ok");
    assert!(first.to_text().unwrap().contains("snapshot"));

    let rows = state.sessions.list();
    assert_eq!(rows.len(), 1);
    assert!(
        rows[0].addr.as_deref().unwrap_or("").starts_with("127.0.0.1:"),
        "{:?}",
        rows[0].addr
    );
    assert_eq!(rows[0].browser, "Firefox");
    assert_eq!(rows[0].username, "admin");

    drop(socket);
    wait_for("session removal", || state.sessions.list().is_empty()).await;
    server.abort();
}

/// A WS client with this request; the first (snapshot) frame is already read.
async fn connect_client(
    port: u16,
    cookie: &str,
) -> tokio_tungstenite::WebSocketStream<tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>> {
    let mut req = format!("ws://127.0.0.1:{port}/ws").into_client_request().unwrap();
    req.headers_mut()
        .insert("cookie", HeaderValue::from_str(cookie).unwrap());
    let (mut socket, _) = tokio_tungstenite::connect_async(req).await.expect("ws connect");
    socket.next().await.expect("snapshot frame").expect("frame ok");
    socket
}

/// A half-open socket (the client never answers a ping) is dropped after the
/// 45 s idle timeout; a client that keeps reading (and so answers pings) stays listed.
#[tokio::test]
async fn half_open_ws_session_is_dropped_after_the_idle_timeout() {
    let (router, state) = common::spawn_app().await;
    let cookie = common::login(&router).await;
    let served = app::build(state.clone(), None).into_make_service_with_connect_info::<SocketAddr>();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let server = tokio::spawn(async move { axum::serve(listener, served).await });

    let silent = connect_client(port, &cookie).await;
    let mut live = connect_client(port, &cookie).await;
    let reader = tokio::spawn(async move { while let Some(Ok(_)) = live.next().await {} });
    wait_for("two sessions", || state.sessions.list().len() == 2).await;

    tokio::time::pause();
    tokio::time::sleep(Duration::from_secs(30)).await;
    assert_eq!(state.sessions.list().len(), 2, "both live before the timeout");
    tokio::time::sleep(Duration::from_secs(30)).await;
    wait_for("the half-open session to drop", || {
        state.sessions.list().len() == 1
    })
    .await;
    tokio::time::sleep(Duration::from_secs(60)).await;
    assert_eq!(state.sessions.list().len(), 1, "the answering client stays");
    drop(silent);
    reader.abort();
    server.abort();
}
