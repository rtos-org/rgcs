use super::*;
use crate::roi::controller::codes;
use crate::roi::geo::{wrap_180, WGS84_A, WGS84_E2};

fn target(lat: f64) -> RoiTarget {
    RoiTarget {
        id: "roi_1".into(),
        name: "North".into(),
        lat,
        lon: 139.0,
        alt_msl: 100.0,
    }
}

fn point(lat: f64) -> NativeOut {
    NativeOut::Point {
        lat,
        lon: 139.0,
        alt_msl: 100.0,
    }
}

fn active() -> NativeRoi {
    NativeRoi::default().start(target(35.009), 0).0
}

/// Latitude `north_m` metres north of 35° N.
fn lat_north_of_35(north_m: f64) -> f64 {
    let sin_lat = 35f64.to_radians().sin();
    let meridional = WGS84_A * (1.0 - WGS84_E2) / (1.0 - WGS84_E2 * sin_lat * sin_lat).powf(1.5);
    35.0 + (north_m / meridional).to_degrees()
}

fn fix(age_ms: u64, hdg: Option<f64>) -> VehicleFix {
    VehicleFix {
        lat: 35.0,
        lon: 139.0,
        alt_msl: 0.0,
        hdg,
        age_ms,
    }
}

#[test]
fn start_points_once() {
    let (roi, out) = NativeRoi::default().start(target(35.009), 0);
    assert_eq!(out, vec![point(35.009)]);
    assert!(roi.is_active());
}

#[test]
fn tick_resends_every_5s() {
    let roi = active();
    let (roi, out) = roi.tick(4_999);
    assert!(out.is_empty(), "{out:?}");
    let (roi, out) = roi.tick(5_000);
    assert_eq!(out, vec![point(35.009)]);
    let (_, out) = roi.tick(9_999);
    assert!(out.is_empty(), "{out:?}");
}

#[test]
fn tick_is_quiet_while_idle() {
    let (_, out) = NativeRoi::default().tick(60_000);
    assert!(out.is_empty());
}

#[test]
fn stop_releases_only_when_active() {
    let (idle, out) = active().stop();
    assert_eq!(out, vec![NativeOut::Release]);
    assert!(!idle.is_active());
    let (_, out) = idle.stop();
    assert!(out.is_empty());
}

#[test]
fn retarget() {
    let moved = RoiTarget {
        lat: 35.010,
        ..target(35.009)
    };
    let (roi, out) = active().retarget(&[moved], 1_000);
    assert_eq!(out, vec![point(35.010)]);
    assert!(roi.is_active());
    let (_, out) = roi.tick(5_999);
    assert!(out.is_empty(), "a retarget restarts the resend clock: {out:?}");

    let (_, out) = active().retarget(&[target(35.009)], 1_000);
    assert!(out.is_empty(), "{out:?}");

    let unset = RoiTarget {
        name: "".into(),
        ..target(35.009)
    };
    let (roi, out) = active().retarget(&[unset], 1_000);
    assert_eq!(out, vec![NativeOut::Release]);
    assert!(!roi.is_active());

    let (roi, out) = active().retarget(&[], 1_000);
    assert_eq!(out, vec![NativeOut::Release]);
    assert!(!roi.is_active());

    let (_, out) = NativeRoi::default().retarget(&[target(35.009)], 1_000);
    assert!(out.is_empty());
}

#[test]
fn resend_points_now_when_active() {
    let (roi, out) = active().resend(2_000);
    assert_eq!(out, vec![point(35.009)]);
    let (_, out) = roi.tick(6_999);
    assert!(out.is_empty(), "{out:?}");
    let (_, out) = NativeRoi::default().resend(2_000);
    assert!(out.is_empty());
}

#[test]
fn status_geometry() {
    let lat = lat_north_of_35(1_000.0);
    let roi = NativeRoi::default()
        .start(
            RoiTarget {
                alt_msl: 0.0,
                ..target(lat)
            },
            0,
        )
        .0;
    let gimbal = GimbalAttitude {
        yaw: 1.5,
        pitch: -10.0,
        roll: 0.0,
        age_ms: 20,
    };
    let s = roi.status(Some(&fix(100, Some(0.0))), Some(&gimbal));
    assert_eq!(s.active_target.as_deref(), Some("roi_1"));
    assert_eq!(s.mode, None);
    assert!(wrap_180(s.bearing_deg.unwrap()).abs() <= 0.01, "{s:?}");
    assert!((s.distance_m.unwrap() - 1_000.0).abs() <= 1.0, "{s:?}");
    assert!(s.yaw_cmd_deg.unwrap().abs() <= 0.01, "{s:?}");
    assert!(s.pitch_cmd_deg.is_some());
    assert_eq!(s.gimbal_yaw_deg, Some(1.5));
    assert_eq!(s.gimbal_pitch_deg, Some(-10.0));
    assert_eq!((s.speed_yaw, s.speed_pitch), (None, None));
    assert_eq!(s.error, None);
}

#[test]
fn status_errors() {
    let roi = active();
    assert_eq!(roi.status(None, None).error.as_deref(), Some(codes::NO_POSITION));
    let stale = roi.status(Some(&fix(5_000, Some(0.0))), None);
    assert_eq!(stale.error.as_deref(), Some(codes::POSITION_STALE));
    let no_hdg = roi.status(Some(&fix(100, None)), None);
    assert_eq!(no_hdg.error.as_deref(), Some(codes::HEADING_UNKNOWN));
    assert!(no_hdg.bearing_deg.is_some() && no_hdg.yaw_cmd_deg.is_none());

    let failed = roi.sent(false);
    let s = failed.status(Some(&fix(100, Some(0.0))), None);
    assert_eq!(s.error.as_deref(), Some(codes::SEND_FAILED));
    assert!(failed.is_active(), "a failed send keeps ROI active");
    assert_eq!(
        failed.sent(true).status(Some(&fix(100, Some(0.0))), None).error,
        None
    );
}

#[test]
fn idle_status_is_empty() {
    assert_eq!(
        NativeRoi::default().status(Some(&fix(100, Some(0.0))), None),
        RoiStatus::default()
    );
}
