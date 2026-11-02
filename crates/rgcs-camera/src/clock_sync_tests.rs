use super::*;

const GPS_US: u64 = 1_790_000_000_000_000;

fn s(secs: f64) -> u64 {
    (secs * 1e6) as u64
}

fn sample(received_s: f64) -> GpsSample {
    GpsSample {
        unix_us: GPS_US,
        received_at_us: s(received_s),
    }
}

#[test]
fn current_unix_us_adds_elapsed() {
    assert_eq!(current_unix_us(&sample(10.0), s(10.25)), GPS_US + 250_000);
}

#[test]
fn first_sync_sends_compensated_time() {
    let (c, actions) = ClockSync::new().tick(s(100.0), true, Some(sample(99.5)));
    assert_eq!(
        actions,
        vec![ClockAction::SetUtc(GPS_US + 500_000), ClockAction::ReadBack]
    );
    let true_us = GPS_US + 10_000 + 500_000; // GPS at receipt + 100.01 - 99.5 s
    let c = c.on_camera_time(true_us, s(100.02));
    let st = c.status();
    assert_eq!(st.ok, Some(true));
    assert!(st.offset_ms.unwrap().abs() <= 0.01);
    assert_eq!(st.rtt_ms, Some(20.0));
    assert_eq!(st.error, None);
}

#[test]
fn offset_sign_camera_ahead() {
    let (c, _) = ClockSync::new().tick(s(100.0), true, Some(sample(99.5)));
    let true_us = GPS_US + 510_000;
    let c = c.on_camera_time(true_us + 250_000, s(100.02));
    assert_eq!(c.status().offset_ms, Some(250.0));
}

#[test]
fn no_gps_time_does_not_send() {
    let (c, actions) = ClockSync::new().tick(s(100.0), true, None);
    assert!(actions.is_empty());
    assert_eq!(c.status().error, Some("no_gps_time"));
}

#[test]
fn stale_gps_time_does_not_send() {
    let (c, actions) = ClockSync::new().tick(s(100.0), true, Some(sample(50.0)));
    assert!(actions.is_empty());
    assert_eq!(c.status().error, Some("gps_time_stale"));
    let (c, actions) = ClockSync::new().tick(s(100.0), true, Some(sample(101.0)));
    assert!(actions.is_empty());
    assert_eq!(c.status().error, Some("gps_time_stale"));
}

#[test]
fn resync_only_after_interval() {
    let (c, _) = ClockSync::new().tick(s(100.0), true, Some(sample(99.9)));
    let (c, a) = c.tick(s(400.0), true, Some(sample(399.9)));
    assert!(a.is_empty());
    let (_, a) = c.tick(s(701.0), true, Some(sample(700.9)));
    assert!(matches!(a[0], ClockAction::SetUtc(_)));
}

#[test]
fn reconnect_triggers_sync() {
    let (c, _) = ClockSync::new().tick(s(100.0), true, Some(sample(99.9)));
    let (c, a) = c.tick(s(110.0), false, Some(sample(109.9)));
    assert!(a.is_empty());
    let (_, a) = c.tick(s(120.0), true, Some(sample(119.9)));
    assert!(matches!(a[0], ClockAction::SetUtc(_)));
}

#[test]
fn manual_request_triggers_sync() {
    let (c, _) = ClockSync::new().tick(s(100.0), true, Some(sample(99.9)));
    let (c, a) = c.tick(s(110.0), true, Some(sample(109.9)));
    assert!(a.is_empty());
    let (_, a) = c.request().tick(s(111.0), true, Some(sample(110.9)));
    assert!(matches!(a[0], ClockAction::SetUtc(_)));
}

#[test]
fn readback_timeout_reports_error() {
    let (c, _) = ClockSync::new().tick(s(100.0), true, Some(sample(99.9)));
    let (c, a) = c.tick(s(101.0), true, Some(sample(100.9)));
    assert!(a.is_empty());
    let st = c.status();
    assert_eq!(st.offset_ms, None);
    assert_eq!(st.error, Some("no_readback"));
    assert_eq!(st.ok, Some(true));
    let (c, a) = c.tick(s(102.0), true, Some(sample(101.9)));
    assert!(a.is_empty(), "pending is cleared by the send");
    assert_eq!(c.status().error, Some("no_readback"));
}

#[test]
fn poll_reply_before_sync_is_ignored() {
    let (c, _) = ClockSync::new().tick(s(100.0), true, Some(sample(99.9)));
    let c = c.on_camera_time(GPS_US, s(99.0));
    assert_eq!(c.status().offset_ms, None);
}

#[test]
fn disconnected_skips() {
    let (c, a) = ClockSync::new().tick(s(100.0), false, Some(sample(99.9)));
    assert!(a.is_empty());
    assert_eq!(c.status().last_sync_at_us, None);
}

#[test]
fn state_is_a_value() {
    assert_eq!(ClockSync::new(), ClockSync::new());
    let c = ClockSync::new();
    let _ = c.tick(s(100.0), true, Some(sample(99.9)));
    assert_eq!(c, ClockSync::new());
}

#[test]
fn rejected_utc_is_a_failed_sync() {
    let (c, _) = ClockSync::new().tick(s(100.0), true, Some(sample(99.5)));
    assert_eq!(c.on_utc_ack(true), c, "an accepted time changes nothing");
    let c = c.on_utc_ack(false);
    let st = c.status();
    assert_eq!(st.ok, Some(false));
    assert_eq!(st.error, Some("rejected"));
    // The read-back that follows does not turn the rejection into a success.
    let c = c.on_camera_time(GPS_US + 510_000, s(100.02));
    assert_eq!(c.status().error, Some("rejected"));
    assert_eq!(c.status().offset_ms, None);
}

#[test]
fn rejection_after_the_readback_still_fails_the_sync() {
    let (c, _) = ClockSync::new().tick(s(100.0), true, Some(sample(99.5)));
    let c = c.on_camera_time(GPS_US + 510_000, s(100.02)).on_utc_ack(false);
    assert_eq!(c.status().ok, Some(false));
    assert_eq!(c.status().error, Some("rejected"));
    assert_eq!(c.status().offset_ms, None);
    assert_eq!(
        ClockSync::new().on_utc_ack(false),
        ClockSync::new(),
        "no sync sent: ignored"
    );
}
