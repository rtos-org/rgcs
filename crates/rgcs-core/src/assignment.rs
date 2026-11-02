//! Plan assignment per vehicle (plan assignment board). Timestamps and plan
//! versions (`missions.updated_at`) are unix milliseconds.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::vehicle::SysId;

/// The last saved plan written to a vehicle and verified.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Written {
    #[ts(type = "number")]
    pub plan_id: i64,
    /// The plan's `updated_at` when it was written: its version.
    #[ts(type = "number")]
    pub plan_updated_at: u64,
    #[ts(type = "number")]
    pub at: u64,
    pub by: String,
}

/// One vehicle's assigned plan and what was last written to it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Assignment {
    pub sysid: SysId,
    /// `None` when unassigned or the plan was deleted.
    #[ts(type = "number | null")]
    pub plan_id: Option<i64>,
    pub assigned_by: Option<String>,
    #[ts(type = "number | null")]
    pub assigned_at: Option<u64>,
    pub written: Option<Written>,
}
