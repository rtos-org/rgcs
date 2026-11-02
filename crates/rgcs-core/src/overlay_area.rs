//! Plugin overlay areas: the rectangles whose tiles the
//! server fetched for an `area` overlay. Times are unix milliseconds.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Where an area's fetch stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum AreaStatus {
    /// Never fetched, or a fetch was interrupted before any tile arrived.
    Idle,
    Fetching,
    /// Every tile arrived.
    Ready,
    /// Some tiles failed.
    Partial,
    /// Every tile failed.
    Failed,
}

impl AreaStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Idle => "idle",
            Self::Fetching => "fetching",
            Self::Ready => "ready",
            Self::Partial => "partial",
            Self::Failed => "failed",
        }
    }

    /// Unknown text reads as `Idle`.
    pub fn parse(s: &str) -> Self {
        match s {
            "fetching" => Self::Fetching,
            "ready" => Self::Ready,
            "partial" => Self::Partial,
            "failed" => Self::Failed,
            _ => Self::Idle,
        }
    }
}

/// One named rectangle and its fetch counters (polled by the UI while fetching).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct OverlayArea {
    #[ts(type = "number")]
    pub id: i64,
    pub plugin_id: String,
    pub overlay_id: String,
    pub name: String,
    pub south: f64,
    pub west: f64,
    pub north: f64,
    pub east: f64,
    pub status: AreaStatus,
    #[ts(type = "number")]
    pub tiles_total: u64,
    #[ts(type = "number")]
    pub tiles_ok: u64,
    #[ts(type = "number")]
    pub tiles_failed: u64,
    /// When the last fetch completed.
    #[ts(type = "number | null")]
    pub fetched_at: Option<u64>,
    /// The newest `Last-Modified` the tiles carried (the source's data date).
    #[ts(type = "number | null")]
    pub data_modified: Option<u64>,
    /// Short error code of the last failed tile (`http_404`, `timeout`, …).
    pub last_error: Option<String>,
    #[ts(type = "number")]
    pub created_at: u64,
}

/// `POST …/areas/estimate` answer: the tiles a rectangle needs over the overlay's zooms.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TileEstimate {
    #[ts(type = "number")]
    pub tiles: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_is_lowercase_and_area_round_trips() {
        assert_eq!(
            serde_json::to_string(&AreaStatus::Partial).unwrap(),
            "\"partial\""
        );
        let area = OverlayArea {
            id: 3,
            plugin_id: "docomo-lte".into(),
            overlay_id: "lte".into(),
            name: "那智勝浦".into(),
            south: 33.6,
            west: 135.85,
            north: 33.7,
            east: 135.95,
            status: AreaStatus::Fetching,
            tiles_total: 120,
            tiles_ok: 10,
            tiles_failed: 1,
            fetched_at: None,
            data_modified: Some(1_790_000_000_000),
            last_error: Some("http_404".into()),
            created_at: 1_790_000_000_001,
        };
        let v = serde_json::to_value(&area).unwrap();
        assert_eq!(v["status"], "fetching");
        assert!(v["fetched_at"].is_null());
        let back: OverlayArea = serde_json::from_value(v).unwrap();
        assert_eq!(back, area);
        let est = serde_json::to_value(TileEstimate { tiles: 42 }).unwrap();
        assert_eq!(est, serde_json::json!({ "tiles": 42 }));
    }
}
