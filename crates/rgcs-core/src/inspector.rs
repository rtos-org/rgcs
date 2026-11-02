//! MAVLink inspector rows (user request 2026-10-19; `GET /api/mavlink/inspector`).

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Received from the link, or sent by RGCS.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, rename_all = "snake_case")]
pub enum InspectorDir {
    Rx,
    Tx,
}

/// One (direction, system, component, message) seen on the link.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct InspectorRow {
    pub dir: InspectorDir,
    pub sysid: u8,
    pub compid: u8,
    pub msg_id: u32,
    pub name: String,
    #[ts(type = "number")]
    pub count: u64,
    pub rate_hz: f32,
    /// Milliseconds since the last frame.
    #[ts(type = "number")]
    pub age_ms: u64,
}

/// A row plus the fields of its last message.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct InspectorDetail {
    pub row: InspectorRow,
    #[ts(type = "Record<string, unknown>")]
    pub fields: serde_json::Value,
}
