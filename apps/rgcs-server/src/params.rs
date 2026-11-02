//! Per-vehicle parameter cache and the download / verified-write service.
//!
//! The cache is fed by every PARAM_VALUE (guided fence checks, mission validation and the
//! params tab all read it). A full download is PARAM_REQUEST_LIST followed by gap completion
//! with PARAM_REQUEST_READ by index; a write is PARAM_SET followed by the vehicle's echo.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use rgcs_core::{ParamChange, ParamEntry, ParamProgress, ParamWriteResult, ServerMessage, SysId};
use rgcs_mavlink::{
    encode_param_request_index, encode_param_request_list, encode_param_set, Outgoing, RouterEvent,
};
use tokio::sync::{broadcast, mpsc};

/// Progress frames go out every this many received values (and on completion / refresh).
const PROGRESS_EVERY: u32 = 25;
/// Gap completion: after this much silence the missing indexes are re-requested.
const IDLE_BEFORE_GAPS: Duration = Duration::from_millis(1000);
const GAP_BATCH: usize = 20;
/// The download gives up after this many silent rounds without progress.
const MAX_IDLE_ROUNDS: u32 = 10;
const TICK: Duration = Duration::from_millis(250);
pub const ECHO_TIMEOUT: Duration = Duration::from_millis(1500);
pub const SET_ATTEMPTS: u32 = 3;
/// `PARAM_VALUE.param_index` of a value that is not part of the list stream (ArduPilot's -1).
pub const NO_INDEX: u16 = u16::MAX;

#[derive(Default)]
struct VehicleParams {
    entries: HashMap<String, (ParamEntry, Instant)>,
    count: Option<u16>,
    received: HashSet<u16>,
    downloading: bool,
    last_rx: Option<Instant>,
}

impl VehicleParams {
    fn progress(&self) -> ParamProgress {
        let total = self.count.map(u32::from);
        let received = self.received.len() as u32;
        ParamProgress {
            received,
            total,
            complete: total.is_some_and(|t| received >= t),
            downloading: self.downloading,
        }
    }
}

/// Shared, cheap to clone. Mutated in place under its mutex (a full list is ~1,200 entries).
#[derive(Clone)]
pub struct ParamCache {
    inner: Arc<Mutex<HashMap<SysId, VehicleParams>>>,
    tx: broadcast::Sender<ServerMessage>,
}

impl ParamCache {
    pub fn new(tx: broadcast::Sender<ServerMessage>) -> Self {
        Self {
            inner: Arc::default(),
            tx,
        }
    }

    fn with<R>(&self, sysid: SysId, f: impl FnOnce(&mut VehicleParams) -> R) -> R {
        let mut map = self.inner.lock().expect("param cache mutex");
        f(map.entry(sysid).or_default())
    }

    pub fn get(&self, sysid: SysId, name: &str) -> Option<f32> {
        self.entry(sysid, name).map(|e| e.value)
    }

    pub fn entry(&self, sysid: SysId, name: &str) -> Option<ParamEntry> {
        let map = self.inner.lock().expect("param cache mutex");
        map.get(&sysid)
            .and_then(|v| v.entries.get(name))
            .map(|(e, _)| e.clone())
    }

    /// When the entry was last written by a PARAM_VALUE (None when unknown).
    fn updated_at(&self, sysid: SysId, name: &str) -> Option<Instant> {
        let map = self.inner.lock().expect("param cache mutex");
        map.get(&sysid)
            .and_then(|v| v.entries.get(name))
            .map(|(_, at)| *at)
    }

    /// Test / seed helper: a value without index or type.
    pub fn set(&self, sysid: SysId, name: &str, value: f32) {
        self.with(sysid, |v| {
            v.entries.insert(
                name.to_string(),
                (
                    ParamEntry {
                        name: name.to_string(),
                        value,
                        index: 0,
                        ptype: 0,
                    },
                    Instant::now(),
                ),
            );
        });
    }

    /// Records one PARAM_VALUE; broadcasts progress every 25 values and on completion.
    /// ArduPilot answers PARAM_SET and by-name reads with `param_index = -1` (65535): those
    /// carry a value but say nothing about the list, so they neither count toward progress
    /// nor overwrite the index learned from the list stream.
    pub fn on_value(&self, sysid: SysId, entry: ParamEntry, count: u16) {
        let (progress, announce) = self.with(sysid, |v| {
            if count > 0 {
                v.count = Some(count);
            }
            let indexed = entry.index != NO_INDEX && v.count.is_none_or(|n| entry.index < n);
            let index = if indexed {
                v.received.insert(entry.index);
                entry.index
            } else {
                v.entries
                    .get(&entry.name)
                    .map(|(e, _)| e.index)
                    .unwrap_or(NO_INDEX)
            };
            v.last_rx = Some(Instant::now());
            v.entries.insert(
                entry.name.clone(),
                (ParamEntry { index, ..entry }, Instant::now()),
            );
            let was_downloading = v.downloading;
            if v.progress().complete {
                v.downloading = false;
            }
            let p = v.progress();
            let announce = was_downloading && (p.received % PROGRESS_EVERY == 0 || p.complete);
            (p, announce)
        });
        if announce {
            let _ = self.tx.send(ServerMessage::ParamProgress { sysid, progress });
        }
    }

    /// Records `ParamValue` events; everything else is ignored.
    pub fn apply(&self, ev: &RouterEvent) {
        if let RouterEvent::ParamValue {
            sysid,
            name,
            value,
            index,
            count,
            ptype,
        } = ev
        {
            self.on_value(
                *sysid,
                ParamEntry {
                    name: name.clone(),
                    value: *value,
                    index: *index,
                    ptype: *ptype,
                },
                *count,
            );
        }
    }

    /// Every cached entry, sorted by name.
    pub fn entries(&self, sysid: SysId) -> Vec<ParamEntry> {
        let map = self.inner.lock().expect("param cache mutex");
        let mut out: Vec<ParamEntry> = map
            .get(&sysid)
            .map(|v| v.entries.values().map(|(e, _)| e.clone()).collect())
            .unwrap_or_default();
        out.sort_by(|a, b| a.name.cmp(&b.name));
        out
    }

    pub fn progress(&self, sysid: SysId) -> ParamProgress {
        self.with(sysid, |v| v.progress())
    }

    /// Indexes below `count` that were never received (at most `max`).
    pub fn missing_indexes(&self, sysid: SysId, max: usize) -> Vec<u16> {
        self.with(sysid, |v| match v.count {
            Some(n) => (0..n).filter(|i| !v.received.contains(i)).take(max).collect(),
            None => Vec::new(),
        })
    }

    /// Starts a download: forgets the index bookkeeping (values stay until replaced).
    /// Returns false when one is already running.
    pub fn begin_download(&self, sysid: SysId) -> bool {
        let (started, progress) = self.with(sysid, |v| {
            if v.downloading {
                return (false, v.progress());
            }
            v.downloading = true;
            v.received.clear();
            v.count = None;
            v.last_rx = None;
            (true, v.progress())
        });
        if started {
            let _ = self.tx.send(ServerMessage::ParamProgress { sysid, progress });
        }
        started
    }

    /// Marks the download finished (gave up or link gone); a completed one already announced itself.
    pub fn end_download(&self, sysid: SysId) {
        let (changed, progress) = self.with(sysid, |v| {
            let changed = v.downloading;
            v.downloading = false;
            (changed, v.progress())
        });
        if changed {
            let _ = self.tx.send(ServerMessage::ParamProgress { sysid, progress });
        }
    }

    fn idle_for(&self, sysid: SysId) -> Duration {
        self.with(sysid, |v| v.last_rx.map(|t| t.elapsed()).unwrap_or(Duration::MAX))
    }
}

/// Runs the full download for `sysid` until complete or hopeless; returns the final progress.
pub async fn download(cache: ParamCache, sysid: SysId, outgoing: mpsc::Sender<Outgoing>) -> ParamProgress {
    if outgoing
        .send(Outgoing {
            message: encode_param_request_list(sysid),
        })
        .await
        .is_err()
    {
        cache.end_download(sysid);
        return cache.progress(sysid);
    }
    let mut idle_rounds = 0u32;
    let mut last_received = 0u32;
    loop {
        tokio::time::sleep(TICK).await;
        let p = cache.progress(sysid);
        if p.complete {
            break;
        }
        if p.received != last_received {
            last_received = p.received;
            idle_rounds = 0;
        }
        if cache.idle_for(sysid) >= IDLE_BEFORE_GAPS {
            idle_rounds += 1;
            if idle_rounds > MAX_IDLE_ROUNDS {
                break;
            }
            for index in cache.missing_indexes(sysid, GAP_BATCH) {
                if outgoing
                    .send(Outgoing {
                        message: encode_param_request_index(sysid, index),
                    })
                    .await
                    .is_err()
                {
                    break;
                }
            }
        }
    }
    cache.end_download(sysid);
    cache.progress(sysid)
}

/// Verification tolerance for a float32 round trip.
pub fn matches(requested: f32, actual: f32) -> bool {
    (actual - requested).abs() <= f32::max(1e-4, 1e-6 * requested.abs())
}

/// PARAM_SET + echo for one change; `actual` is the echoed value when one arrived.
/// A value for the name that arrives after the SET but does not match (the list stream, a
/// second GCS's echo) is not the verdict: polling continues until the attempt's deadline and
/// the mismatch is reported only then, without resending.
pub async fn write_one(
    cache: &ParamCache,
    sysid: SysId,
    change: &ParamChange,
    outgoing: &mpsc::Sender<Outgoing>,
) -> ParamWriteResult {
    let ptype = cache.entry(sysid, &change.name).map(|e| e.ptype).unwrap_or(0);
    for _ in 0..SET_ATTEMPTS {
        let sent_at = Instant::now();
        if outgoing
            .send(Outgoing {
                message: encode_param_set(sysid, &change.name, change.value, ptype),
            })
            .await
            .is_err()
        {
            break;
        }
        let deadline = sent_at + ECHO_TIMEOUT;
        let mut seen: Option<f32> = None;
        while Instant::now() < deadline {
            tokio::time::sleep(Duration::from_millis(50)).await;
            if cache
                .updated_at(sysid, &change.name)
                .is_some_and(|t| t >= sent_at)
            {
                let actual = cache.get(sysid, &change.name);
                if actual.is_some_and(|a| matches(change.value, a)) {
                    return ParamWriteResult {
                        name: change.name.clone(),
                        requested: change.value,
                        actual,
                        verified: true,
                        reason: None,
                    };
                }
                seen = actual;
            }
        }
        if let Some(actual) = seen {
            return ParamWriteResult {
                name: change.name.clone(),
                requested: change.value,
                actual: Some(actual),
                verified: false,
                reason: Some("mismatch".to_string()),
            };
        }
    }
    unverified(change, "no_echo")
}

/// A result for a change that was not (successfully) written.
pub fn unverified(change: &ParamChange, reason: &str) -> ParamWriteResult {
    ParamWriteResult {
        name: change.name.clone(),
        requested: change.value,
        actual: None,
        verified: false,
        reason: Some(reason.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cache() -> ParamCache {
        let (tx, _) = broadcast::channel(8);
        ParamCache::new(tx)
    }

    #[test]
    fn set_get_and_missing() {
        let p = cache();
        assert_eq!(p.get(1, "FENCE_ALT_MAX"), None);
        p.set(1, "FENCE_ALT_MAX", 120.0);
        assert_eq!(p.get(1, "FENCE_ALT_MAX"), Some(120.0));
        assert_eq!(p.get(2, "FENCE_ALT_MAX"), None);
    }

    #[test]
    fn apply_records_param_value_events_only() {
        let p = cache();
        p.apply(&RouterEvent::Updated(1));
        p.apply(&RouterEvent::ParamValue {
            sysid: 1,
            name: "FENCE_ENABLE".into(),
            value: 1.0,
            index: 0,
            count: 1,
            ptype: 2,
        });
        assert_eq!(p.get(1, "FENCE_ENABLE"), Some(1.0));
        assert_eq!(p.entry(1, "FENCE_ENABLE").unwrap().ptype, 2);
        assert!(p.progress(1).complete);
    }

    #[test]
    fn progress_and_missing_indexes_follow_the_count() {
        let p = cache();
        assert!(p.begin_download(1));
        assert!(!p.begin_download(1), "already running");
        for i in [0u16, 1, 3] {
            p.on_value(
                1,
                ParamEntry {
                    name: format!("P{i}"),
                    value: 0.0,
                    index: i,
                    ptype: 9,
                },
                4,
            );
        }
        let pr = p.progress(1);
        assert_eq!(
            (pr.received, pr.total, pr.complete, pr.downloading),
            (3, Some(4), false, true)
        );
        assert_eq!(p.missing_indexes(1, 20), vec![2]);
        p.end_download(1);
        assert!(!p.progress(1).downloading);
    }

    #[test]
    fn echoes_without_index_do_not_count_toward_progress() {
        let p = cache();
        assert!(p.begin_download(1));
        p.on_value(
            1,
            ParamEntry {
                name: "A".into(),
                value: 1.0,
                index: 0,
                ptype: 9,
            },
            2,
        );
        // a PARAM_SET echo / by-name read: ArduPilot sends param_index = -1
        p.on_value(
            1,
            ParamEntry {
                name: "A".into(),
                value: 5.0,
                index: u16::MAX,
                ptype: 9,
            },
            2,
        );
        p.on_value(
            1,
            ParamEntry {
                name: "FENCE_ENABLE".into(),
                value: 1.0,
                index: u16::MAX,
                ptype: 2,
            },
            2,
        );
        let pr = p.progress(1);
        assert_eq!((pr.received, pr.total, pr.complete), (1, Some(2), false));
        assert_eq!(p.get(1, "A"), Some(5.0), "the value is still taken");
        assert_eq!(p.entry(1, "A").unwrap().index, 0, "the known index is kept");
        assert_eq!(p.missing_indexes(1, 20), vec![1]);
    }

    #[test]
    fn tolerance_is_float32_sized() {
        assert!(matches(150.0, 150.00001));
        assert!(matches(0.1, 0.1 + 5e-5));
        assert!(!matches(150.0, 151.0));
    }
}
