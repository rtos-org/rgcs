//! Vehicle state as seen by the UI, and the 10 Hz diff sent over the WebSocket.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// MAVLink system id of a vehicle.
pub type SysId = u8;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, rename_all = "snake_case")]
pub enum VehicleKind {
    Copter,
    Rover,
    Plane,
    Other,
}

/// Link health derived from the age of the last HEARTBEAT (3 s, 10 s).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, rename_all = "snake_case")]
pub enum LinkStatus {
    Ok,
    Delay,
    Lost,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Battery {
    /// Remaining capacity 0–100, `None` when the autopilot does not report it.
    pub pct: Option<u8>,
    pub volt: f32,
    pub current: Option<f32>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Gps {
    pub fix: u8,
    pub sats: u8,
    pub hdop: Option<f32>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct VehicleState {
    pub sysid: SysId,
    pub name: String,
    pub kind: VehicleKind,
    /// ArduPilot flight mode name (`AUTO`, `RTL`, …); `GROUND` is a UI label, not a mode.
    pub mode: String,
    pub armed: bool,
    pub lat: f64,
    pub lon: f64,
    pub alt_rel: f32,
    pub alt_msl: f32,
    /// Heading in degrees, `None` while the compass is not valid.
    pub hdg: Option<f32>,
    pub ground_speed: f32,
    pub climb: f32,
    pub battery: Battery,
    pub link: LinkStatus,
    /// Milliseconds since the last message from this vehicle.
    #[ts(type = "number")]
    pub last_rx_ms: u64,
    pub gps: Gps,
    pub warn: bool,
    pub unread: u32,
    /// Course over ground (deg, from GLOBAL_POSITION_INT vx/vy), `None` below 0.5 m/s.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub cog: Option<f32>,
    /// NAV_CONTROLLER_OUTPUT: where the autopilot is heading and how far it is.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub nav: Option<NavInfo>,
    /// POSITION_TARGET_GLOBAL_INT: the position the autopilot is steering to (GUIDED).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub target: Option<GeoPoint>,
    /// HOME_POSITION.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub home: Option<GeoPoint>,
    /// ATTITUDE roll / pitch (degrees, 0.1° steps), for the 3D model.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub attitude: Option<Attitude>,
    /// A plane that also hovers (QuadPlane, tiltrotor, tailsitter): EXTENDED_SYS_STATE.vtol_state
    /// or a VTOL MAV_TYPE. Picks the 3D model; omitted while false.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    #[ts(as = "Option<bool>", optional)]
    pub vtol: bool,
}

/// Roll (right wing down positive) and pitch (nose up positive), degrees.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct Attitude {
    pub roll: f32,
    pub pitch: f32,
}

/// A WGS84 point (alt in metres; MSL for home, frame-dependent for targets).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct GeoPoint {
    pub lat: f64,
    pub lon: f64,
    pub alt: f32,
}

/// Navigation controller output (bearing 0–360° to the current target, distance in metres).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct NavInfo {
    pub target_bearing: f32,
    pub wp_dist: u32,
}

impl VehicleState {
    /// A vehicle that has just been discovered: everything unknown, link assumed healthy.
    pub fn new(sysid: SysId, name: impl Into<String>) -> Self {
        Self {
            sysid,
            name: name.into(),
            kind: VehicleKind::Other,
            mode: String::new(),
            armed: false,
            lat: 0.0,
            lon: 0.0,
            alt_rel: 0.0,
            alt_msl: 0.0,
            hdg: None,
            ground_speed: 0.0,
            climb: 0.0,
            battery: Battery {
                pct: None,
                volt: 0.0,
                current: None,
            },
            link: LinkStatus::Ok,
            last_rx_ms: 0,
            gps: Gps {
                fix: 0,
                sats: 0,
                hdop: None,
            },
            warn: false,
            unread: 0,
            cog: None,
            nav: None,
            target: None,
            home: None,
            attitude: None,
            vtol: false,
        }
    }
}

/// Row of the vehicle list / `GET /api/vehicles`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct VehicleSummary {
    pub sysid: SysId,
    pub name: String,
    pub kind: VehicleKind,
    pub mode: String,
    pub armed: bool,
    pub link: LinkStatus,
    #[ts(type = "number")]
    pub last_rx_ms: u64,
}

impl From<&VehicleState> for VehicleSummary {
    fn from(v: &VehicleState) -> Self {
        Self {
            sysid: v.sysid,
            name: v.name.clone(),
            kind: v.kind,
            mode: v.mode.clone(),
            armed: v.armed,
            link: v.link,
            last_rx_ms: v.last_rx_ms,
        }
    }
}

/// Fields of [`VehicleState`] that changed since the previous WebSocket frame.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[serde(default)]
#[ts(export, optional_fields)]
pub struct VehicleStateDiff {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub kind: Option<VehicleKind>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub armed: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lat: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lon: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alt_rel: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alt_msl: Option<f32>,
    /// `Some(None)` means the heading became unknown.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hdg: Option<Option<f32>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ground_speed: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub climb: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub battery: Option<Battery>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub link: Option<LinkStatus>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(type = "number", optional)]
    pub last_rx_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub gps: Option<Gps>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub warn: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub unread: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cog: Option<Option<f32>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub nav: Option<Option<NavInfo>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target: Option<Option<GeoPoint>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub home: Option<Option<GeoPoint>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attitude: Option<Option<Attitude>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vtol: Option<bool>,
}

macro_rules! changed {
    ($prev:expr, $next:expr, $($field:ident),+ $(,)?) => {
        VehicleStateDiff {
            $( $field: ($prev.$field != $next.$field).then(|| $next.$field.clone()), )+
        }
    };
}

impl VehicleStateDiff {
    /// Every field, for a vehicle the client has not seen yet.
    pub fn full(s: &VehicleState) -> Self {
        Self {
            name: Some(s.name.clone()),
            kind: Some(s.kind),
            mode: Some(s.mode.clone()),
            armed: Some(s.armed),
            lat: Some(s.lat),
            lon: Some(s.lon),
            alt_rel: Some(s.alt_rel),
            alt_msl: Some(s.alt_msl),
            hdg: Some(s.hdg),
            ground_speed: Some(s.ground_speed),
            climb: Some(s.climb),
            battery: Some(s.battery),
            link: Some(s.link),
            last_rx_ms: Some(s.last_rx_ms),
            gps: Some(s.gps),
            warn: Some(s.warn),
            unread: Some(s.unread),
            cog: Some(s.cog),
            nav: Some(s.nav),
            target: Some(s.target),
            home: Some(s.home),
            attitude: Some(s.attitude),
            vtol: Some(s.vtol),
        }
    }
}

/// Diff between two states; `None` when nothing changed.
pub fn diff(prev: &VehicleState, next: &VehicleState) -> Option<VehicleStateDiff> {
    let d = changed!(
        prev,
        next,
        name,
        kind,
        mode,
        armed,
        lat,
        lon,
        alt_rel,
        alt_msl,
        hdg,
        ground_speed,
        climb,
        battery,
        link,
        last_rx_ms,
        gps,
        warn,
        unread,
        cog,
        nav,
        target,
        home,
        attitude,
        vtol
    );
    (d != VehicleStateDiff::default()).then_some(d)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base() -> VehicleState {
        VehicleState::new(1, "UAV-01")
    }

    #[test]
    fn attitude_changes_are_sent_and_start_unknown() {
        assert_eq!(base().attitude, None);
        let next = VehicleState {
            attitude: Some(Attitude {
                roll: 12.5,
                pitch: -3.0,
            }),
            ..base()
        };
        let d = diff(&base(), &next).expect("changed");
        assert_eq!(
            d.attitude,
            Some(Some(Attitude {
                roll: 12.5,
                pitch: -3.0
            }))
        );
        assert_eq!(
            VehicleStateDiff::full(&next).attitude,
            Some(Some(Attitude {
                roll: 12.5,
                pitch: -3.0
            }))
        );
    }

    #[test]
    fn vtol_starts_false_is_omitted_when_false_and_is_sent_when_it_changes() {
        assert!(!base().vtol);
        assert!(!serde_json::to_string(&base()).unwrap().contains("vtol"));
        let next = VehicleState { vtol: true, ..base() };
        assert!(serde_json::to_string(&next).unwrap().contains("\"vtol\":true"));
        assert_eq!(diff(&base(), &next).expect("changed").vtol, Some(true));
        assert_eq!(VehicleStateDiff::full(&next).vtol, Some(true));
    }

    #[test]
    fn identical_states_have_no_diff() {
        assert_eq!(diff(&base(), &base()), None);
    }

    #[test]
    fn only_changed_fields_are_present() {
        let next = VehicleState {
            alt_rel: 12.5,
            mode: "AUTO".into(),
            ..base()
        };
        let d = diff(&base(), &next).expect("diff");
        assert_eq!(d.alt_rel, Some(12.5));
        assert_eq!(d.mode.as_deref(), Some("AUTO"));
        assert_eq!(d.lat, None);
        let json = serde_json::to_string(&d).unwrap();
        assert_eq!(json, r#"{"mode":"AUTO","alt_rel":12.5}"#);
    }

    #[test]
    fn heading_becoming_unknown_is_encoded_as_null() {
        let prev = VehicleState {
            hdg: Some(90.0),
            ..base()
        };
        let d = diff(&prev, &base()).expect("diff");
        assert_eq!(d.hdg, Some(None));
        assert_eq!(serde_json::to_string(&d).unwrap(), r#"{"hdg":null}"#);
    }

    #[test]
    fn full_diff_lists_every_field() {
        let d = VehicleStateDiff::full(&base());
        assert_eq!(d.name.as_deref(), Some("UAV-01"));
        assert_eq!(d.hdg, Some(None));
        assert_eq!(d.unread, Some(0));
    }

    #[test]
    fn summary_copies_list_fields() {
        let s = VehicleSummary::from(&VehicleState {
            armed: true,
            ..base()
        });
        assert_eq!(s.sysid, 1);
        assert!(s.armed);
        assert_eq!(s.link, LinkStatus::Ok);
    }

    #[test]
    fn enums_serialize_snake_case() {
        assert_eq!(
            serde_json::to_string(&VehicleKind::Copter).unwrap(),
            r#""copter""#
        );
        assert_eq!(serde_json::to_string(&LinkStatus::Lost).unwrap(), r#""lost""#);
    }

    #[test]
    fn diff_carries_new_fields() {
        let next = VehicleState {
            cog: Some(90.0),
            nav: Some(NavInfo {
                target_bearing: 10.0,
                wp_dist: 5,
            }),
            ..base()
        };
        let d = diff(&base(), &next).expect("diff");
        assert_eq!(d.cog, Some(Some(90.0)));
        assert_eq!(
            d.nav,
            Some(Some(NavInfo {
                target_bearing: 10.0,
                wp_dist: 5
            }))
        );
        assert_eq!(d.home, None);
        let back = diff(&next, &base()).expect("diff");
        assert_eq!(back.cog, Some(None), "cleared fields are sent as null");
        let json = serde_json::to_value(base()).unwrap();
        assert!(
            json.get("cog").is_none() && json.get("home").is_none(),
            "absent when unknown: {json}"
        );
    }
}
