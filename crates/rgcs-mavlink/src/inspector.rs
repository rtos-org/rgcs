//! MAVLink inspector (user request 2026-10-19): every frame received from and sent to the link,
//! one row per (direction, system, component, message) with count, rate and the last message.
//! The last message is kept as is and turned into JSON only when someone looks at it.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use mavlink::dialects::ardupilotmega::MavMessage;
use mavlink::{MavHeader, Message};
use rgcs_core::{InspectorDetail, InspectorDir, InspectorRow};

/// Rates are counted over windows of this length.
const WINDOW_MS: u64 = 2_000;
/// Rows kept at most: forged system / component ids on the link cannot grow the table without
/// bound; the least recently seen row makes room.
pub const MAX_ROWS: usize = 4_096;

type Key = (InspectorDir, u8, u8, u32);

#[derive(Debug, Clone)]
struct Entry {
    count: u64,
    last_ms: u64,
    window_start_ms: u64,
    window_count: u64,
    rate_hz: f32,
    last: MavMessage,
}

#[derive(Debug, Clone)]
pub struct Inspector {
    rows: Arc<Mutex<HashMap<Key, Entry>>>,
    started: Instant,
}

impl Default for Inspector {
    fn default() -> Self {
        Self {
            rows: Arc::default(),
            started: Instant::now(),
        }
    }
}

impl Inspector {
    /// The inspector's own clock (ms since it was created), shared by the link and the API.
    pub fn now_ms(&self) -> u64 {
        self.started.elapsed().as_millis() as u64
    }

    /// Called for every frame; holds the lock only for a map update (no await).
    pub fn record(&self, dir: InspectorDir, header: &MavHeader, msg: &MavMessage, now_ms: u64) {
        let key = (dir, header.system_id, header.component_id, msg.message_id());
        let mut map = self.rows.lock().expect("inspector mutex");
        if map.len() >= MAX_ROWS && !map.contains_key(&key) {
            if let Some(oldest) = map.iter().min_by_key(|(_, e)| e.last_ms).map(|(k, _)| *k) {
                map.remove(&oldest);
            }
        }
        let e = map.entry(key).or_insert_with(|| Entry {
            count: 0,
            last_ms: now_ms,
            window_start_ms: now_ms,
            window_count: 0,
            rate_hz: 0.0,
            last: msg.clone(),
        });
        e.count += 1;
        e.window_count += 1;
        e.last_ms = now_ms;
        e.last = msg.clone();
        let span = now_ms.saturating_sub(e.window_start_ms);
        if span >= WINDOW_MS {
            e.rate_hz = e.window_count as f32 * 1000.0 / span as f32;
            e.window_start_ms = now_ms;
            e.window_count = 0;
        }
    }

    pub fn rows(&self, now_ms: u64) -> Vec<InspectorRow> {
        let map = self.rows.lock().expect("inspector mutex");
        let mut rows: Vec<_> = map.iter().map(|(k, e)| row(k, e, now_ms)).collect();
        rows.sort_by(|a, b| {
            (a.dir as u8, a.sysid, a.compid, &a.name).cmp(&(b.dir as u8, b.sysid, b.compid, &b.name))
        });
        rows
    }

    pub fn detail(
        &self,
        dir: InspectorDir,
        sysid: u8,
        compid: u8,
        msg_id: u32,
        now_ms: u64,
    ) -> Option<InspectorDetail> {
        let key = (dir, sysid, compid, msg_id);
        let (row, last) = {
            let map = self.rows.lock().expect("inspector mutex");
            let e = map.get(&key)?;
            (row(&key, e, now_ms), e.last.clone())
        };
        Some(InspectorDetail {
            row,
            fields: fields_of(&last),
        })
    }
}

fn row(k: &Key, e: &Entry, now_ms: u64) -> InspectorRow {
    let age_ms = now_ms.saturating_sub(e.last_ms);
    // The first window has not closed yet: estimate from what it holds.
    let open_span = now_ms.saturating_sub(e.window_start_ms);
    let rate_hz = if age_ms > 2 * WINDOW_MS {
        0.0
    } else if e.rate_hz == 0.0 && open_span > 0 {
        e.window_count as f32 * 1000.0 / open_span.max(1) as f32
    } else {
        e.rate_hz
    };
    InspectorRow {
        dir: k.0,
        sysid: k.1,
        compid: k.2,
        msg_id: k.3,
        name: e.last.message_name().to_string(),
        count: e.count,
        rate_hz,
        age_ms,
    }
}

/// The message's fields as a JSON object (the serde form is `{"type": NAME, ...fields}`).
fn fields_of(msg: &MavMessage) -> serde_json::Value {
    let mut v = serde_json::to_value(msg).unwrap_or(serde_json::Value::Null);
    if let Some(obj) = v.as_object_mut() {
        obj.remove("type");
    }
    v
}

#[cfg(test)]
mod tests {
    use super::*;
    use mavlink::dialects::ardupilotmega::{MavMessage, HEARTBEAT_DATA, LOG_DATA_DATA};
    use mavlink::MavHeader;
    use rgcs_core::InspectorDir;

    fn hdr(sysid: u8, compid: u8) -> MavHeader {
        MavHeader {
            system_id: sysid,
            component_id: compid,
            sequence: 0,
        }
    }
    fn hb() -> MavMessage {
        MavMessage::HEARTBEAT(HEARTBEAT_DATA::DEFAULT)
    }

    #[test]
    fn rate_and_count_per_key() {
        let ins = Inspector::default();
        for i in 0..20u64 {
            ins.record(InspectorDir::Rx, &hdr(1, 1), &hb(), i * 100); // 10 Hz for 2 s
        }
        ins.record(InspectorDir::Rx, &hdr(1, 100), &hb(), 1_900);
        let rows = ins.rows(2_000);
        assert_eq!(rows.len(), 2);
        let fc = rows.iter().find(|r| r.compid == 1).unwrap();
        assert_eq!((fc.name.as_str(), fc.count, fc.msg_id), ("HEARTBEAT", 20, 0));
        assert!((fc.rate_hz - 10.0).abs() < 1.0, "{}", fc.rate_hz);
        assert_eq!(
            ins.rows(10_000).iter().find(|r| r.compid == 1).unwrap().rate_hz,
            0.0,
            "silent rows decay to 0 Hz"
        );
    }

    #[test]
    fn one_row_per_key_under_a_burst() {
        let ins = Inspector::default();
        let log = MavMessage::LOG_DATA(LOG_DATA_DATA::DEFAULT);
        for i in 0..10_000u64 {
            ins.record(InspectorDir::Rx, &hdr(1, 1), &log, i);
        }
        assert_eq!(ins.rows(10_000).len(), 1);
        assert_eq!(ins.rows(10_000)[0].count, 10_000);
    }

    #[test]
    fn detail_carries_the_last_message_fields() {
        let ins = Inspector::default();
        let msg = MavMessage::HEARTBEAT(HEARTBEAT_DATA {
            custom_mode: 4,
            ..HEARTBEAT_DATA::DEFAULT
        });
        ins.record(InspectorDir::Tx, &hdr(255, 190), &msg, 5);
        let d = ins.detail(InspectorDir::Tx, 255, 190, 0, 10).expect("row");
        assert_eq!(d.row.name, "HEARTBEAT");
        assert_eq!(d.fields["custom_mode"], 4);
        assert!(ins.detail(InspectorDir::Rx, 255, 190, 0, 10).is_none());
    }

    #[test]
    fn rows_are_capped_and_the_least_recently_seen_go_first() {
        let ins = Inspector::default();
        // a spray of forged system / component ids
        for i in 0..(MAX_ROWS as u64 + 500) {
            ins.record(InspectorDir::Rx, &hdr((i % 251) as u8, (i / 251) as u8), &hb(), i);
        }
        let rows = ins.rows(MAX_ROWS as u64 + 500);
        assert_eq!(rows.len(), MAX_ROWS);
        assert!(
            rows.iter().all(|r| !(r.sysid == 0 && r.compid == 0)),
            "the oldest row was evicted"
        );
    }
}
