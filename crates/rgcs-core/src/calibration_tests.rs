use super::*;

fn accel() -> CalibStatus {
    CalibStatus::start(CalibKind::Accel)
}

#[test]
fn accel_waits_for_each_requested_position_then_ends_on_success_or_failure() {
    let s = accel().on_frame(&CalibFrame::AccelPos(1)).unwrap();
    assert_eq!((s.phase, s.position), (CalibPhase::Waiting, Some(1)));
    let s = s.on_frame(&CalibFrame::AccelPos(4)).unwrap();
    assert_eq!(s.position, Some(4));
    let done = s.on_frame(&CalibFrame::AccelPos(ACCELCAL_SUCCESS)).unwrap();
    assert_eq!(done.phase, CalibPhase::Done);
    let failed = s.on_frame(&CalibFrame::AccelPos(ACCELCAL_FAILED)).unwrap();
    assert_eq!(failed.phase, CalibPhase::Failed);
    // a finished session ignores later frames
    assert!(done.on_frame(&CalibFrame::AccelPos(2)).is_none());
}

#[test]
fn frames_for_another_kind_are_ignored() {
    assert!(accel()
        .on_frame(&CalibFrame::MagProgress { id: 0, pct: 10 })
        .is_none());
    assert!(CalibStatus::start(CalibKind::Level)
        .on_frame(&CalibFrame::RcChannels(vec![1500]))
        .is_none());
}

#[test]
fn compass_tracks_every_compass_and_needs_a_reboot_when_all_succeed() {
    let s = CalibStatus::start(CalibKind::Compass)
        .on_frame(&CalibFrame::MagProgress { id: 1, pct: 30 })
        .unwrap()
        .on_frame(&CalibFrame::MagProgress { id: 0, pct: 55 })
        .unwrap();
    assert_eq!(
        s.compass.iter().map(|c| (c.id, c.pct)).collect::<Vec<_>>(),
        vec![(0, 55), (1, 30)]
    );
    let s = s
        .on_frame(&CalibFrame::MagReport {
            id: 0,
            status: 4,
            fitness: 8.5,
        })
        .unwrap();
    assert_eq!(s.phase, CalibPhase::Running);
    assert_eq!(s.compass[0].pct, 100);
    let done = s
        .on_frame(&CalibFrame::MagReport {
            id: 1,
            status: 4,
            fitness: 12.0,
        })
        .unwrap();
    assert_eq!(done.phase, CalibPhase::Done);
    assert!(done.reboot);
}

#[test]
fn one_failed_compass_fails_the_calibration() {
    let s = CalibStatus::start(CalibKind::Compass)
        .on_frame(&CalibFrame::MagProgress { id: 0, pct: 90 })
        .unwrap()
        .on_frame(&CalibFrame::MagReport {
            id: 0,
            status: 7,
            fitness: 40.0,
        })
        .unwrap();
    assert_eq!(s.phase, CalibPhase::Failed);
    assert!(!s.reboot);
}

#[test]
fn rc_widens_each_channel_range_and_reports_only_swept_channels() {
    let s = CalibStatus::start(CalibKind::Rc);
    let s = [
        vec![1500, 1500, 1100, 0],
        vec![1000, 1600, 1900, 0],
        vec![2000, 1550, 1100, 0],
        vec![1510, 1500, 1120, 0],
    ]
    .iter()
    .fold(s, |s, v| s.on_frame(&CalibFrame::RcChannels(v.clone())).unwrap());
    assert_eq!(
        s.rc[0],
        RcRange {
            min: 1000,
            max: 2000,
            value: 1510
        }
    );
    assert_eq!(
        s.rc[3],
        RcRange {
            min: 0,
            max: 0,
            value: 0
        }
    );
    // channel 2 moved only 100 µs, channel 4 is absent
    assert_eq!(s.rc_result(), vec![(1, 1000, 2000, 1510), (3, 1100, 1900, 1120)]);
}

#[test]
fn kinds_round_trip_through_their_names() {
    for k in CalibKind::ALL {
        assert_eq!(CalibKind::parse(k.as_str()), Some(k));
    }
    assert_eq!(CalibKind::parse("gyro"), None);
}
