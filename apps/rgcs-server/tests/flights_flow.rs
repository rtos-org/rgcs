//! ARM → DISARM on a (fake) SITL creates a 様式 1 draft with times, positions and the pilot.

mod common;

use axum::http::{Method, StatusCode};
use common::{call, login, req, seed_copter, seed_position, spawn_app};
use rgcs_core::{FlightStatus, ServerMessage};
use rgcs_store::audit::AuditInput;

const COPTER_STABILIZE: u32 = 0;

#[tokio::test]
async fn sitl_like_arm_disarm_creates_a_draft_with_times_and_positions() {
    let (app, state) = spawn_app().await;
    state
        .store
        .record_audit(AuditInput {
            operator: "admin",
            sysid: Some(1),
            target: "vehicle",
            command: "arm",
            args: None,
            result: "ok",
            reason: None,
        })
        .await
        .unwrap();
    let mut rx = state.tx.subscribe();
    seed_copter(&state, 1, COPTER_STABILIZE, true, false).await;
    seed_position(&state, 1, 35.481883, 138.48029, 3).await;
    state.flights.poll(&state.router, 10_000).await;
    assert!(
        state.store.open_flight_of(1).await.unwrap().is_some(),
        "draft opened at ARM"
    );
    seed_copter(&state, 1, COPTER_STABILIZE, false, false).await;
    state.flights.poll(&state.router, 70_000).await;

    let mut draft = None;
    while let Ok(msg) = rx.try_recv() {
        if let ServerMessage::FlightDraftCreated { sysid: 1, flight } = msg {
            draft = Some(flight);
        }
    }
    let flight = draft.expect("flight_draft_created frame");
    assert_eq!(
        (
            flight.status,
            flight.flight_minutes,
            flight.takeoff_at,
            flight.landed_at
        ),
        (FlightStatus::Draft, 1, 10_000, Some(70_000))
    );
    assert!((flight.takeoff_lat.unwrap() - 35.481883).abs() < 1e-6);
    assert!(flight.landing_lon.is_some());
    assert_eq!(flight.pilot, "admin");

    let admin = login(&app).await;
    let (status, body, _) = call(
        &app,
        req(Method::GET, "/api/vehicles/1/flights", Some(&admin), None),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"].as_array().unwrap().len(), 1);
    assert_eq!(body["data"][0]["id"].as_i64(), Some(flight.id));
}

#[tokio::test]
async fn restart_adopts_the_open_draft() {
    let (_app, state) = spawn_app().await;
    let id = state
        .store
        .open_flight(1, "admin", "", 5_000, None, None, "system")
        .await
        .unwrap();
    // A fresh tracker (as after a server restart) adopts the row before its first tick.
    state.flights.adopt_open_flights(9_000).await;
    seed_copter(&state, 1, COPTER_STABILIZE, true, false).await;
    state.flights.poll(&state.router, 10_000).await;
    assert_eq!(
        state.store.list_flights(1, None, None).await.unwrap().len(),
        1,
        "no second flight"
    );
    seed_copter(&state, 1, COPTER_STABILIZE, false, false).await;
    state.flights.poll(&state.router, 70_000).await;
    let f = state.store.flight(id).await.unwrap().unwrap();
    assert_eq!((f.landed_at, f.flight_minutes), (Some(70_000), 2));
}
