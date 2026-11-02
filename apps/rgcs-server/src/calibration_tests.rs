use super::*;

async fn hub() -> (CalibHub, broadcast::Receiver<ServerMessage>) {
    let (tx, rx) = broadcast::channel(16);
    (CalibHub::new(tx, Store::open_memory().await.unwrap()), rx)
}

fn phase(m: ServerMessage) -> (SysId, CalibPhase) {
    match m {
        ServerMessage::Calibration { sysid, status } => (sysid, status.phase),
        other => panic!("{other:?}"),
    }
}

#[tokio::test]
async fn one_session_per_vehicle_until_it_finishes() {
    let (hub, mut rx) = hub().await;
    assert!(hub.begin(1, CalibKind::Accel, "op").is_some());
    assert_eq!(phase(rx.try_recv().unwrap()), (1, CalibPhase::Running));
    assert!(hub.begin(1, CalibKind::Level, "op").is_none());
    assert!(hub.begin(2, CalibKind::Level, "op").is_some());
    hub.set(
        1,
        CalibStatus::start(CalibKind::Accel).with_phase(CalibPhase::Cancelled, None),
    );
    assert_eq!(hub.get(1).unwrap().phase, CalibPhase::Cancelled);
    assert!(hub.begin(1, CalibKind::Level, "op").is_some());
}

#[tokio::test]
async fn frames_move_the_session_and_a_finished_run_is_recorded() {
    let (hub, mut rx) = hub().await;
    hub.begin(1, CalibKind::Accel, "op1");
    hub.on_frame(1, &CalibFrame::AccelPos(2));
    hub.on_frame(9, &CalibFrame::AccelPos(2));
    let _ = rx.try_recv();
    assert_eq!(hub.get(1).unwrap().position, Some(2));
    hub.on_frame(1, &CalibFrame::AccelPos(rgcs_core::calibration::ACCELCAL_SUCCESS));
    assert_eq!(phase(rx.try_recv().unwrap()), (1, CalibPhase::Waiting));
    assert_eq!(phase(rx.try_recv().unwrap()), (1, CalibPhase::Done));
    // the record is written by a spawned task
    for _ in 0..50 {
        let list = hub.store.latest_calibrations(1).await.unwrap();
        if !list.is_empty() {
            assert_eq!(
                (list[0].kind, list[0].ok, list[0].operator.as_str()),
                (CalibKind::Accel, true, "op1")
            );
            return;
        }
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
    panic!("no calibration record");
}

#[tokio::test]
async fn cancelled_runs_and_ignored_frames_are_not_recorded_or_broadcast() {
    let (hub, mut rx) = hub().await;
    hub.begin(1, CalibKind::Compass, "op");
    let _ = rx.try_recv();
    hub.on_frame(1, &CalibFrame::RcChannels(vec![1500]));
    assert!(rx.try_recv().is_err());
    hub.set(1, hub.get(1).unwrap().with_phase(CalibPhase::Cancelled, None));
    tokio::time::sleep(std::time::Duration::from_millis(30)).await;
    assert!(hub.store.latest_calibrations(1).await.unwrap().is_empty());
}
