//! Link statistics for the network view: per (sysid, compid) received msg/s, bytes/s
//! (estimated), loss from MAVLink sequence gaps, MAV_TYPE from HEARTBEAT and last-rx age, plus
//! the link's connection state.
//!
//! Rates are 1 s buckets summed over the last [`STATS_WINDOW_S`] complete seconds; the
//! current, incomplete second is excluded. `record` runs on the link task for every frame, so
//! it holds a `std::sync::Mutex` only for a map update (no await, no allocation per frame
//! beyond first-seen keys).

use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Instant;

use mavlink::dialects::ardupilotmega::MavMessage;
use mavlink::{MAVLinkV2MessageRaw, MavHeader};
use rgcs_core::ComponentKind;

/// Rates and loss cover this many complete seconds.
pub const STATS_WINDOW_S: u64 = 5;
/// (sysid, compid) pairs kept at most; the least recently seen makes room.
pub const MAX_COMPONENTS: usize = 256;
/// Bucket ring length (> STATS_WINDOW_S + 1, so the window never meets the open second).
const RING: usize = 8;
/// Gaps at or above this are duplicates, reordering or a restart: resync, nothing lost.
const RESYNC_GAP: u8 = 128;
/// A component silent for longer than this rebooted or dropped out: the next frame sets the
/// baseline instead of counting the sequence gap (the silence shows as stale rx instead).
pub const RESYNC_SILENCE_MS: u64 = 2_000;
/// A connected link with no frame for longer than this is stale (no data), like the router's
/// heartbeat `delay` threshold.
pub const STALE_RX_MS: u64 = 3_000;

const MAV_TYPE_GCS: u8 = 6;
const MAV_TYPE_ONBOARD_CONTROLLER: u8 = 18;
const MAV_TYPE_GIMBAL: u8 = 26;
const MAV_TYPE_CAMERA: u8 = 30;
const MAV_AUTOPILOT_INVALID: u8 = 8;

#[derive(Debug, Clone, Copy, Default)]
struct Bucket {
    second: u64,
    frames: u32,
    bytes: u32,
    lost: u32,
}

/// Sums over the window.
#[derive(Debug, Clone, Copy, Default)]
struct Totals {
    frames: u64,
    bytes: u64,
    lost: u64,
}

impl Totals {
    fn plus(self, o: Totals) -> Totals {
        Totals {
            frames: self.frames + o.frames,
            bytes: self.bytes + o.bytes,
            lost: self.lost + o.lost,
        }
    }

    fn msgs_per_s(&self) -> f32 {
        self.frames as f32 / STATS_WINDOW_S as f32
    }

    fn bytes_per_s(&self) -> f32 {
        self.bytes as f32 / STATS_WINDOW_S as f32
    }

    fn loss_pct(&self) -> f32 {
        let total = self.frames + self.lost;
        if total == 0 {
            0.0
        } else {
            self.lost as f32 / total as f32 * 100.0
        }
    }
}

#[derive(Debug, Clone)]
struct Comp {
    last_seq: Option<u8>,
    mav_type: Option<u8>,
    autopilot: Option<u8>,
    last_ms: u64,
    buckets: [Bucket; RING],
}

impl Comp {
    fn new(now_ms: u64) -> Self {
        Self {
            last_seq: None,
            mav_type: None,
            autopilot: None,
            last_ms: now_ms,
            buckets: [Bucket::default(); RING],
        }
    }

    fn observe(&mut self, seq: u8, bytes: u32, now_ms: u64) {
        let resync = now_ms.saturating_sub(self.last_ms) > RESYNC_SILENCE_MS;
        let lost = match self.last_seq {
            Some(last) if !resync => lost_between(last, seq),
            _ => 0,
        };
        self.last_seq = Some(seq);
        self.last_ms = now_ms;
        let second = now_ms / 1000;
        let b = &mut self.buckets[(second % RING as u64) as usize];
        if b.second != second {
            *b = Bucket {
                second,
                ..Bucket::default()
            };
        }
        b.frames += 1;
        b.bytes = b.bytes.saturating_add(bytes);
        b.lost += lost;
    }

    /// Sums of the buckets for the complete seconds `[now_s - WINDOW, now_s - 1]`.
    fn totals(&self, now_ms: u64) -> Totals {
        let now_s = now_ms / 1000;
        (now_s.saturating_sub(STATS_WINDOW_S)..now_s)
            .map(|s| (s, self.buckets[(s % RING as u64) as usize]))
            .filter(|(s, b)| b.second == *s)
            .fold(Totals::default(), |acc, (_, b)| {
                acc.plus(Totals {
                    frames: b.frames.into(),
                    bytes: b.bytes.into(),
                    lost: b.lost.into(),
                })
            })
    }

    fn stats(&self, key: (u8, u8), now_ms: u64) -> (ComponentStats, Totals) {
        let t = self.totals(now_ms);
        let stats = ComponentStats {
            sysid: key.0,
            compid: key.1,
            mav_type: self.mav_type,
            autopilot: self.autopilot,
            kind: component_kind(key.1, self.mav_type, self.autopilot),
            rx_msgs_per_s: t.msgs_per_s(),
            rx_bytes_per_s: t.bytes_per_s(),
            loss_pct: t.loss_pct(),
            last_rx_age_ms: now_ms.saturating_sub(self.last_ms),
        };
        (stats, t)
    }
}

/// Frames lost between two sequence numbers (fixed values table: 1..=127 lost, >= 128 resync).
fn lost_between(last: u8, seq: u8) -> u32 {
    let gap = seq.wrapping_sub(last.wrapping_add(1));
    if gap < RESYNC_GAP {
        gap.into()
    } else {
        0
    }
}

#[derive(Debug, Default)]
struct Inner {
    connected: bool,
    since: Option<u64>,
    /// Stats clock (ms) at the last connect: the stale timer starts here.
    connected_ms: u64,
    reconnects: u32,
    connects: u32,
    last_error: Option<String>,
    comps: HashMap<(u8, u8), Comp>,
}

impl Inner {
    fn make_room_for(&mut self, key: (u8, u8)) {
        if self.comps.len() < MAX_COMPONENTS || self.comps.contains_key(&key) {
            return;
        }
        if let Some(oldest) = self.comps.iter().min_by_key(|(_, c)| c.last_ms).map(|(k, _)| *k) {
            self.comps.remove(&oldest);
        }
    }
}

/// Link counters shared by the link task (writer) and the network API (reader).
#[derive(Debug, Clone)]
pub struct LinkStats {
    inner: Arc<Mutex<Inner>>,
    started: Instant,
}

impl Default for LinkStats {
    fn default() -> Self {
        Self {
            inner: Arc::default(),
            started: Instant::now(),
        }
    }
}

/// The link and its components at one instant.
#[derive(Debug, Clone, PartialEq)]
pub struct LinkStatsSnapshot {
    pub connected: bool,
    pub connected_since_unix_ms: Option<u64>,
    pub reconnects: u32,
    pub last_error: Option<String>,
    pub rx_msgs_per_s: f32,
    pub rx_bytes_per_s: f32,
    pub loss_pct: f32,
    pub last_rx_age_ms: Option<u64>,
    /// Connected, but no frame for more than [`STALE_RX_MS`] (since the connect or the last
    /// frame, whichever is later).
    pub rx_stale: bool,
    /// Sorted by (sysid, compid).
    pub components: Vec<ComponentStats>,
}

/// One (sysid, compid) seen on the link.
#[derive(Debug, Clone, PartialEq)]
pub struct ComponentStats {
    pub sysid: u8,
    pub compid: u8,
    pub mav_type: Option<u8>,
    pub autopilot: Option<u8>,
    pub kind: ComponentKind,
    pub rx_msgs_per_s: f32,
    pub rx_bytes_per_s: f32,
    pub loss_pct: f32,
    pub last_rx_age_ms: u64,
}

impl LinkStats {
    /// The stats' own clock (ms since created), like [`crate::Inspector::now_ms`].
    pub fn now_ms(&self) -> u64 {
        self.started.elapsed().as_millis() as u64
    }

    /// A poisoned lock still holds valid counters; never panic on the link task.
    fn lock(&self) -> MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// The link is up. Every call after the first counts a reconnect; sequence baselines reset
    /// and the last error is cleared (it stays in the server log). `now_ms` is the stats clock.
    pub fn on_connected(&self, unix_ms: u64, now_ms: u64) {
        let mut inner = self.lock();
        inner.connects += 1;
        if inner.connects > 1 {
            inner.reconnects += 1;
        }
        inner.connected = true;
        inner.since = Some(unix_ms);
        inner.connected_ms = now_ms;
        inner.last_error = None;
        inner.comps.values_mut().for_each(|c| c.last_seq = None);
    }

    /// The link is down (or a connect attempt failed); `error` replaces the last error.
    pub fn on_disconnected(&self, error: Option<String>) {
        let mut inner = self.lock();
        inner.connected = false;
        inner.since = None;
        if error.is_some() {
            inner.last_error = error;
        }
    }

    /// Called for every received frame; holds the lock only for a map update (no await).
    pub fn record(&self, header: &MavHeader, msg: &MavMessage, now_ms: u64) {
        let bytes = u32::try_from(frame_bytes(header, msg)).unwrap_or(u32::MAX);
        let ids = heartbeat_ids(msg);
        let key = (header.system_id, header.component_id);
        let mut inner = self.lock();
        inner.make_room_for(key);
        let comp = inner.comps.entry(key).or_insert_with(|| Comp::new(now_ms));
        if let Some((mav_type, autopilot)) = ids {
            comp.mav_type = Some(mav_type);
            comp.autopilot = Some(autopilot);
        }
        comp.observe(header.sequence, bytes, now_ms);
    }

    pub fn snapshot(&self, now_ms: u64) -> LinkStatsSnapshot {
        let inner = self.lock();
        let mut rows: Vec<_> = inner.comps.iter().map(|(k, c)| c.stats(*k, now_ms)).collect();
        rows.sort_by_key(|(c, _)| (c.sysid, c.compid));
        let link = rows.iter().fold(Totals::default(), |acc, (_, t)| acc.plus(*t));
        let last_ms = inner.comps.values().map(|c| c.last_ms).max();
        let quiet_since = last_ms.unwrap_or(0).max(inner.connected_ms);
        let rx_stale = inner.connected && now_ms.saturating_sub(quiet_since) > STALE_RX_MS;
        LinkStatsSnapshot {
            connected: inner.connected,
            connected_since_unix_ms: inner.since,
            reconnects: inner.reconnects,
            last_error: inner.last_error.clone(),
            rx_msgs_per_s: link.msgs_per_s(),
            rx_bytes_per_s: link.bytes_per_s(),
            loss_pct: link.loss_pct(),
            last_rx_age_ms: last_ms.map(|m| now_ms.saturating_sub(m)),
            rx_stale,
            components: rows.into_iter().map(|(c, _)| c).collect(),
        }
    }
}

/// (MAV_TYPE, MAV_AUTOPILOT) of a HEARTBEAT.
fn heartbeat_ids(msg: &MavMessage) -> Option<(u8, u8)> {
    match msg {
        MavMessage::HEARTBEAT(hb) => Some((hb.mavtype as u8, hb.autopilot as u8)),
        _ => None,
    }
}

/// HEARTBEAT `MAV_TYPE` wins; without one, the COMPID decides (80 §2).
pub fn component_kind(compid: u8, mav_type: Option<u8>, autopilot: Option<u8>) -> ComponentKind {
    match mav_type {
        Some(MAV_TYPE_GCS) => ComponentKind::Gcs,
        Some(MAV_TYPE_ONBOARD_CONTROLLER) => ComponentKind::Companion,
        Some(MAV_TYPE_GIMBAL) => ComponentKind::Gimbal,
        Some(MAV_TYPE_CAMERA) => ComponentKind::Camera,
        Some(_) if autopilot.is_some_and(|a| a != MAV_AUTOPILOT_INVALID) => ComponentKind::Autopilot,
        _ => kind_of_compid(compid),
    }
}

fn kind_of_compid(compid: u8) -> ComponentKind {
    match compid {
        1 => ComponentKind::Autopilot,
        100..=105 => ComponentKind::Camera,
        154 | 171..=175 => ComponentKind::Gimbal,
        191..=194 => ComponentKind::Companion,
        190 => ComponentKind::Gcs,
        _ => ComponentKind::Other,
    }
}

/// Estimated wire size: the MAVLink 2 serialized length (10 header + truncated payload + 2 CRC),
/// without a signature. The `mavlink` crate does not expose the received byte count.
pub fn frame_bytes(header: &MavHeader, msg: &MavMessage) -> usize {
    let mut raw = MAVLinkV2MessageRaw::new();
    raw.serialize_message(*header, msg);
    raw.raw_bytes().len()
}

#[cfg(test)]
mod tests {
    use super::*;
    use mavlink::dialects::ardupilotmega::{MavAutopilot, MavType, CAMERA_SETTINGS_DATA, HEARTBEAT_DATA};
    use rgcs_core::ComponentKind;

    fn hdr(sysid: u8, compid: u8, seq: u8) -> MavHeader {
        MavHeader {
            system_id: sysid,
            component_id: compid,
            sequence: seq,
        }
    }

    fn hb() -> MavMessage {
        MavMessage::HEARTBEAT(HEARTBEAT_DATA {
            mavlink_version: 3,
            ..HEARTBEAT_DATA::DEFAULT
        })
    }

    fn hb_of(mavtype: MavType, autopilot: MavAutopilot) -> MavMessage {
        MavMessage::HEARTBEAT(HEARTBEAT_DATA {
            mavtype,
            autopilot,
            mavlink_version: 3,
            ..HEARTBEAT_DATA::DEFAULT
        })
    }

    fn feed(stats: &LinkStats, seqs: &[u8], start_ms: u64) {
        for (i, s) in seqs.iter().enumerate() {
            stats.record(&hdr(1, 1, *s), &hb(), start_ms + 100 * i as u64);
        }
    }

    fn comp_loss(stats: &LinkStats, now_ms: u64) -> f32 {
        stats.snapshot(now_ms).components[0].loss_pct
    }

    #[test]
    fn heartbeat_frame_is_21_bytes() {
        assert_eq!(frame_bytes(&hdr(1, 1, 0), &hb()), 21);
    }

    #[test]
    fn rate_counts_complete_seconds_only() {
        let stats = LinkStats::default();
        let seqs: Vec<u8> = (0..50).collect();
        feed(&stats, &seqs, 1000);
        for now in [6000, 6999] {
            let s = stats.snapshot(now);
            assert_eq!(s.rx_msgs_per_s, 10.0);
            assert_eq!(s.rx_bytes_per_s, 210.0);
            assert_eq!(s.loss_pct, 0.0);
            assert_eq!(s.components[0].rx_msgs_per_s, 10.0);
        }
        assert_eq!(stats.snapshot(12000).rx_msgs_per_s, 0.0);
    }

    #[test]
    fn gap_counts_as_lost() {
        let stats = LinkStats::default();
        feed(&stats, &[0, 1, 2, 5], 1000);
        assert!((comp_loss(&stats, 2000) - 33.33).abs() < 0.01);
        assert!((stats.snapshot(2000).loss_pct - 33.33).abs() < 0.01);
    }

    #[test]
    fn wrap_and_reorder_are_not_loss() {
        let stats = LinkStats::default();
        feed(&stats, &[254, 255, 0, 1], 1000);
        assert_eq!(comp_loss(&stats, 2000), 0.0);
        feed(&stats, &[1], 1500);
        assert_eq!(comp_loss(&stats, 2000), 0.0);
        feed(&stats, &[2], 1600);
        assert_eq!(comp_loss(&stats, 2000), 0.0);
    }

    #[test]
    fn silence_then_gap_is_a_resync_not_loss() {
        // FC reboot: last seq 200, 3 s of silence, first post-boot frame seq 0 (gap 55).
        let stats = LinkStats::default();
        stats.record(&hdr(1, 1, 200), &hb(), 1000);
        stats.record(&hdr(1, 1, 0), &hb(), 4000);
        stats.record(&hdr(1, 1, 1), &hb(), 4100);
        assert_eq!(comp_loss(&stats, 6000), 0.0);
    }

    #[test]
    fn gap_within_a_short_pause_is_still_loss() {
        let stats = LinkStats::default();
        stats.record(&hdr(1, 1, 10), &hb(), 1000);
        stats.record(&hdr(1, 1, 16), &hb(), 1100);
        let s = stats.snapshot(2000);
        // 5 lost of 7 (2 received)
        assert!((s.components[0].loss_pct - 500.0 / 7.0).abs() < 0.01);
        let stats = LinkStats::default();
        stats.record(&hdr(1, 1, 10), &hb(), 1000);
        stats.record(&hdr(1, 1, 16), &hb(), 1000 + RESYNC_SILENCE_MS);
        assert!(comp_loss(&stats, 4000) > 0.0);
    }

    #[test]
    fn a_successful_connect_clears_the_last_error() {
        let stats = LinkStats::default();
        stats.on_disconnected(Some("Connection refused".into()));
        assert_eq!(
            stats.snapshot(0).last_error.as_deref(),
            Some("Connection refused")
        );
        stats.on_connected(1, 0);
        assert_eq!(stats.snapshot(0).last_error, None);
    }

    #[test]
    fn connected_link_without_frames_for_3_s_is_stale() {
        let stats = LinkStats::default();
        assert!(!stats.snapshot(10_000).rx_stale, "a down link is not stale");
        stats.on_connected(1, 1_000);
        assert!(!stats.snapshot(4_000).rx_stale, "3 s grace after connecting");
        assert!(stats.snapshot(4_001).rx_stale, "never heard anything");
        stats.record(&hdr(1, 1, 0), &hb(), 5_000);
        assert!(!stats.snapshot(8_000).rx_stale);
        assert!(stats.snapshot(8_001).rx_stale, "silent for > 3 s");
        stats.on_disconnected(Some("eof".into()));
        assert!(!stats.snapshot(9_000).rx_stale);
    }

    #[test]
    fn reconnect_resets_baselines() {
        let stats = LinkStats::default();
        stats.on_connected(1, 0);
        feed(&stats, &[10], 1000);
        stats.on_connected(2, 1050);
        feed(&stats, &[200], 1100);
        let s = stats.snapshot(2000);
        assert_eq!(s.components[0].loss_pct, 0.0);
        assert_eq!(s.reconnects, 1);
    }

    #[test]
    fn components_are_kept_per_pair_and_classified() {
        let stats = LinkStats::default();
        let ap = hb_of(
            MavType::MAV_TYPE_QUADROTOR,
            MavAutopilot::MAV_AUTOPILOT_ARDUPILOTMEGA,
        );
        let gimbal = hb_of(MavType::MAV_TYPE_GIMBAL, MavAutopilot::MAV_AUTOPILOT_INVALID);
        let cam = MavMessage::CAMERA_SETTINGS(CAMERA_SETTINGS_DATA::DEFAULT);
        stats.record(&hdr(1, 154, 0), &gimbal, 1000);
        stats.record(&hdr(1, 100, 0), &cam, 1000);
        stats.record(&hdr(1, 1, 0), &ap, 1000);
        let s = stats.snapshot(2000);
        let kinds: Vec<_> = s.components.iter().map(|c| (c.compid, c.kind)).collect();
        assert_eq!(
            kinds,
            vec![
                (1, ComponentKind::Autopilot),
                (100, ComponentKind::Camera),
                (154, ComponentKind::Gimbal)
            ]
        );
        assert_eq!(s.components[0].mav_type, Some(MavType::MAV_TYPE_QUADROTOR as u8));
        assert_eq!(s.components[1].mav_type, None);
    }

    #[test]
    fn component_kind_table() {
        use ComponentKind::*;
        let cases = [
            ((1, None, None), Autopilot),
            ((101, None, None), Camera),
            ((172, None, None), Gimbal),
            ((191, None, None), Companion),
            ((190, None, None), Gcs),
            ((42, None, None), Other),
            ((42, Some(6), Some(8)), Gcs),
            ((42, Some(2), Some(3)), Autopilot),
            ((1, Some(18), Some(8)), Companion),
        ];
        for ((compid, t, a), want) in cases {
            assert_eq!(component_kind(compid, t, a), want, "{compid} {t:?} {a:?}");
        }
    }

    #[test]
    fn components_are_bounded() {
        let stats = LinkStats::default();
        let mut t = 0;
        for sysid in 1..=2u8 {
            for compid in 0..150u8 {
                stats.record(&hdr(sysid, compid, 0), &hb(), t);
                t += 1;
            }
        }
        let s = stats.snapshot(t);
        assert_eq!(s.components.len(), MAX_COMPONENTS);
        assert!(!s.components.iter().any(|c| (c.sysid, c.compid) == (1, 0)));
        assert!(s.components.iter().any(|c| (c.sysid, c.compid) == (2, 149)));
    }

    #[test]
    fn last_rx_age_and_connection_state() {
        let stats = LinkStats::default();
        let s = stats.snapshot(0);
        assert!(!s.connected);
        assert_eq!(s.last_rx_age_ms, None);
        stats.on_connected(1_700_000_000_000, 0);
        stats.record(&hdr(1, 1, 0), &hb(), 500);
        let s = stats.snapshot(1500);
        assert!(s.connected);
        assert_eq!(s.connected_since_unix_ms, Some(1_700_000_000_000));
        assert_eq!(s.last_rx_age_ms, Some(1000));
        assert_eq!(s.components[0].last_rx_age_ms, 1000);
        stats.on_disconnected(Some("eof".into()));
        let s = stats.snapshot(1500);
        assert!(!s.connected);
        assert_eq!(s.last_error.as_deref(), Some("eof"));
        assert_eq!(s.reconnects, 0);
    }
}
