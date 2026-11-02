//! Logbook wire types: vehicle registry, pilot info, inspection
//! templates and runs (様式 2), flights with squawks (様式 1), maintenance records (様式 3)
//! and stored DataFlash logs. Timestamps are unix milliseconds; dates are `YYYY-MM-DD`.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::vehicle::SysId;

/// 無人航空機の概要: the header block of every form, kept on the `vehicles` row.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct VehicleRegistry {
    pub sysid: SysId,
    pub name: String,
    /// 登録記号 (届出番号 when unregistered).
    pub registration: String,
    pub uas_type: String,
    pub model: String,
    pub type_cert_no: String,
    pub airworthiness_class: String,
    pub airworthiness_no: String,
    pub manufacturer: String,
    pub serial_no: String,
    /// 製造後総飛行時間 before RGCS started counting, in minutes.
    pub initial_flight_minutes: u32,
    #[ts(type = "number | null")]
    pub inspection_template_id: Option<i64>,
    /// 飛行可能時間 in minutes (battery estimate in the plan comparison); `None` when not set.
    pub endurance_minutes: Option<u32>,
    /// `initial_flight_minutes` + every landed flight (minutes).
    pub total_flight_minutes: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct VehicleRegistryInput {
    pub name: String,
    pub registration: String,
    pub uas_type: String,
    pub model: String,
    pub type_cert_no: String,
    pub airworthiness_class: String,
    pub airworthiness_no: String,
    pub manufacturer: String,
    pub serial_no: String,
    pub initial_flight_minutes: u32,
    #[ts(type = "number | null")]
    pub inspection_template_id: Option<i64>,
    #[serde(default)]
    pub endurance_minutes: Option<u32>,
}

/// 操縦者: name and 技能証明書番号 of a login user.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PilotInfo {
    pub username: String,
    pub full_name: String,
    pub license_no: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct PilotInput {
    pub full_name: String,
    pub license_no: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct InspectionItem {
    pub label: String,
    pub detail: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct InspectionTemplate {
    #[ts(type = "number")]
    pub id: i64,
    pub name: String,
    pub version: u32,
    pub items: Vec<InspectionItem>,
    #[ts(type = "number")]
    pub updated_at: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct InspectionTemplateInput {
    pub name: String,
    pub items: Vec<InspectionItem>,
}

/// 結果: 正常 / 異常 / 未実施.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, rename_all = "snake_case")]
pub enum InspectionResult {
    Ok,
    Ng,
    Skipped,
}

impl InspectionResult {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Ok => "ok",
            Self::Ng => "ng",
            Self::Skipped => "skipped",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "ok" => Some(Self::Ok),
            "ng" => Some(Self::Ng),
            "skipped" => Some(Self::Skipped),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct InspectionResultInput {
    pub position: u32,
    pub result: InspectionResult,
    pub remark: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct InspectionResultRow {
    pub position: u32,
    pub label: String,
    pub detail: String,
    pub result: InspectionResult,
    pub remark: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct InspectionRunInput {
    #[ts(type = "number")]
    pub template_id: i64,
    pub place: String,
    pub lat: Option<f64>,
    pub lon: Option<f64>,
    pub performed_on: String,
    pub inspector: String,
    pub notes: String,
    pub results: Vec<InspectionResultInput>,
    #[ts(type = "number | null")]
    pub supersedes: Option<i64>,
}

/// One saved inspection (= one 様式 2 record). Immutable; corrections supersede it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct InspectionRun {
    #[ts(type = "number")]
    pub id: i64,
    pub sysid: SysId,
    #[ts(type = "number")]
    pub template_id: i64,
    pub template_name: String,
    pub template_version: u32,
    pub place: String,
    pub lat: Option<f64>,
    pub lon: Option<f64>,
    pub performed_on: String,
    pub inspector: String,
    pub notes: String,
    pub results: Vec<InspectionResultRow>,
    pub has_ng: bool,
    #[ts(type = "number | null")]
    pub supersedes: Option<i64>,
    pub created_by: String,
    #[ts(type = "number")]
    pub created_at: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, rename_all = "snake_case")]
pub enum FlightStatus {
    Draft,
    Confirmed,
}

impl FlightStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Draft => "draft",
            Self::Confirmed => "confirmed",
        }
    }
}

/// 記事 (不具合) attached to a flight.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct FlightSquawk {
    #[ts(type = "number")]
    pub id: i64,
    #[ts(type = "number")]
    pub flight_id: i64,
    pub occurred_on: String,
    pub description: String,
    pub action_on: String,
    pub action: String,
    pub confirmer: String,
    pub created_by: String,
    #[ts(type = "number")]
    pub created_at: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct FlightSquawkInput {
    pub occurred_on: String,
    pub description: String,
    pub action_on: String,
    pub action: String,
    pub confirmer: String,
}

/// One flight (= one 様式 1 row): first ARM … last DISARM, drafted by the server.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Flight {
    #[ts(type = "number")]
    pub id: i64,
    pub sysid: SysId,
    pub status: FlightStatus,
    pub pilot: String,
    pub pilot_license: String,
    #[ts(type = "number")]
    pub takeoff_at: u64,
    #[ts(type = "number | null")]
    pub landed_at: Option<u64>,
    pub takeoff_lat: Option<f64>,
    pub takeoff_lon: Option<f64>,
    pub landing_lat: Option<f64>,
    pub landing_lon: Option<f64>,
    pub takeoff_place: String,
    pub landing_place: String,
    pub purposes: Vec<String>,
    pub specific_flight: Vec<String>,
    pub summary: String,
    pub safety_notes: String,
    /// Minutes, rounded up (0 while the flight is open).
    pub flight_minutes: u32,
    /// Registry initial minutes + every landed flight up to and including this one.
    pub total_minutes: u32,
    pub squawks: Vec<FlightSquawk>,
    #[ts(type = "number | null")]
    pub supersedes: Option<i64>,
    pub created_by: String,
    #[ts(type = "number")]
    pub created_at: u64,
    #[ts(type = "number")]
    pub updated_at: u64,
}

/// Manual flight entry (a flight flown without RGCS connected).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct FlightInput {
    pub pilot: String,
    pub pilot_license: String,
    #[ts(type = "number")]
    pub takeoff_at: u64,
    #[ts(type = "number")]
    pub landed_at: u64,
    pub takeoff_place: String,
    pub landing_place: String,
    pub purposes: Vec<String>,
    pub specific_flight: Vec<String>,
    pub summary: String,
    pub safety_notes: String,
}

/// Partial update of a flight; `status: confirmed` closes the draft.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(default)]
#[ts(export, optional_fields)]
pub struct FlightPatch {
    pub pilot: Option<String>,
    pub pilot_license: Option<String>,
    #[ts(optional, type = "number")]
    pub takeoff_at: Option<u64>,
    #[ts(optional, type = "number")]
    pub landed_at: Option<u64>,
    pub takeoff_place: Option<String>,
    pub landing_place: Option<String>,
    pub purposes: Option<Vec<String>>,
    pub specific_flight: Option<Vec<String>>,
    pub summary: Option<String>,
    pub safety_notes: Option<String>,
    pub status: Option<FlightStatus>,
}

/// 点検整備記録 (様式 3) row.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct MaintenanceRecord {
    #[ts(type = "number")]
    pub id: i64,
    pub sysid: SysId,
    pub performed_on: String,
    /// 総飛行時間 at the time of the work (snapshot).
    pub total_minutes: u32,
    pub detail: String,
    pub reason: String,
    pub place: String,
    pub engineer: String,
    pub notes: String,
    #[ts(type = "number | null")]
    pub supersedes: Option<i64>,
    pub created_by: String,
    #[ts(type = "number")]
    pub created_at: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct MaintenanceInput {
    pub performed_on: String,
    pub detail: String,
    pub reason: String,
    pub place: String,
    pub engineer: String,
    pub notes: String,
    #[ts(type = "number | null")]
    pub supersedes: Option<i64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, rename_all = "snake_case")]
pub enum LogSource {
    Mavlink,
    Upload,
}

impl LogSource {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Mavlink => "mavlink",
            Self::Upload => "upload",
        }
    }
}

/// A DataFlash `.bin` kept under `data_dir/logs/<sysid>/`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct FlightLog {
    #[ts(type = "number")]
    pub id: i64,
    pub sysid: SysId,
    #[ts(type = "number | null")]
    pub flight_id: Option<i64>,
    pub fc_log_id: Option<u32>,
    pub filename: String,
    #[ts(type = "number")]
    pub size: u64,
    pub source: LogSource,
    #[ts(type = "number")]
    pub fetched_at: u64,
    pub created_by: String,
}

/// One LOG_ENTRY from the flight controller.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct FcLogEntry {
    pub id: u32,
    pub time_utc: u32,
    pub size: u32,
}

/// `log_fetch_progress` payload.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct LogFetchProgress {
    pub fc_log_id: u32,
    #[ts(type = "number")]
    pub received: u64,
    #[ts(type = "number")]
    pub total: u64,
    pub done: bool,
    pub error: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn enums_use_snake_case_on_the_wire() {
        assert_eq!(serde_json::to_string(&InspectionResult::Ng).unwrap(), "\"ng\"");
        assert_eq!(
            serde_json::to_string(&FlightStatus::Confirmed).unwrap(),
            "\"confirmed\""
        );
        assert_eq!(serde_json::to_string(&LogSource::Mavlink).unwrap(), "\"mavlink\"");
        assert_eq!(
            InspectionResult::parse("skipped"),
            Some(InspectionResult::Skipped)
        );
    }

    #[test]
    fn flight_patch_fields_default_to_none() {
        let p: FlightPatch = serde_json::from_str(r#"{"summary":"x"}"#).unwrap();
        assert_eq!(p.summary.as_deref(), Some("x"));
        assert!(p.status.is_none() && p.takeoff_at.is_none());
    }
}
