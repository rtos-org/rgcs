//! `SET_MESSAGE_INTERVAL` requests, only for streams that are not already flowing.
//!
//! Ported from the Python app's `mavlink_source.py`: after the first flight-controller
//! HEARTBEAT wait 10 s; then, on every heartbeat, request any stream whose last sample is
//! older than 3 s, at most once per 5 s. If Mission Planner (or Rpanion) already asked for
//! the streams, the FC's settings are never touched.
//!
//! A vehicle that sends no telemetry of its own at all (SRn_ rates 0) is asked after 3 s
//! instead of 10. A gap in its HEARTBEATs (reboot, dropped link) starts everything over.

use std::collections::HashMap;

pub const MSG_ID_GLOBAL_POSITION_INT: u32 = 33;
pub const MSG_ID_SYSTEM_TIME: u32 = 2;
pub const MSG_ID_ATTITUDE: u32 = 30;
pub const MSG_ID_VFR_HUD: u32 = 74;
pub const MSG_ID_SYS_STATUS: u32 = 1;
pub const MSG_ID_GPS_RAW_INT: u32 = 24;
pub const MSG_ID_MISSION_CURRENT: u32 = 42;
pub const MSG_ID_NAV_CONTROLLER_OUTPUT: u32 = 62;
pub const MSG_ID_POSITION_TARGET_GLOBAL_INT: u32 = 87;
pub const MSG_ID_HOME_POSITION: u32 = 242;
pub const MSG_ID_EXTENDED_SYS_STATE: u32 = 245;
pub const MSG_ID_EKF_STATUS_REPORT: u32 = 193;
pub const MSG_ID_RC_CHANNELS: u32 = 65;
pub const MSG_ID_WIND: u32 = 168;

const GRACE_MS: u64 = 10_000;
/// Nothing at all by now: the vehicle is not streaming on its own, ask without waiting the grace.
const SILENT_MS: u64 = 3_000;
/// A HEARTBEAT gap this long means the vehicle (or the link) came back: a new connection.
const GAP_MS: u64 = 5_000;
const RETRY_MS: u64 = 5_000;
const STALE_MS: u64 = 3_000;

/// Streams we need and the interval (µs) to ask for.
pub const WANTED: &[(u32, u32)] = &[
    (MSG_ID_GLOBAL_POSITION_INT, 100_000),
    (MSG_ID_SYSTEM_TIME, 1_000_000),
    (MSG_ID_ATTITUDE, 100_000),
    (MSG_ID_VFR_HUD, 250_000),
    (MSG_ID_SYS_STATUS, 500_000),
    (MSG_ID_GPS_RAW_INT, 500_000),
    (MSG_ID_MISSION_CURRENT, 1_000_000),
    (MSG_ID_NAV_CONTROLLER_OUTPUT, 500_000),
    (MSG_ID_POSITION_TARGET_GLOBAL_INT, 1_000_000),
    (MSG_ID_HOME_POSITION, 5_000_000),
    (MSG_ID_EXTENDED_SYS_STATE, 1_000_000),
    // AI guard: compass variance, RC sticks (takeover) and ArduPilot's wind estimate.
    (MSG_ID_EKF_STATUS_REPORT, 500_000),
    (MSG_ID_RC_CHANNELS, 200_000),
    (MSG_ID_WIND, 1_000_000),
];

/// Streams that only flow in some states (POSITION_TARGET_GLOBAL_INT in GUIDED, HOME_POSITION
/// once home is set, NAV_CONTROLLER_OUTPUT while a plane or rover navigates) or only from some
/// autopilots (WIND is ArduPilot's): asked for once, never retried, so the FC is not nagged
/// forever. The FC keeps the interval for when they start.
const ONCE: &[u32] = &[
    MSG_ID_POSITION_TARGET_GLOBAL_INT,
    MSG_ID_HOME_POSITION,
    MSG_ID_NAV_CONTROLLER_OUTPUT,
    MSG_ID_WIND,
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct IntervalRequest {
    pub msg_id: u32,
    pub interval_us: u32,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct IntervalRequester {
    first_heartbeat_at: Option<u64>,
    last_heartbeat_at: Option<u64>,
    last_request: HashMap<u32, u64>,
}

impl IntervalRequester {
    /// `last_seen` maps message id → monotonic ms of the latest sample (absent = never seen).
    /// Returns the updated requester and the requests to send now.
    pub fn on_heartbeat(&self, now_ms: u64, last_seen: &HashMap<u32, u64>) -> (Self, Vec<IntervalRequest>) {
        let resumed = self
            .last_heartbeat_at
            .is_some_and(|t| now_ms.saturating_sub(t) > GAP_MS);
        let base = if resumed { Self::default() } else { self.clone() };
        let first = base.first_heartbeat_at.unwrap_or(now_ms);
        let mut next = Self {
            first_heartbeat_at: Some(first),
            last_heartbeat_at: Some(now_ms),
            last_request: base.last_request.clone(),
        };
        let elapsed = now_ms.saturating_sub(first);
        let silent = WANTED
            .iter()
            .all(|(id, iv)| is_stale(last_seen.get(id).copied(), now_ms, *iv));
        if elapsed < SILENT_MS || (elapsed < GRACE_MS && !silent) {
            return (next, Vec::new());
        }
        let requests: Vec<IntervalRequest> = WANTED
            .iter()
            .filter(|(id, interval_us)| is_stale(last_seen.get(id).copied(), now_ms, *interval_us))
            .filter(|(id, _)| match base.last_request.get(id) {
                None => true,
                Some(_) if ONCE.contains(id) => false,
                Some(t) => now_ms.saturating_sub(*t) >= RETRY_MS,
            })
            .map(|&(msg_id, interval_us)| IntervalRequest { msg_id, interval_us })
            .collect();
        for r in &requests {
            next.last_request.insert(r.msg_id, now_ms);
        }
        (next, requests)
    }
}

/// Stale after 3 s, or 2.5 intervals for slower streams (HOME_POSITION at 5 s).
fn is_stale(last: Option<u64>, now_ms: u64, interval_us: u32) -> bool {
    let limit = STALE_MS.max(u64::from(interval_us) / 1000 * 5 / 2);
    last.is_none_or(|t| now_ms.saturating_sub(t) > limit)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ids(reqs: &[IntervalRequest]) -> Vec<u32> {
        reqs.iter().map(|r| r.msg_id).collect()
    }

    #[test]
    fn slow_streams_seen_recently_are_not_re_requested() {
        // HOME_POSITION at 5 s, last seen 4 s ago: still flowing
        let r = IntervalRequester::default();
        let (r, _) = r.on_heartbeat(10_000, &HashMap::new());
        let now = 30_000;
        let seen: HashMap<u32, u64> = WANTED
            .iter()
            .map(|(id, _)| (*id, now - 500))
            .chain([(MSG_ID_HOME_POSITION, now - 4_000)])
            .collect();
        let (_, reqs) = r.on_heartbeat(now, &seen);
        assert!(!ids(&reqs).contains(&MSG_ID_HOME_POSITION), "{reqs:?}");
    }

    #[test]
    fn nav_controller_output_is_asked_for_once() {
        // ArduPlane and Rover send it only while navigating (AUTO, GUIDED, RTL): not in MANUAL.
        let (_, reqs) = beats(
            IntervalRequester::default(),
            10_000,
            60_000,
            flowing_except(MSG_ID_NAV_CONTROLLER_OUTPUT),
        );
        assert_eq!(reqs, vec![(20_000, MSG_ID_NAV_CONTROLLER_OUTPUT)]);
    }

    #[test]
    fn mode_dependent_streams_are_requested_once() {
        // POSITION_TARGET_GLOBAL_INT only flows in GUIDED: one request, then never again
        let mut r = IntervalRequester::default();
        let mut count = 0;
        for now in (10_000..120_000).step_by(1_000) {
            let seen: HashMap<u32, u64> = WANTED
                .iter()
                .filter(|(id, _)| *id != MSG_ID_POSITION_TARGET_GLOBAL_INT)
                .map(|(id, _)| (*id, now))
                .collect();
            let (next, reqs) = r.on_heartbeat(now, &seen);
            count += ids(&reqs)
                .iter()
                .filter(|id| **id == MSG_ID_POSITION_TARGET_GLOBAL_INT)
                .count();
            r = next;
        }
        assert_eq!(count, 1);
    }

    #[test]
    fn extended_sys_state_is_a_wanted_stream() {
        // ArduPlane does not stream it by default; its vtol_state tells a QuadPlane apart.
        assert!(WANTED.contains(&(MSG_ID_EXTENDED_SYS_STATE, 1_000_000)));
    }

    #[test]
    fn guard_streams_are_wanted() {
        // AI guard (spec 2026-10-24 §5.1): compass variance, RC sticks for takeover, wind.
        assert!(WANTED.contains(&(MSG_ID_EKF_STATUS_REPORT, 500_000)));
        assert!(WANTED.contains(&(MSG_ID_RC_CHANNELS, 200_000)));
        assert!(WANTED.contains(&(MSG_ID_WIND, 1_000_000)));
        assert_eq!(
            (MSG_ID_EKF_STATUS_REPORT, MSG_ID_RC_CHANNELS, MSG_ID_WIND),
            (193, 65, 168)
        );
    }

    #[test]
    fn wind_is_asked_for_once() {
        // Only ArduPilot sends WIND: never nag another autopilot for it.
        assert!(ONCE.contains(&MSG_ID_WIND));
        let (_, reqs) = beats(
            IntervalRequester::default(),
            10_000,
            60_000,
            flowing_except(MSG_ID_WIND),
        );
        assert_eq!(reqs, vec![(20_000, MSG_ID_WIND)]);
    }

    #[test]
    fn missing_rc_channels_are_retried() {
        let (_, reqs) = beats(
            IntervalRequester::default(),
            10_000,
            30_000,
            flowing_except(MSG_ID_RC_CHANNELS),
        );
        let times: Vec<u64> = reqs.iter().map(|(t, _)| *t).collect();
        assert_eq!(times, vec![20_000, 25_000, 30_000]);
    }

    #[test]
    fn mission_current_is_a_wanted_stream() {
        assert!(WANTED.contains(&(MSG_ID_MISSION_CURRENT, 1_000_000)));
    }

    /// Heartbeats at 1 Hz from `from` to `to` (inclusive), every request collected with its time.
    fn beats(
        r: IntervalRequester,
        from: u64,
        to: u64,
        seen: impl Fn(u64) -> HashMap<u32, u64>,
    ) -> (IntervalRequester, Vec<(u64, u32)>) {
        (from..=to)
            .step_by(1_000)
            .fold((r, Vec::new()), |(r, mut all), now| {
                let (next, reqs) = r.on_heartbeat(now, &seen(now));
                all.extend(reqs.iter().map(|q| (now, q.msg_id)));
                (next, all)
            })
    }

    /// Every wanted stream but `missing`, fresh at `now`.
    fn flowing_except(missing: u32) -> impl Fn(u64) -> HashMap<u32, u64> {
        move |now| {
            WANTED
                .iter()
                .filter(|(id, _)| *id != missing)
                .map(|(id, _)| (*id, now))
                .collect()
        }
    }

    #[test]
    fn a_silent_vehicle_is_asked_for_telemetry_after_3s() {
        let (_, reqs) = beats(IntervalRequester::default(), 10_000, 13_000, |_| HashMap::new());
        assert!(
            reqs.iter().all(|(t, _)| *t == 13_000),
            "nothing before 3 s: {reqs:?}"
        );
        assert_eq!(reqs.len(), WANTED.len());
    }

    #[test]
    fn while_some_telemetry_flows_the_rest_waits_10s() {
        // Mission Planner (or Rpanion) may still be setting the rates: leave the FC alone for 10 s.
        let (_, reqs) = beats(
            IntervalRequester::default(),
            10_000,
            20_000,
            flowing_except(MSG_ID_SYSTEM_TIME),
        );
        assert_eq!(reqs, vec![(20_000, MSG_ID_SYSTEM_TIME)]);
    }

    #[test]
    fn requests_missing_streams_at_the_rates_wanted() {
        let (_, reqs) = IntervalRequester::default().on_heartbeat(10_000, &HashMap::new());
        assert!(reqs.is_empty());
        let r = beats(IntervalRequester::default(), 10_000, 12_000, |_| HashMap::new()).0;
        let (_, reqs) = r.on_heartbeat(13_000, &HashMap::new());
        assert_eq!(reqs.len(), WANTED.len());
        let pos = reqs
            .iter()
            .find(|q| q.msg_id == MSG_ID_GLOBAL_POSITION_INT)
            .unwrap();
        assert_eq!(pos.interval_us, 100_000);
        let time = reqs.iter().find(|q| q.msg_id == MSG_ID_SYSTEM_TIME).unwrap();
        assert_eq!(time.interval_us, 1_000_000);
    }

    #[test]
    fn after_a_heartbeat_gap_the_vehicle_is_new_again() {
        // A reboot (or a dropped link) resets the FC's rates: ask again, HOME_POSITION included.
        let (r, first) = beats(IntervalRequester::default(), 0, 4_000, |_| HashMap::new());
        assert!(first.iter().any(|(_, id)| *id == MSG_ID_HOME_POSITION));
        let (_, again) = beats(r, 12_000, 15_000, |_| HashMap::new());
        assert!(
            again.iter().all(|(t, _)| *t == 15_000),
            "3 s after the link came back: {again:?}"
        );
        assert_eq!(again.len(), WANTED.len());
    }

    #[test]
    fn streams_already_flowing_are_left_alone() {
        let mut r = IntervalRequester::default();
        let mut now = 10_000;
        for _ in 0..11 {
            now += 1_000;
            let seen: HashMap<u32, u64> = WANTED.iter().map(|(id, _)| (*id, now)).collect();
            let (next, reqs) = r.on_heartbeat(now, &seen);
            assert!(reqs.is_empty());
            r = next;
        }
    }

    #[test]
    fn only_the_missing_stream_is_requested() {
        let mut r = IntervalRequester::default();
        let mut now = 10_000;
        let mut all = Vec::new();
        for _ in 0..11 {
            now += 1_000;
            let seen: HashMap<u32, u64> = WANTED
                .iter()
                .filter(|(id, _)| *id != MSG_ID_SYSTEM_TIME)
                .map(|(id, _)| (*id, now))
                .collect();
            let (next, reqs) = r.on_heartbeat(now, &seen);
            all.extend(reqs);
            r = next;
        }
        assert_eq!(ids(&all), vec![MSG_ID_SYSTEM_TIME]);
    }

    #[test]
    fn retries_every_5s_while_still_missing() {
        let (_, reqs) = beats(IntervalRequester::default(), 0, 8_000, |_| HashMap::new());
        let at = |t: u64| reqs.iter().filter(|(when, _)| *when == t).count();
        assert_eq!(at(3_000), WANTED.len());
        assert_eq!((4_000..8_000).step_by(1_000).map(at).sum::<usize>(), 0);
        assert_eq!(
            at(8_000),
            WANTED.len() - ONCE.len(),
            "state-dependent streams are not retried"
        );
    }
}
