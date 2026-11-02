//! External-factor (外的要因) types: readings from each source, the fused factor per kind,
//! the summary pushed to the UI (`env_summary` WS frame), source status and thresholds
//! (spec 2026-10-24 §5.3–§5.5).

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Reading priority for display: Measured > Observed > Nowcast > Forecast.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, rename_all = "snake_case")]
pub enum EnvClass {
    Measured,
    Observed,
    Nowcast,
    Forecast,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, rename_all = "snake_case")]
pub enum EnvLevel {
    Ok,
    Warn,
    Strong,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct EnvReading {
    /// Source id (`open_meteo`, `jma_amedas`, `swpc_kp`, …, `vehicle`, `wmm`, `sun`).
    pub source: String,
    pub class: EnvClass,
    pub value: f64,
    #[ts(type = "number")]
    pub at_ms: u64,
    /// Within its class's freshness window; stale readings are shown greyed and not counted.
    pub fresh: bool,
    pub note: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct EnvFactor {
    /// `wind` | `gust` | `precip` | `temp` | `kp` | `declination` | `gnss` | `daylight`.
    pub kind: String,
    pub level: EnvLevel,
    pub unit: String,
    /// The reading that set `level`.
    pub value: Option<EnvReading>,
    /// The freshest reading of the highest class present, shown first.
    pub primary: Option<EnvReading>,
    pub readings: Vec<EnvReading>,
    pub disagree: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct EnvSummary {
    /// The rounded location cell (lat, lon), if any.
    pub cell: Option<(f64, f64)>,
    pub factors: Vec<EnvFactor>,
    /// Enabled sources whose last fetch failed.
    pub missing: Vec<String>,
    /// Every enabled external source lacks a fresh reading (「外的要因: 取得できず」).
    pub unavailable: bool,
    /// SWPC alert notes (untrusted text).
    pub notes: Vec<String>,
    #[ts(type = "number")]
    pub ts: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct EnvSourceStatus {
    pub id: String,
    pub label: String,
    pub enabled: bool,
    pub needs_key: bool,
    pub key_configured: bool,
    /// Last 4 characters only (`"…ab12"`); never the key.
    pub key_hint: Option<String>,
    pub uses_location: bool,
    pub interval_s: u32,
    pub timeout_ms: u32,
    #[ts(type = "number | null")]
    pub last_ok_ms: Option<u64>,
    pub last_error: Option<String>,
    #[ts(type = "number | null")]
    pub next_due_ms: Option<u64>,
    pub terms: String,
}

/// `[warn, strong]` per factor. Sats and hdop: below / at-or-above; sunset: minutes left.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct EnvThresholds {
    pub wind: [f64; 2],
    pub gust: [f64; 2],
    pub precip: [f64; 2],
    pub temp_low: [f64; 2],
    pub temp_high: [f64; 2],
    pub kp: [f64; 2],
    pub declination: [f64; 2],
    pub sats: [f64; 2],
    pub hdop: [f64; 2],
    pub sunset_min: [f64; 2],
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct EnvSettings {
    /// Location rounding step in degrees: 0.01, 0.05 or 0.1.
    pub rounding_deg: f64,
    pub copter: EnvThresholds,
    pub quadplane: EnvThresholds,
    pub plane: EnvThresholds,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classes_and_levels_are_snake_case() {
        assert_eq!(serde_json::to_value(EnvClass::Nowcast).unwrap(), "nowcast");
        assert_eq!(serde_json::to_value(EnvLevel::Strong).unwrap(), "strong");
        assert!(EnvClass::Measured < EnvClass::Forecast && EnvLevel::Warn < EnvLevel::Strong);
    }

    #[test]
    fn summary_cell_is_a_pair_and_times_are_numbers() {
        let reading = EnvReading {
            source: "swpc_kp".into(),
            class: EnvClass::Observed,
            value: 5.33,
            at_ms: 1_761_350_400_000,
            fresh: true,
            note: None,
        };
        let s = EnvSummary {
            cell: Some((36.25, 137.64)),
            factors: vec![EnvFactor {
                kind: "kp".into(),
                level: EnvLevel::Warn,
                unit: "".into(),
                value: Some(reading.clone()),
                primary: Some(reading.clone()),
                readings: vec![reading],
                disagree: false,
            }],
            missing: vec![],
            unavailable: false,
            notes: vec![],
            ts: 1_761_350_401_000,
        };
        let json = serde_json::to_value(&s).unwrap();
        assert_eq!(json["cell"], serde_json::json!([36.25, 137.64]));
        assert_eq!(json["factors"][0]["value"]["class"], "observed");
        assert!(json["factors"][0]["value"]["at_ms"].is_u64());
        let back: EnvSummary = serde_json::from_value(json).unwrap();
        assert_eq!(back, s);
    }
}
