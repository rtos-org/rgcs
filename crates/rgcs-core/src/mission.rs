//! Mission planning types: the saved mission, its items, the
//! validation findings and the progress frame. Pure data + rules; no MAVLink here.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::vehicle::{SysId, VehicleKind};

pub const MAV_CMD_NAV_WAYPOINT: u16 = 16;
pub const MAV_CMD_NAV_LOITER_UNLIM: u16 = 17;
pub const MAV_CMD_NAV_LOITER_TURNS: u16 = 18;
pub const MAV_CMD_NAV_LOITER_TIME: u16 = 19;
pub const MAV_CMD_NAV_RETURN_TO_LAUNCH: u16 = 20;
pub const MAV_CMD_NAV_LAND: u16 = 21;
pub const MAV_CMD_NAV_TAKEOFF: u16 = 22;
pub const MAV_CMD_NAV_SPLINE_WAYPOINT: u16 = 82;
/// Copter 4.7+: the leg into this item is a circular arc of `param1` degrees (+ clockwise).
pub const MAV_CMD_NAV_LOITER_TO_ALT: u16 = 31;
pub const MAV_CMD_NAV_VTOL_TAKEOFF: u16 = 84;
pub const MAV_CMD_NAV_VTOL_LAND: u16 = 85;
pub const MAV_CMD_NAV_ARC_WAYPOINT: u16 = 36;
pub const MAV_CMD_NAV_DELAY: u16 = 93;
pub const MAV_CMD_CONDITION_DELAY: u16 = 112;
pub const MAV_CMD_DO_JUMP: u16 = 177;
pub const MAV_CMD_DO_SET_ROI: u16 = 201;

/// Flights longer than this (estimated) get a `long_flight` warning: a stand-in for a battery
/// model the project does not have yet.
pub const LONG_FLIGHT_S: f64 = 1_200.0;
const EARTH_RADIUS_M: f64 = 6_371_000.0;

/// Altitude reference (memory: Rel / Abs / Ter combo precedes every altitude input).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, rename_all = "lowercase")]
pub enum MissionFrame {
    Rel,
    Abs,
    Ter,
}

impl MissionFrame {
    /// `MAV_FRAME_GLOBAL_RELATIVE_ALT` / `MAV_FRAME_GLOBAL` / `MAV_FRAME_GLOBAL_TERRAIN_ALT`.
    pub fn mav(self) -> u8 {
        match self {
            Self::Rel => 3,
            Self::Abs => 0,
            Self::Ter => 10,
        }
    }

    pub fn from_mav(id: u8) -> Option<Self> {
        match id {
            3 => Some(Self::Rel),
            0 => Some(Self::Abs),
            10 => Some(Self::Ter),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct MissionItem {
    /// MAV_CMD id (16 = NAV_WAYPOINT, 22 = NAV_TAKEOFF, …).
    pub command: u16,
    pub frame: MissionFrame,
    pub params: [f32; 4],
    pub lat: f64,
    pub lon: f64,
    pub alt: f32,
    pub autocontinue: bool,
}

impl MissionItem {
    /// NAV commands that carry a position the vehicle flies to.
    pub fn is_positional(&self) -> bool {
        matches!(
            self.command,
            16..=22
                | MAV_CMD_NAV_LOITER_TO_ALT
                | MAV_CMD_NAV_ARC_WAYPOINT
                | MAV_CMD_NAV_SPLINE_WAYPOINT
                | MAV_CMD_NAV_VTOL_TAKEOFF
                | MAV_CMD_NAV_VTOL_LAND
                | MAV_CMD_DO_SET_ROI
        )
    }

    /// A positional command that actually carries a position (RTL / LAND without one do not).
    pub fn has_position(&self) -> bool {
        self.is_positional() && !(self.lat == 0.0 && self.lon == 0.0)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Home {
    pub lat: f64,
    pub lon: f64,
    pub alt: f32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Mission {
    #[ts(type = "number | null")]
    pub id: Option<i64>,
    pub name: String,
    pub sysid: Option<SysId>,
    pub default_alt: f32,
    pub default_frame: MissionFrame,
    /// Planned ground speed (m/s) for the time estimate.
    pub speed: f32,
    pub home: Option<Home>,
    pub items: Vec<MissionItem>,
    /// Geofence zones planned with the mission (written separately: `PUT .../fence`).
    #[serde(default)]
    pub fence: Vec<crate::geofence::FenceZone>,
    /// Rally points planned with the mission (written separately: `PUT .../rally`).
    #[serde(default)]
    pub rally: Vec<crate::geofence::RallyPoint>,
    /// Survey-grid blocks: item ranges generated from a survey spec.
    #[serde(default)]
    pub surveys: Vec<SurveyBlock>,
}

/// A run of `count` items starting at `first` (0-based) that a survey grid generated.
/// `spec` is the editor's survey definition, opaque to the server.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct SurveyBlock {
    pub id: String,
    pub first: u32,
    pub count: u32,
    #[ts(type = "unknown")]
    pub spec: serde_json::Value,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct MissionSummaryRow {
    #[ts(type = "number")]
    pub id: i64,
    pub name: String,
    pub sysid: Option<SysId>,
    pub item_count: u32,
    #[ts(type = "number")]
    pub updated_at: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, rename_all = "lowercase")]
pub enum FindingLevel {
    Fatal,
    Warn,
}

/// One validation result; `code` is the contract the UI translates.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Finding {
    pub level: FindingLevel,
    pub code: String,
    /// 1-based mission sequence of the offending item, when there is one.
    pub seq: Option<u16>,
    pub message: String,
    /// `param_ignored` only: the param that ArduPilot would not keep as sent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub param: Option<StoredParam>,
}

/// A mission item field as sent and as ArduPilot would store it.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct StoredParam {
    /// MAVLink param index: 1–4 are params, 5 / 6 / 7 are x / y / z.
    pub index: u8,
    pub sent: f32,
    pub stored: f32,
}

impl Finding {
    pub(crate) fn fatal(code: &str, seq: Option<u16>, message: impl Into<String>) -> Self {
        Self {
            level: FindingLevel::Fatal,
            code: code.into(),
            seq,
            message: message.into(),
            param: None,
        }
    }

    pub(crate) fn warn(code: &str, seq: Option<u16>, message: impl Into<String>) -> Self {
        Self {
            level: FindingLevel::Warn,
            code: code.into(),
            seq,
            message: message.into(),
            param: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct MissionStats {
    pub distance_m: f64,
    pub duration_s: f64,
    pub max_alt: f32,
}

/// `MISSION_CURRENT` as the UI sees it; `total` once the server knows the vehicle's mission.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct MissionProgress {
    pub seq: u16,
    pub total: Option<u16>,
}

/// Stage of a mission write (`mission_transfer` frames): items sent, then read back for the check.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum TransferPhase {
    Write,
    Verify,
    Done,
    Failed,
}

/// Progress of a mission write: `done` of `total` frames (items + home) in the current phase.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct MissionTransfer {
    pub phase: TransferPhase,
    pub done: u16,
    pub total: u16,
}

/// Result of `PUT /api/vehicles/{sysid}/mission`: what was written and whether the read-back matched.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct UploadReport {
    pub items: u32,
    pub verified: bool,
    /// 1-based sequences whose read-back differed.
    pub mismatched: Vec<u16>,
    pub findings: Vec<Finding>,
}

/// Geofence parameters as far as they are known (`FENCE_ENABLE`, `FENCE_ALT_MAX`, `FENCE_RADIUS`).
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct FenceInfo {
    pub enabled: Option<bool>,
    pub alt_max: Option<f32>,
    pub radius: Option<f32>,
}

/// Metres flown into `it` from (`lat`, `lon`): along the arc for an ARC_WAYPOINT
/// (r = chord / (2·|sin(θ/2)|), length r·θ; under 1° it is straight, as ArduPilot flies it).
pub fn leg_distance_m(lat: f64, lon: f64, it: &MissionItem) -> f64 {
    let chord = haversine_m(lat, lon, it.lat, it.lon);
    let theta = f64::from(it.params[0].abs().min(359.0)).to_radians();
    if it.command != MAV_CMD_NAV_ARC_WAYPOINT || theta < 1f64.to_radians() || chord == 0.0 {
        return chord;
    }
    chord / (2.0 * (theta / 2.0).sin().abs()) * theta
}

/// One item of [`Mission::for_vehicle`].
fn vehicle_item(it: &MissionItem) -> MissionItem {
    match it.command {
        MAV_CMD_NAV_ARC_WAYPOINT => {
            let [angle, p2, p3, p4] = it.params;
            MissionItem {
                params: [angle.round(), p2, p3, p4],
                ..it.clone()
            }
        }
        _ => it.clone(),
    }
}

pub fn haversine_m(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
    let (p1, p2) = (lat1.to_radians(), lat2.to_radians());
    let dp = p2 - p1;
    let dl = (lon2 - lon1).to_radians();
    let a = (dp / 2.0).sin().powi(2) + p1.cos() * p2.cos() * (dl / 2.0).sin().powi(2);
    2.0 * EARTH_RADIUS_M * a.sqrt().asin()
}

impl Mission {
    /// The mission as the flight controller will store it, so the read-back matches what was
    /// sent: ArduPilot keeps an ARC_WAYPOINT angle as whole degrees (uint16 magnitude + a
    /// direction flag), so 45.5 is sent as 46 rather than read back as 45.
    pub fn for_vehicle(&self) -> Mission {
        Mission {
            items: self.items.iter().map(vehicle_item).collect(),
            ..self.clone()
        }
    }

    pub fn has_fatal(findings: &[Finding]) -> bool {
        findings.iter().any(|f| f.level == FindingLevel::Fatal)
    }

    /// Pre-upload checks; fatal findings refuse the upload.
    pub fn validate(&self, fence: &FenceInfo) -> Vec<Finding> {
        self.validate_for(fence, None)
    }

    /// [`Mission::validate`] for a known airframe: a rover drives from its first waypoint, so it
    /// needs no takeoff and may end on a waypoint (unknown airframes are checked as flying).
    pub fn validate_for(&self, fence: &FenceInfo, kind: Option<VehicleKind>) -> Vec<Finding> {
        let mut out = Vec::new();
        if self.items.is_empty() {
            out.push(Finding::fatal("empty", None, "mission has no items"));
            return out;
        }
        let ground = kind == Some(VehicleKind::Rover);
        if !ground
            && !matches!(
                self.items[0].command,
                MAV_CMD_NAV_TAKEOFF | MAV_CMD_NAV_VTOL_TAKEOFF
            )
        {
            out.push(Finding::fatal(
                "first_not_takeoff",
                Some(1),
                "the first item must be NAV_TAKEOFF or NAV_VTOL_TAKEOFF",
            ));
        }
        out.extend(self.fence_findings(fence));
        out.extend(
            self.structure_findings()
                .into_iter()
                .filter(|f| !(ground && f.code == "no_land_or_rtl")),
        );
        out.extend(self.survey_findings());
        let sent: Vec<MissionItem> = self.items.iter().map(vehicle_item).collect();
        out.extend(crate::mission_stored::ignored_param_findings(&sent, kind));
        if self.stats().duration_s > LONG_FLIGHT_S {
            out.push(Finding::warn(
                "long_flight",
                None,
                "estimated flight time exceeds 20 minutes",
            ));
        }
        out
    }

    fn fence_findings(&self, fence: &FenceInfo) -> Vec<Finding> {
        let mut out = Vec::new();
        match fence.enabled {
            None => {
                out.push(Finding::warn(
                    "fence_unknown",
                    None,
                    "fence parameters not read yet",
                ));
                return out;
            }
            Some(false) => return out,
            Some(true) => {}
        }
        match fence.alt_max {
            None => out.push(Finding::warn("fence_unknown", None, "FENCE_ALT_MAX not read yet")),
            Some(max) => out.extend(self.alt_findings(max)),
        }
        if let Some(radius) = fence.radius {
            out.extend(self.radius_findings(radius));
        }
        out
    }

    fn alt_findings(&self, max: f32) -> Vec<Finding> {
        let mut out = Vec::new();
        for (i, it) in self.items.iter().enumerate().filter(|(_, it)| it.has_position()) {
            let seq = Some((i + 1) as u16);
            match it.frame {
                MissionFrame::Rel if it.alt > max => out.push(Finding::fatal(
                    "fence_alt",
                    seq,
                    format!("altitude {} m exceeds FENCE_ALT_MAX {} m", it.alt, max),
                )),
                MissionFrame::Rel => {}
                _ => out.push(Finding::warn(
                    "fence_frame_unchecked",
                    seq,
                    "non-relative altitude is not compared with the fence",
                )),
            }
        }
        out
    }

    fn radius_findings(&self, radius: f32) -> Vec<Finding> {
        let centre = match &self.home {
            Some(h) => Some((h.lat, h.lon)),
            None => self
                .items
                .iter()
                .find(|it| it.has_position())
                .map(|it| (it.lat, it.lon)),
        };
        let Some((clat, clon)) = centre else {
            return Vec::new();
        };
        self.items
            .iter()
            .enumerate()
            .filter(|(_, it)| it.has_position())
            .filter(|(_, it)| haversine_m(clat, clon, it.lat, it.lon) > radius as f64)
            .map(|(i, _)| {
                Finding::fatal(
                    "fence_radius",
                    Some((i + 1) as u16),
                    format!("outside FENCE_RADIUS {radius} m"),
                )
            })
            .collect()
    }

    fn survey_findings(&self) -> Vec<Finding> {
        let n = self.items.len() as u64;
        let mut out = Vec::new();
        let mut ranges: Vec<(u64, u64)> = Vec::new();
        for sv in &self.surveys {
            let (first, end) = (u64::from(sv.first), u64::from(sv.first) + u64::from(sv.count));
            if sv.count == 0 || end > n {
                out.push(Finding::fatal(
                    "survey_range",
                    Some(sv.first.saturating_add(1).min(u32::from(u16::MAX)) as u16),
                    "survey range is empty or outside the mission items",
                ));
            } else if ranges.iter().any(|&(a, b)| first < b && a < end) {
                out.push(Finding::fatal(
                    "survey_range",
                    Some((sv.first + 1).min(u32::from(u16::MAX)) as u16),
                    "survey ranges overlap",
                ));
            }
            ranges.push((first, end));
        }
        out
    }

    fn structure_findings(&self) -> Vec<Finding> {
        let mut out = Vec::new();
        let n = self.items.len();
        let mut frames: Vec<MissionFrame> = Vec::new();
        for (i, it) in self.items.iter().enumerate() {
            let seq = Some((i + 1) as u16);
            if it.command == MAV_CMD_DO_JUMP {
                let target = it.params[0];
                if target < 1.0 || target > n as f32 {
                    out.push(Finding::fatal(
                        "jump_target",
                        seq,
                        format!("DO_JUMP target {target} is not an item"),
                    ));
                }
            }
            if it.has_position() {
                if !frames.contains(&it.frame) {
                    frames.push(it.frame);
                }
                if it.frame == MissionFrame::Ter {
                    out.push(Finding::warn(
                        "terrain_frame",
                        seq,
                        "terrain altitude needs terrain data on the vehicle",
                    ));
                }
            } else if it.is_positional()
                && !matches!(
                    it.command,
                    MAV_CMD_NAV_RETURN_TO_LAUNCH
                        | MAV_CMD_NAV_LAND
                        | MAV_CMD_NAV_TAKEOFF
                        | MAV_CMD_NAV_VTOL_TAKEOFF
                        | MAV_CMD_NAV_VTOL_LAND
                )
            {
                out.push(Finding::warn("zero_position", seq, "item has no position"));
            }
        }
        if frames.len() > 1 {
            out.push(Finding::warn(
                "mixed_frames",
                None,
                "items use more than one altitude frame",
            ));
        }
        if let Some(last) = self.items.last() {
            if !matches!(
                last.command,
                MAV_CMD_NAV_LAND | MAV_CMD_NAV_VTOL_LAND | MAV_CMD_NAV_RETURN_TO_LAUNCH
            ) {
                out.push(Finding::warn(
                    "no_land_or_rtl",
                    Some(n as u16),
                    "mission does not end with LAND or RTL",
                ));
            }
        }
        out
    }

    /// Total path length, time estimate (distance / speed + explicit waits) and the highest altitude.
    pub fn stats(&self) -> MissionStats {
        let mut distance = 0.0;
        let mut prev: Option<(f64, f64)> = self.home.as_ref().map(|h| (h.lat, h.lon));
        let mut max_alt: f32 = 0.0;
        let mut waits = 0.0f64;
        for it in &self.items {
            if it.has_position() {
                if let Some((plat, plon)) = prev {
                    distance += leg_distance_m(plat, plon, it);
                }
                prev = Some((it.lat, it.lon));
                max_alt = max_alt.max(it.alt);
            }
            waits += match it.command {
                MAV_CMD_NAV_WAYPOINT | MAV_CMD_NAV_LOITER_TIME | MAV_CMD_CONDITION_DELAY => {
                    it.params[0].max(0.0) as f64
                }
                MAV_CMD_NAV_DELAY if it.params[0] >= 0.0 => it.params[0] as f64,
                _ => 0.0,
            };
        }
        MissionStats {
            distance_m: distance,
            duration_s: distance / (self.speed.max(0.1) as f64) + waits,
            max_alt,
        }
    }
}

/// The 20-item demo mission around the SITL home (also the `.waypoints` golden fixture).
pub fn demo20() -> Mission {
    let (lat0, lon0): (f64, f64) = (35.481883, 138.48029);
    let dlat = 400.0 / 111_320.0 / 4.0; // 4 rows across 400 m north
    let dlon = 1000.0 / (111_320.0 * lat0.to_radians().cos()); // 1 km east
    let item = |command: u16, lat: f64, lon: f64, alt: f32| MissionItem {
        command,
        frame: MissionFrame::Rel,
        params: [0.0; 4],
        lat,
        lon,
        alt,
        autocontinue: true,
    };
    let mut items = vec![item(MAV_CMD_NAV_TAKEOFF, lat0, lon0, 30.0)];
    for i in 0..18u32 {
        let row = i / 2;
        let east = (i % 2 == 0) == (row % 2 == 0);
        let lat = lat0 + dlat * (row as f64 + 1.0);
        let lon = if east { lon0 + dlon } else { lon0 };
        let alt = if row % 2 == 0 { 60.0 } else { 80.0 };
        items.push(item(MAV_CMD_NAV_WAYPOINT, lat, lon, alt));
    }
    items.push(item(MAV_CMD_NAV_RETURN_TO_LAUNCH, 0.0, 0.0, 0.0));
    Mission {
        id: None,
        name: "demo20".into(),
        sysid: None,
        default_alt: 60.0,
        default_frame: MissionFrame::Rel,
        speed: 8.0,
        home: Some(Home {
            lat: lat0,
            lon: lon0,
            alt: 0.0,
        }),
        items,
        fence: Vec::new(),
        rally: Vec::new(),
        surveys: Vec::new(),
    }
}

#[cfg(test)]
#[path = "mission_tests.rs"]
mod tests;
