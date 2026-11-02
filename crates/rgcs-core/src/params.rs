//! Parameter wire types: cache entries, download progress, change sets,
//! verified write results and the `param_history` rows.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::vehicle::SysId;

/// One cached parameter as last reported by the vehicle.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ParamEntry {
    pub name: String,
    pub value: f32,
    /// Position in the vehicle's full list (`PARAM_VALUE.param_index`).
    pub index: u16,
    /// `MAV_PARAM_TYPE` number (0 = unknown), echoed in PARAM_SET.
    pub ptype: u8,
}

/// Progress of the full download (`received / total`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ParamProgress {
    pub received: u32,
    pub total: Option<u32>,
    pub complete: bool,
    /// A list request is in flight (gap completion still running).
    pub downloading: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ParamChange {
    pub name: String,
    pub value: f32,
}

/// Outcome of one PARAM_SET: the echoed value and whether it matched the request.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ParamWriteResult {
    pub name: String,
    pub requested: f32,
    pub actual: Option<f32>,
    pub verified: bool,
    /// Why it is unverified: `no_echo`, `mismatch`, `vehicle_armed` (aborted, never sent), `link_lost`.
    pub reason: Option<String>,
}

/// A `param_history` row.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ParamHistoryEntry {
    #[ts(type = "number")]
    pub id: i64,
    /// ISO-8601 wall time written by the store.
    pub ts: String,
    pub operator: String,
    pub sysid: SysId,
    pub name: String,
    pub old_value: Option<f32>,
    pub new_value: f32,
    pub verified: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wire_shapes_match_the_api() {
        let e: ParamEntry =
            serde_json::from_str(r#"{"name":"FENCE_ALT_MAX","value":120.0,"index":7,"ptype":9}"#).unwrap();
        assert_eq!(e.index, 7);
        let p = ParamProgress {
            received: 10,
            total: Some(1200),
            complete: false,
            downloading: true,
        };
        assert_eq!(serde_json::to_value(p).unwrap()["total"], 1200);
        let r = ParamWriteResult {
            name: "X".into(),
            requested: 1.0,
            actual: None,
            verified: false,
            reason: Some("no_echo".into()),
        };
        assert_eq!(
            serde_json::to_value(&r).unwrap()["actual"],
            serde_json::Value::Null
        );
        let c: Vec<ParamChange> = serde_json::from_str(r#"[{"name":"A","value":2}]"#).unwrap();
        assert_eq!(c[0].value, 2.0);
    }
}
