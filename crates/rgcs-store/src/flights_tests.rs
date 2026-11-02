//! Store tests for flights (moved out of flights.rs to keep it under 800 lines).

use rgcs_core::{FlightInput, FlightPatch, FlightSquawkInput, FlightStatus, VehicleRegistryInput};

use crate::audit::AuditInput;
use crate::Store;

/// 2026-12-01 23:30 JST.
const T0: u64 = 1_796_050_800_000 + 23 * 3_600_000 + 30 * 60_000;

fn registry(initial: u32) -> VehicleRegistryInput {
    VehicleRegistryInput {
        name: "UAV-01".into(),
        registration: "".into(),
        uas_type: "".into(),
        model: "".into(),
        type_cert_no: "".into(),
        airworthiness_class: "".into(),
        airworthiness_no: "".into(),
        manufacturer: "".into(),
        serial_no: "".into(),
        initial_flight_minutes: initial,
        inspection_template_id: None,
        endurance_minutes: None,
    }
}

fn manual(takeoff: u64, landed: u64) -> FlightInput {
    FlightInput {
        pilot: "admin".into(),
        pilot_license: "".into(),
        takeoff_at: takeoff,
        landed_at: landed,
        takeoff_place: "".into(),
        landing_place: "".into(),
        purposes: vec!["空撮".into()],
        specific_flight: vec![],
        summary: "".into(),
        safety_notes: "".into(),
    }
}

#[tokio::test]
async fn open_land_and_totals() {
    let s = Store::open_memory().await.unwrap();
    s.put_registry(1, &registry(100), "copter").await.unwrap();
    let id = s
        .open_flight(1, "admin", "", T0, Some(36.1), Some(139.3), "system")
        .await
        .unwrap();
    assert_eq!(s.open_flight_of(1).await.unwrap().unwrap().id, id);
    s.land_flight(id, T0 + 61_000, Some(36.2), Some(139.4))
        .await
        .unwrap();
    assert!(s.open_flight_of(1).await.unwrap().is_none());
    let f = s.flight(id).await.unwrap().unwrap();
    assert_eq!(
        (f.flight_minutes, f.total_minutes, f.status),
        (2, 102, FlightStatus::Draft)
    );
    assert_eq!(f.landing_lat, Some(36.2));
    let id2 = s
        .open_flight(1, "admin", "", T0 + 3_600_000, None, None, "system")
        .await
        .unwrap();
    s.land_flight(id2, T0 + 3_600_000 + 30_000, None, None)
        .await
        .unwrap();
    let list = s.list_flights(1, None, None).await.unwrap();
    assert_eq!(
        list.iter()
            .map(|f| (f.flight_minutes, f.total_minutes))
            .collect::<Vec<_>>(),
        vec![(2, 102), (1, 103)]
    );
    assert_eq!(s.total_flight_minutes(1).await.unwrap(), 103);
    assert_eq!(s.registry(1, "x").await.unwrap().total_flight_minutes, 103);
}

#[tokio::test]
async fn reopen_clears_the_landing() {
    let s = Store::open_memory().await.unwrap();
    let id = s
        .open_flight(1, "admin", "", T0, None, None, "system")
        .await
        .unwrap();
    s.land_flight(id, T0 + 10_000, Some(1.0), Some(2.0))
        .await
        .unwrap();
    assert!(s.reopen_flight(id).await.unwrap());
    let f = s.open_flight_of(1).await.unwrap().unwrap();
    assert_eq!((f.id, f.landed_at, f.landing_lat), (id, None, None));
}

#[tokio::test]
async fn patch_on_a_confirmed_flight_supersedes_it() {
    let s = Store::open_memory().await.unwrap();
    let f = s
        .create_flight(1, &manual(T0, T0 + 120_000), "admin")
        .await
        .unwrap();
    let p = FlightPatch {
        takeoff_place: Some("A".into()),
        ..FlightPatch::default()
    };
    let same = s.patch_flight(f.id, &p, "admin").await.unwrap().unwrap();
    assert_eq!((same.id, same.takeoff_place.as_str()), (f.id, "A"));
    let confirmed = s
        .patch_flight(
            f.id,
            &FlightPatch {
                status: Some(FlightStatus::Confirmed),
                ..FlightPatch::default()
            },
            "admin",
        )
        .await
        .unwrap()
        .unwrap();
    assert_eq!((confirmed.id, confirmed.status), (f.id, FlightStatus::Confirmed));
    let newer = s
        .patch_flight(
            f.id,
            &FlightPatch {
                summary: Some("fixed".into()),
                ..FlightPatch::default()
            },
            "admin",
        )
        .await
        .unwrap()
        .unwrap();
    assert_ne!(newer.id, f.id);
    assert_eq!(
        (newer.supersedes, newer.status, newer.takeoff_place.as_str()),
        (Some(f.id), FlightStatus::Confirmed, "A")
    );
    let list = s.list_flights(1, None, None).await.unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!((list[0].id, list[0].summary.as_str()), (newer.id, "fixed"));
    assert!(s.patch_flight(999, &p, "admin").await.unwrap().is_none());
    assert!(s.create_flight(1, &manual(T0, T0 - 1), "admin").await.is_err());
}

#[tokio::test]
async fn delete_only_drafts() {
    let s = Store::open_memory().await.unwrap();
    let f = s.create_flight(1, &manual(T0, T0 + 1), "admin").await.unwrap();
    s.patch_flight(
        f.id,
        &FlightPatch {
            status: Some(FlightStatus::Confirmed),
            ..FlightPatch::default()
        },
        "admin",
    )
    .await
    .unwrap();
    assert!(!s.delete_draft(f.id).await.unwrap());
    let d = s.create_flight(1, &manual(T0, T0 + 1), "admin").await.unwrap();
    assert!(s.delete_draft(d.id).await.unwrap());
    assert!(s.flight(d.id).await.unwrap().is_none());
}

#[tokio::test]
async fn squawks_ride_with_the_flight() {
    let s = Store::open_memory().await.unwrap();
    let f = s.create_flight(1, &manual(T0, T0 + 1), "admin").await.unwrap();
    let input = FlightSquawkInput {
        occurred_on: "2026-12-05".into(),
        description: "振動".into(),
        action_on: "".into(),
        action: "".into(),
        confirmer: "".into(),
    };
    assert!(s.add_squawk(f.id, &input, "admin").await.unwrap().is_some());
    assert!(s.add_squawk(999, &input, "admin").await.unwrap().is_none());
    let got = s.flight(f.id).await.unwrap().unwrap();
    assert_eq!(got.squawks.len(), 1);
    assert_eq!(got.squawks[0].description, "振動");
}

#[tokio::test]
async fn range_filter_uses_jst_days() {
    let s = Store::open_memory().await.unwrap();
    s.create_flight(1, &manual(T0, T0 + 1), "admin").await.unwrap();
    assert_eq!(
        s.list_flights(1, Some("2026-12-01"), Some("2026-12-01"))
            .await
            .unwrap()
            .len(),
        1
    );
    assert!(s
        .list_flights(1, Some("2026-12-02"), Some("2026-12-02"))
        .await
        .unwrap()
        .is_empty());
    assert!(s.list_flights(2, None, None).await.unwrap().is_empty());
}

#[tokio::test]
async fn last_operator_comes_from_the_audit_log() {
    let s = Store::open_memory().await.unwrap();
    s.record_audit(AuditInput {
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
    assert_eq!(s.last_operator(1).await.unwrap().as_deref(), Some("admin"));
    assert_eq!(s.last_operator(2).await.unwrap(), None);
}

#[tokio::test]
async fn reopen_only_drafts_and_open_flights_cannot_be_confirmed() {
    let s = Store::open_memory().await.unwrap();
    let id = s
        .open_flight(1, "admin", "", T0, None, None, "system")
        .await
        .unwrap();
    let confirm = FlightPatch {
        status: Some(FlightStatus::Confirmed),
        ..FlightPatch::default()
    };
    assert!(
        s.patch_flight(id, &confirm, "admin").await.is_err(),
        "still in the air"
    );
    s.land_flight(id, T0 + 10_000, None, None).await.unwrap();
    assert!(s.reopen_flight(id).await.unwrap());
    s.land_flight(id, T0 + 20_000, None, None).await.unwrap();
    s.patch_flight(id, &confirm, "admin").await.unwrap().unwrap();
    assert!(
        !s.reopen_flight(id).await.unwrap(),
        "confirmed records are immutable"
    );
    assert!(s.open_flight_of(1).await.unwrap().is_none());
}

#[tokio::test]
async fn supersede_copies_squawks_and_marks_the_old_row() {
    let s = Store::open_memory().await.unwrap();
    let f = s.create_flight(1, &manual(T0, T0 + 1), "admin").await.unwrap();
    let sq = FlightSquawkInput {
        occurred_on: "2026-12-05".into(),
        description: "振動".into(),
        action_on: "".into(),
        action: "".into(),
        confirmer: "".into(),
    };
    s.add_squawk(f.id, &sq, "admin").await.unwrap();
    s.patch_flight(
        f.id,
        &FlightPatch {
            status: Some(FlightStatus::Confirmed),
            ..FlightPatch::default()
        },
        "admin",
    )
    .await
    .unwrap();
    assert_eq!(s.flight_superseded_by(f.id).await.unwrap(), None);
    let newer = s
        .patch_flight(
            f.id,
            &FlightPatch {
                summary: Some("x".into()),
                ..FlightPatch::default()
            },
            "admin",
        )
        .await
        .unwrap()
        .unwrap();
    assert_eq!(newer.squawks.len(), 1);
    assert_eq!(
        s.flight(f.id).await.unwrap().unwrap().squawks.len(),
        1,
        "the confirmed row is untouched"
    );
    assert_eq!(s.flight_superseded_by(f.id).await.unwrap(), Some(newer.id));
    assert_eq!(s.flight_superseded_by(newer.id).await.unwrap(), None);
}

async fn fail_on(s: &Store, table: &str, op: &str) {
    sqlx::query(sqlx::AssertSqlSafe(format!(
        "CREATE TRIGGER fail_{table}_{op} BEFORE {op} ON {table} BEGIN SELECT RAISE(ABORT, 'injected'); END"
    )))
    .execute(s.pool())
    .await
    .unwrap();
}

#[tokio::test]
async fn delete_draft_detaches_logs() {
    let s = Store::open_memory().await.unwrap();
    let f = s.create_flight(1, &manual(T0, T0 + 1), "admin").await.unwrap();
    let log = s
        .add_log(
            1,
            Some(f.id),
            None,
            "x.bin",
            1,
            rgcs_core::LogSource::Upload,
            "admin",
        )
        .await
        .unwrap();
    assert!(s.delete_draft(f.id).await.unwrap());
    assert!(s.flight(f.id).await.unwrap().is_none());
    assert_eq!(
        s.log(log.id).await.unwrap().unwrap().flight_id,
        None,
        "the log stays, detached"
    );
}

#[tokio::test]
async fn failed_draft_delete_leaves_everything_in_place() {
    let s = Store::open_memory().await.unwrap();
    let f = s.create_flight(1, &manual(T0, T0 + 1), "admin").await.unwrap();
    let sq = FlightSquawkInput {
        occurred_on: "2026-12-05".into(),
        description: "x".into(),
        action_on: "".into(),
        action: "".into(),
        confirmer: "".into(),
    };
    s.add_squawk(f.id, &sq, "admin").await.unwrap();
    fail_on(&s, "flights", "DELETE").await;
    assert!(s.delete_draft(f.id).await.is_err());
    assert_eq!(
        s.flight(f.id).await.unwrap().unwrap().squawks.len(),
        1,
        "squawks rolled back"
    );
}

#[tokio::test]
async fn failed_supersede_inserts_no_correction_row() {
    let s = Store::open_memory().await.unwrap();
    let f = s.create_flight(1, &manual(T0, T0 + 1), "admin").await.unwrap();
    let sq = FlightSquawkInput {
        occurred_on: "2026-12-05".into(),
        description: "x".into(),
        action_on: "".into(),
        action: "".into(),
        confirmer: "".into(),
    };
    s.add_squawk(f.id, &sq, "admin").await.unwrap();
    s.patch_flight(
        f.id,
        &FlightPatch {
            status: Some(FlightStatus::Confirmed),
            ..FlightPatch::default()
        },
        "admin",
    )
    .await
    .unwrap();
    fail_on(&s, "flight_squawks", "INSERT").await;
    let p = FlightPatch {
        summary: Some("v2".into()),
        ..FlightPatch::default()
    };
    assert!(s.patch_flight(f.id, &p, "admin").await.is_err());
    assert_eq!(s.flight_superseded_by(f.id).await.unwrap(), None);
    assert_eq!(s.list_flights(1, None, None).await.unwrap().len(), 1);
}

#[tokio::test]
async fn open_drafts_lists_flights_still_in_the_air() {
    let s = Store::open_memory().await.unwrap();
    let a = s
        .open_flight(1, "admin", "", T0, None, None, "system")
        .await
        .unwrap();
    let b = s
        .open_flight(2, "admin", "", T0, None, None, "system")
        .await
        .unwrap();
    s.land_flight(b, T0 + 1, None, None).await.unwrap();
    assert_eq!(s.open_drafts().await.unwrap(), vec![(1, a)]);
}
