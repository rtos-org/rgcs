//! Persistent message log, global log API and acknowledgement of warnings/errors only
//! (70 audit, 2026-10-18 design).

mod common;

use std::time::Duration;

use axum::http::{Method, StatusCode};
use common::{call, error_code, login, req, spawn_app};
use rgcs_core::{CommandResult, MessageSource, ServerMessage, Severity, VehicleMessage};
use rgcs_mavlink::RouterEvent;
use rgcs_server::message_log::run_recorder;
use rgcs_store::messages::NewMessage;
use tokio::sync::mpsc;

fn new(sysid: Option<u8>, source: MessageSource, severity: Severity, text: &str) -> NewMessage {
    NewMessage {
        ts: 1_000,
        sysid,
        source,
        severity,
        raw_severity: None,
        text: text.into(),
    }
}

async fn next_frame(
    rx: &mut tokio::sync::broadcast::Receiver<ServerMessage>,
    want: impl Fn(&ServerMessage) -> bool,
) -> ServerMessage {
    tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            if let Ok(m) = rx.recv().await {
                if want(&m) {
                    return m;
                }
            }
        }
    })
    .await
    .expect("frame within 3 s")
}

#[tokio::test]
async fn statustext_is_persisted_and_broadcast_with_its_row_id() {
    let (_app, state) = spawn_app().await;
    let mut rx = state.tx.subscribe();
    let (events_tx, events_rx) = mpsc::channel(8);
    let (out_tx, _out_rx) = mpsc::channel(8);
    let sinks = rgcs_server::telemetry::EventSinks {
        outgoing: out_tx,
        ..rgcs_server::telemetry::EventSinks::of(&state)
    };
    tokio::spawn(rgcs_server::telemetry::pump_events(
        events_rx,
        state.tx.clone(),
        sinks,
    ));
    events_tx
        .send(RouterEvent::Message(VehicleMessage::new(
            1,
            77,
            4,
            "PreArm: GPS".into(),
            5_000,
            MessageSource::Vehicle,
        )))
        .await
        .unwrap();
    let frame = next_frame(&mut rx, |m| matches!(m, ServerMessage::VehicleMessage(_))).await;
    let ServerMessage::VehicleMessage(m) = frame else {
        unreachable!()
    };
    let stored = state
        .store
        .messages(Some(1), None, rgcs_store::messages::SeverityFilter::All, 10)
        .await
        .unwrap();
    assert_eq!(stored.len(), 1);
    assert_eq!(m.id as i64, stored[0].id, "the WS id is the row id");
    assert_eq!(
        (m.level, m.source, m.ackable),
        (Severity::Warn, MessageSource::Vehicle, true)
    );
    assert_eq!(stored[0].text, "PreArm: GPS");
}

#[tokio::test]
async fn ack_rules() {
    let (app, state) = spawn_app().await;
    let admin = login(&app).await;
    let mut rx = state.tx.subscribe();
    let warn = state
        .store
        .record_message(&new(Some(1), MessageSource::Vehicle, Severity::Warn, "PreArm"))
        .await
        .unwrap();
    let info = state
        .store
        .record_message(&new(Some(1), MessageSource::Vehicle, Severity::Info, "EKF ok"))
        .await
        .unwrap();
    let cmd = state
        .store
        .record_message(&new(
            Some(1),
            MessageSource::Command,
            Severity::Error,
            "arm failed",
        ))
        .await
        .unwrap();

    let path = |id: i64| format!("/api/vehicles/1/messages/{id}/ack");
    let (status, body, _) = call(&app, req(Method::POST, &path(warn.id), Some(&admin), None)).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["data"]["acked_by"], "admin");
    let first_at = body["data"]["acked_at"].as_u64().unwrap();
    let frame = next_frame(&mut rx, |m| matches!(m, ServerMessage::MessageAck { .. })).await;
    assert!(
        matches!(frame, ServerMessage::MessageAck { sysid: 1, id, ref by, .. } if id == warn.id && by == "admin")
    );

    let (status, body, _) = call(&app, req(Method::POST, &path(warn.id), Some(&admin), None)).await;
    assert_eq!(
        (status, body["data"]["acked_at"].as_u64()),
        (StatusCode::OK, Some(first_at)),
        "idempotent"
    );
    for id in [info.id, cmd.id] {
        let (status, body, _) = call(&app, req(Method::POST, &path(id), Some(&admin), None)).await;
        assert_eq!(
            (status, error_code(&body)),
            (StatusCode::BAD_REQUEST, "not_ackable")
        );
    }
    let (status, _, _) = call(
        &app,
        req(
            Method::POST,
            &format!("/api/vehicles/2/messages/{}/ack", warn.id),
            Some(&admin),
            None,
        ),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (_, audit, _) = call(
        &app,
        req(Method::GET, "/api/history/audit?limit=20", Some(&admin), None),
    )
    .await;
    let acks = audit["data"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|e| e["command"] == "message_ack")
        .count();
    assert_eq!(acks, 1, "one audit row for one acknowledgement");
}

#[tokio::test]
async fn global_log_merges_vehicle_command_and_link_entries() {
    let (app, state) = spawn_app().await;
    let admin = login(&app).await;
    for (sysid, src, sev, text) in [
        (Some(1), MessageSource::Vehicle, Severity::Info, "a"),
        (Some(1), MessageSource::Link, Severity::Error, "link_lost"),
        (Some(2), MessageSource::Command, Severity::Ok, "arm ok"),
        (Some(2), MessageSource::Vehicle, Severity::Warn, "d"),
    ] {
        state
            .store
            .record_message(&new(sysid, src, sev, text))
            .await
            .unwrap();
    }
    let (status, body, _) = call(&app, req(Method::GET, "/api/messages", Some(&admin), None)).await;
    assert_eq!(status, StatusCode::OK);
    let texts: Vec<&str> = body["data"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["text"].as_str().unwrap())
        .collect();
    assert_eq!(texts, vec!["d", "arm ok", "link_lost", "a"]);
    let (_, body, _) = call(
        &app,
        req(Method::GET, "/api/messages?severity=alerts", Some(&admin), None),
    )
    .await;
    assert_eq!(body["data"].as_array().unwrap().len(), 2);
    let (_, body, _) = call(
        &app,
        req(Method::GET, "/api/messages?limit=2", Some(&admin), None),
    )
    .await;
    assert_eq!(body["data"].as_array().unwrap().len(), 2);
    let (_, body, _) = call(
        &app,
        req(Method::GET, "/api/messages?sysid=1", Some(&admin), None),
    )
    .await;
    assert_eq!(body["data"].as_array().unwrap().len(), 2);
    let (_, body, _) = call(
        &app,
        req(Method::GET, "/api/vehicles/2/messages", Some(&admin), None),
    )
    .await;
    assert_eq!(body["data"].as_array().unwrap().len(), 2);
    let (status, body, _) = call(
        &app,
        req(Method::GET, "/api/messages?severity=loud", Some(&admin), None),
    )
    .await;
    assert_eq!(
        (status, error_code(&body)),
        (StatusCode::BAD_REQUEST, "validation")
    );
}

#[tokio::test]
async fn command_results_are_logged_and_broadcast_as_log_entries() {
    let (app, state) = spawn_app().await;
    let admin = login(&app).await;
    let mut rx = state.tx.subscribe();
    tokio::spawn(run_recorder(state.messages.clone(), state.tx.subscribe()));
    tokio::time::sleep(Duration::from_millis(50)).await;
    let _ = state.tx.send(ServerMessage::CommandResult(CommandResult {
        id: 9,
        sysid: 1,
        cmd: "arm".into(),
        ok: false,
        reason: Some("PreArm".into()),
        ts: 2_000,
        mav_cmd: None,
    }));
    let frame = next_frame(&mut rx, |m| matches!(m, ServerMessage::LogEntry(_))).await;
    let ServerMessage::LogEntry(e) = frame else {
        unreachable!()
    };
    assert_eq!(
        (e.source, e.severity, e.sysid, e.ackable),
        (MessageSource::Command, Severity::Error, Some(1), false)
    );
    assert_eq!(e.text, "arm PreArm");
    let (_, body, _) = call(&app, req(Method::GET, "/api/messages", Some(&admin), None)).await;
    assert_eq!(body["data"][0]["id"].as_i64(), Some(e.id));

    // A successful result keeps its reason too (e.g. the mission upload's 読込一致).
    let _ = state.tx.send(ServerMessage::CommandResult(CommandResult {
        id: 10,
        sysid: 1,
        cmd: "mission_upload".into(),
        ok: true,
        reason: Some("verified".into()),
        ts: 3_000,
        mav_cmd: None,
    }));
    let frame = next_frame(&mut rx, |m| matches!(m, ServerMessage::LogEntry(_))).await;
    let ServerMessage::LogEntry(e) = frame else {
        unreachable!()
    };
    assert_eq!(
        (e.severity, e.text.as_str()),
        (Severity::Ok, "mission_upload verified")
    );

    // An `other` result names its MAV_CMD so the UI can label it (WP へ移動, メッセージレート設定).
    let _ = state.tx.send(ServerMessage::CommandResult(CommandResult {
        id: 11,
        sysid: 1,
        cmd: "other".into(),
        ok: false,
        reason: Some("denied".into()),
        ts: 4_000,
        mav_cmd: Some(511),
    }));
    let frame = next_frame(&mut rx, |m| matches!(m, ServerMessage::LogEntry(_))).await;
    let ServerMessage::LogEntry(e) = frame else {
        unreachable!()
    };
    assert_eq!(e.text, "other:511 denied");
}

fn statustext(router_id: u64, text: &str) -> VehicleMessage {
    VehicleMessage::new(1, router_id, 4, text.into(), 5_000, MessageSource::Vehicle)
}

#[tokio::test]
async fn queued_messages_get_their_row_ids_in_order() {
    let store = rgcs_store::Store::open_memory().await.unwrap();
    let (tx, mut rx) = tokio::sync::broadcast::channel(256);
    let log = rgcs_server::message_log::MessageLog::spawn(store.clone(), tx.clone());
    for i in 0..50 {
        log.submit(statustext(i, &format!("m{i}"))); // not async: the MAVLink pump never waits on SQLite
    }
    let mut ids = Vec::new();
    while ids.len() < 50 {
        if let ServerMessage::VehicleMessage(m) =
            next_frame(&mut rx, |m| matches!(m, ServerMessage::VehicleMessage(_))).await
        {
            ids.push(m.id as i64);
        }
    }
    let rows = store
        .messages(None, None, rgcs_store::messages::SeverityFilter::All, 100)
        .await
        .unwrap();
    let mut row_ids: Vec<i64> = rows.iter().map(|e| e.id).collect();
    row_ids.reverse();
    assert_eq!(ids, row_ids, "frames carry the row ids, in arrival order");
}

#[tokio::test]
async fn an_unstored_message_gets_a_non_colliding_unackable_id() {
    let store = rgcs_store::Store::open_memory().await.unwrap();
    store
        .record_message(&new(Some(1), MessageSource::Vehicle, Severity::Warn, "stored"))
        .await
        .unwrap();
    let (tx, mut rx) = tokio::sync::broadcast::channel(16);
    let log = rgcs_server::message_log::MessageLog::spawn(store.clone(), tx.clone());
    store.close().await; // e.g. the SD card is full: every insert fails
    log.submit(statustext(1, "PreArm: GPS"));
    let ServerMessage::VehicleMessage(m) =
        next_frame(&mut rx, |m| matches!(m, ServerMessage::VehicleMessage(_))).await
    else {
        unreachable!()
    };
    assert!(
        m.id >= rgcs_server::message_log::UNSTORED_ID_BASE,
        "id {} could collide with a row id",
        m.id
    );
    assert!(!m.ackable, "the server cannot acknowledge a row it never stored");
    assert_eq!(m.text, "PreArm: GPS");
}

#[tokio::test]
async fn startup_prunes_to_the_cap() {
    let store = rgcs_store::Store::open_memory().await.unwrap();
    for i in 0..30 {
        store
            .record_message(&new(
                Some(1),
                MessageSource::Vehicle,
                Severity::Info,
                &format!("m{i}"),
            ))
            .await
            .unwrap();
    }
    let (tx, _rx) = tokio::sync::broadcast::channel(16);
    let _log = rgcs_server::message_log::MessageLog::spawn_with(store.clone(), tx, 10);
    tokio::time::timeout(Duration::from_secs(3), async {
        while store
            .messages(None, None, rgcs_store::messages::SeverityFilter::All, 100)
            .await
            .unwrap()
            .len()
            > 10
        {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("pruned to 10 rows at startup, before 1,000 inserts");
}
