//! Final-review fixes at the hub level: I1 (a vehicle first seen armed is alert-only until it
//! disarms), I2 (the L2 due state), I3 (the takeover cause on the alert) and I4 (the SetMode
//! does not wait behind SQLite writes).

use rgcs_core::{GuardConsent, GuardLevel, GuardSettings};

use super::*;

// ---- I1: first seen armed (the server restarted mid-flight) ----
/// What `main` does at start-up: the stored settings (consent 3, L3) applied directly.
fn restart_with_l3(r: &Rig) {
    let consent = GuardConsent {
        monitoring: true,
        external_data: false,
        auto_ops: true,
        by: Some("admin".into()),
        at_ms: Some(T0),
    };
    r.app.guard.apply_settings(GuardSettings {
        enabled: true,
        consent,
        toilet_bowl: GuardLevel::L3,
        ..GuardSettings::default()
    });
}

#[tokio::test]
async fn a_vehicle_first_seen_armed_is_alert_only_until_it_disarms() {
    let mut r = Rig::new().await;
    r.copter(COPTER_LOITER, true).await;
    restart_with_l3(&r);
    let mut feed = Feed::new(&r, toilet_bowl());
    let a = feed.until_alert(&r).await;
    assert_eq!((a.phase, a.level), (GuardPhase::Alerting, GuardLevel::L1));
    assert_eq!(a.action_mode, None);
    feed.run_secs(&r, 8.0).await;
    r.flush().await;
    assert!(r.queued().is_empty(), "no SetMode before a disarm");
    let rows = r.app.store.decisions(Some(1), 10).await.unwrap();
    assert!(
        rows.iter().all(|x| x.level == "l1"),
        "recorded at the capped level"
    );
    r.copter(COPTER_LOITER, false).await;
    Feed::new(&r, toilet_bowl()).run_secs(&r, 0.5).await;
    r.copter(COPTER_LOITER, true).await;
    Feed::new(&r, toilet_bowl()).until_alert(&r).await;
    r.flush().await;
    assert_eq!(r.queued().len(), 1, "the next flight acts again");
}

#[tokio::test]
async fn a_vehicle_seen_disarmed_while_the_guard_was_off_acts_after_arming() {
    let mut r = Rig::new().await;
    r.copter(COPTER_LOITER, false).await;
    Feed::new(&r, toilet_bowl()).run_secs(&r, 0.5).await;
    r.copter(COPTER_LOITER, true).await;
    restart_with_l3(&r);
    Feed::new(&r, toilet_bowl()).until_alert(&r).await;
    r.flush().await;
    assert_eq!(r.queued().len(), 1);
}

// ---- I2: the L2 due state ----

/// L2 countdown, then a 1.5 s gap in the position stream across the deadline (no fresh
/// `Detected` at the deadline), then the bowl again.
async fn due_rig() -> (Rig, Feed, GuardAlert) {
    let mut r = copter_rig().await;
    r.enable("l2").await;
    let mut feed = Feed::new(&r, toilet_bowl());
    let a = feed.until_alert(&r).await;
    feed.run_secs(&r, 3.5).await;
    r.set_now(a.ts + 5_000);
    r.app.guard.tick();
    r.flush().await;
    assert_eq!(r.phase(), Some(GuardPhase::Due));
    assert!(r.queued().is_empty(), "nothing without a fresh Detected");
    let due = r.alerts().into_iter().last().unwrap();
    assert_eq!(due.text, "Switching to ALT_HOLD if the signs persist");
    assert_eq!(
        (due.action_mode.as_deref(), due.deadline_ms),
        (Some("ALT_HOLD"), None)
    );
    feed.start += 1_500;
    (r, feed, a)
}

#[tokio::test]
async fn l2_due_acts_on_the_first_fresh_detection() {
    let (mut r, mut feed, _) = due_rig().await;
    feed.run_secs(&r, 0.5).await;
    r.flush().await;
    let jobs = r.queued();
    assert_eq!(jobs.len(), 1);
    assert_eq!(
        jobs[0].cmd,
        VehicleCommand::SetMode {
            mode: "ALT_HOLD".into()
        }
    );
    feed.run_secs(&r, 3.0).await;
    r.flush().await;
    assert!(r.queued().is_empty(), "at most one action");
}

#[tokio::test]
async fn l2_due_is_cancellable() {
    let (mut r, mut feed, a) = due_rig().await;
    let op = r.op.clone();
    let path = format!("/api/guard/alerts/{}/cancel", a.id);
    let (status, body) = r.call(Method::POST, &path, &op, None).await;
    assert_eq!(
        (status, &body["data"]["phase"]),
        (StatusCode::OK, &json!("cancelled"))
    );
    feed.run_secs(&r, 3.0).await;
    r.flush().await;
    assert!(r.queued().is_empty());
}

// ---- I3: the takeover cause on the alert ----

const COPTER_LAND: u32 = 9;

#[tokio::test]
async fn a_mode_change_the_guard_did_not_make_is_shown_as_such() {
    let mut r = copter_rig().await;
    r.enable("l2").await;
    let mut feed = Feed::new(&r, toilet_bowl());
    feed.until_alert(&r).await;
    feed.run_secs(&r, 1.0).await;
    r.copter(COPTER_LAND, true).await;
    r.app.guard.tick();
    let a = r.app.guard.active_alerts().remove(0);
    assert_eq!(a.phase, GuardPhase::TakenOver, "the guard stands down");
    assert_eq!(
        (a.taken_over_by.as_deref(), a.vehicle_mode.as_str()),
        (Some("mode_change"), "LAND")
    );
    assert_eq!(a.text, "Mode changed to LAND: the AI takes no further action");
    let msgs = r.messages().await;
    let row = msgs.iter().find(|m| m.text == a.text).expect("a message row");
    assert_eq!(row.severity.as_str(), "warn");
    feed.run_secs(&r, 6.0).await;
    r.flush().await;
    assert!(r.queued().is_empty());
}

#[tokio::test]
async fn an_operator_command_is_shown_as_taken_over() {
    let r = copter_rig().await;
    r.enable("l2").await;
    let mut feed = Feed::new(&r, toilet_bowl());
    let a = feed.until_alert(&r).await;
    assert_eq!(a.taken_over_by, None);
    r.app.guard.note_operator_command(1);
    let a = r.app.guard.active_alerts().remove(0);
    assert_eq!(
        (a.phase, a.taken_over_by.as_deref()),
        (GuardPhase::TakenOver, Some("gcs_command"))
    );
    assert_eq!(a.text, "Taken over");
}

// ---- I4: the SetMode does not wait behind SQLite writes ----

#[tokio::test]
async fn l3_sends_while_the_database_is_busy_and_still_audits() {
    let mut r = copter_rig().await;
    r.enable("l3").await;
    // The in-memory store has one connection: holding it stalls every record / message write.
    let busy = r.app.store.pool().acquire().await.unwrap();
    Feed::new(&r, toilet_bowl()).until_alert(&r).await;
    let wait = std::time::Duration::from_secs(2);
    let job = tokio::time::timeout(wait, r.queue.recv())
        .await
        .expect("SetMode queued while SQLite is busy")
        .unwrap();
    assert_eq!(
        job.cmd,
        VehicleCommand::SetMode {
            mode: "ALT_HOLD".into()
        }
    );
    job.done.send(Outcome::Accepted).unwrap();
    drop(busy);
    r.wait_phase(GuardPhase::Executed).await;
    let row = r
        .audit()
        .await
        .into_iter()
        .find(|e| e.command == "set_mode")
        .expect("audited");
    assert_eq!((row.operator.as_str(), row.result.as_str()), ("ai-guard", "ok"));
    let args: Value = serde_json::from_str(row.args.as_deref().unwrap()).unwrap();
    assert!(args["decision_id"].is_i64(), "{args}");
    let phases: Vec<String> = r
        .app
        .store
        .decisions(Some(1), 10)
        .await
        .unwrap()
        .into_iter()
        .map(|d| d.phase)
        .collect();
    assert!(phases.contains(&"executing".to_string()), "{phases:?}");
}
