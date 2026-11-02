//! Geofence zones and rally points (ArduPilot `MAV_MISSION_TYPE_FENCE` / `_RALLY`, user request
//! 2026-10-19). On the wire both are mission items: fence polygons are runs of
//! `NAV_FENCE_POLYGON_VERTEX_INCLUSION` (5001) / `_EXCLUSION` (5002) whose param1 is the polygon's
//! vertex count, circles are `NAV_FENCE_CIRCLE_INCLUSION` (5003) / `_EXCLUSION` (5004) with the
//! radius in param1 (AC_PolyFence_loader / MissionItemProtocol_Fence); rally points are
//! `NAV_RALLY_POINT` (5100) with a relative altitude. No home slot in either list.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::mission::{Finding, MissionFrame, MissionItem};

pub const MAV_CMD_NAV_FENCE_POLYGON_VERTEX_INCLUSION: u16 = 5001;
pub const MAV_CMD_NAV_FENCE_POLYGON_VERTEX_EXCLUSION: u16 = 5002;
pub const MAV_CMD_NAV_FENCE_CIRCLE_INCLUSION: u16 = 5003;
pub const MAV_CMD_NAV_FENCE_CIRCLE_EXCLUSION: u16 = 5004;
pub const MAV_CMD_NAV_RALLY_POINT: u16 = 5100;
/// ArduPilot stores at most 255 vertices per polygon (param1 is a byte).
pub const MAX_POLYGON_VERTICES: usize = 255;
/// Fence storage of a Pixhawk-class Copter (bytes / 8); other boards may hold more or less.
pub const TYPICAL_FENCE_ITEMS: usize = 70;
/// Rally storage of a Pixhawk-class Copter (bytes / 15).
pub const TYPICAL_RALLY_POINTS: usize = 46;

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct LatLon {
    pub lat: f64,
    pub lon: f64,
}

/// An area the vehicle must stay inside (`inclusion`) or must not enter.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(export)]
pub enum FenceZone {
    Polygon {
        inclusion: bool,
        vertices: Vec<LatLon>,
    },
    Circle {
        inclusion: bool,
        center: LatLon,
        radius: f32,
    },
}

/// A safe return point for RTL; `alt` is metres above home.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct RallyPoint {
    pub lat: f64,
    pub lon: f64,
    pub alt: f32,
}

fn located(command: u16, p: LatLon, param1: f32) -> MissionItem {
    MissionItem {
        command,
        // ArduPilot accepts GLOBAL / RELATIVE / TERRAIN frames for fence items and ignores z
        frame: MissionFrame::Rel,
        params: [param1, 0.0, 0.0, 0.0],
        lat: p.lat,
        lon: p.lon,
        alt: 0.0,
        autocontinue: true,
    }
}

/// The fence as wire items: each polygon's vertices back to back, each circle one item.
pub fn fence_to_items(zones: &[FenceZone]) -> Vec<MissionItem> {
    zones
        .iter()
        .flat_map(|z| match z {
            FenceZone::Polygon { inclusion, vertices } => {
                let cmd = if *inclusion {
                    MAV_CMD_NAV_FENCE_POLYGON_VERTEX_INCLUSION
                } else {
                    MAV_CMD_NAV_FENCE_POLYGON_VERTEX_EXCLUSION
                };
                let n = vertices.len() as f32;
                vertices.iter().map(|v| located(cmd, *v, n)).collect::<Vec<_>>()
            }
            FenceZone::Circle {
                inclusion,
                center,
                radius,
            } => {
                let cmd = if *inclusion {
                    MAV_CMD_NAV_FENCE_CIRCLE_INCLUSION
                } else {
                    MAV_CMD_NAV_FENCE_CIRCLE_EXCLUSION
                };
                vec![located(cmd, *center, *radius)]
            }
        })
        .collect()
}

/// Reads a downloaded fence back into zones; items ArduPilot would not store (the return point,
/// unknown commands) are skipped, a polygon cut short is an error.
pub fn fence_from_items(items: &[MissionItem]) -> Result<Vec<FenceZone>, String> {
    let mut zones = Vec::new();
    let mut i = 0;
    while i < items.len() {
        let it = &items[i];
        let at = LatLon {
            lat: it.lat,
            lon: it.lon,
        };
        match it.command {
            MAV_CMD_NAV_FENCE_POLYGON_VERTEX_INCLUSION | MAV_CMD_NAV_FENCE_POLYGON_VERTEX_EXCLUSION => {
                let n = it.params[0].max(0.0) as usize;
                let run = items
                    .get(i..i + n)
                    .filter(|r| n >= 3 && r.iter().all(|v| v.command == it.command));
                let Some(run) = run else {
                    return Err(format!(
                        "fence item {}: a polygon of {n} vertices is incomplete",
                        i + 1
                    ));
                };
                zones.push(FenceZone::Polygon {
                    inclusion: it.command == MAV_CMD_NAV_FENCE_POLYGON_VERTEX_INCLUSION,
                    vertices: run
                        .iter()
                        .map(|v| LatLon {
                            lat: v.lat,
                            lon: v.lon,
                        })
                        .collect(),
                });
                i += n;
                continue;
            }
            MAV_CMD_NAV_FENCE_CIRCLE_INCLUSION | MAV_CMD_NAV_FENCE_CIRCLE_EXCLUSION => {
                zones.push(FenceZone::Circle {
                    inclusion: it.command == MAV_CMD_NAV_FENCE_CIRCLE_INCLUSION,
                    center: at,
                    radius: it.params[0],
                })
            }
            _ => {}
        }
        i += 1;
    }
    Ok(zones)
}

/// What ArduPilot would refuse (fatal) and what may not fit or not work as expected (warn).
/// `seq` is the 1-based zone number.
/// A real position: finite, |lat| ≤ 90, |lon| ≤ 180 (ArduPilot `check_latlng`).
fn on_earth(lat: f64, lon: f64) -> bool {
    lat.is_finite() && lon.is_finite() && lat.abs() <= 90.0 && lon.abs() <= 180.0
}

/// Rally altitudes are stored as int16 metres; anything beyond this band is a typing error.
pub const MAX_RALLY_ALT_M: f32 = 10_000.0;

pub fn validate_fence(zones: &[FenceZone]) -> Vec<Finding> {
    let mut out = Vec::new();
    for (i, z) in zones.iter().enumerate() {
        let seq = Some(i as u16 + 1);
        let placed = match z {
            FenceZone::Polygon { vertices, .. } => vertices.iter().all(|v| on_earth(v.lat, v.lon)),
            FenceZone::Circle { center, .. } => on_earth(center.lat, center.lon),
        };
        if !placed {
            out.push(Finding::fatal(
                "fence_position",
                seq,
                "a fence point is not a valid latitude / longitude",
            ));
            continue;
        }
        match z {
            FenceZone::Polygon { vertices, .. } if vertices.len() < 3 => out.push(Finding::fatal(
                "fence_vertices",
                seq,
                "a fence polygon needs at least 3 vertices",
            )),
            FenceZone::Polygon { vertices, .. } if vertices.len() > MAX_POLYGON_VERTICES => {
                out.push(Finding::fatal(
                    "fence_vertices",
                    seq,
                    "a fence polygon holds at most 255 vertices",
                ))
            }
            FenceZone::Circle { radius, .. } if !radius.is_finite() || *radius <= 0.0 => out.push(
                Finding::fatal("fence_radius", seq, "a fence circle needs a radius above 0 m"),
            ),
            _ => {}
        }
    }
    let items = fence_to_items(zones).len();
    if items > usize::from(u16::MAX) {
        // MISSION_COUNT is a u16: the count would wrap
        out.push(Finding::fatal(
            "fence_size",
            None,
            format!("{items} fence items cannot be sent (at most 65535)"),
        ));
    } else if items > TYPICAL_FENCE_ITEMS {
        out.push(Finding::warn(
            "fence_size",
            None,
            format!("{items} fence items: a typical flight controller stores {TYPICAL_FENCE_ITEMS}"),
        ));
    }
    out
}

pub fn rally_to_items(points: &[RallyPoint]) -> Vec<MissionItem> {
    points
        .iter()
        .map(|p| MissionItem {
            alt: p.alt,
            ..located(
                MAV_CMD_NAV_RALLY_POINT,
                LatLon {
                    lat: p.lat,
                    lon: p.lon,
                },
                0.0,
            )
        })
        .collect()
}

pub fn rally_from_items(items: &[MissionItem]) -> Vec<RallyPoint> {
    items
        .iter()
        .filter(|it| it.command == MAV_CMD_NAV_RALLY_POINT)
        .map(|it| RallyPoint {
            lat: it.lat,
            lon: it.lon,
            alt: it.alt,
        })
        .collect()
}

pub fn validate_rally(points: &[RallyPoint]) -> Vec<Finding> {
    let bad: Vec<Finding> = points
        .iter()
        .enumerate()
        .filter_map(|(i, p)| {
            let seq = Some(i as u16 + 1);
            if !on_earth(p.lat, p.lon) {
                Some(Finding::fatal(
                    "rally_position",
                    seq,
                    "a rally point is not a valid latitude / longitude",
                ))
            } else if !p.alt.is_finite() || p.alt.abs() > MAX_RALLY_ALT_M {
                Some(Finding::fatal(
                    "rally_alt",
                    seq,
                    "a rally altitude must be within ±10000 m",
                ))
            } else {
                None
            }
        })
        .collect();
    if !bad.is_empty() {
        return bad;
    }
    if points.len() > TYPICAL_RALLY_POINTS {
        return vec![Finding::warn(
            "rally_size",
            None,
            format!(
                "{} rally points: a typical flight controller stores {TYPICAL_RALLY_POINTS}",
                points.len()
            ),
        )];
    }
    Vec::new()
}

#[cfg(test)]
mod tests {
    use super::*;

    const fn ll(lat: f64, lon: f64) -> LatLon {
        LatLon { lat, lon }
    }

    fn square(inclusion: bool) -> FenceZone {
        FenceZone::Polygon {
            inclusion,
            vertices: vec![
                ll(36.0, 137.0),
                ll(36.0, 137.01),
                ll(36.01, 137.01),
                ll(36.01, 137.0),
            ],
        }
    }

    #[test]
    fn polygons_go_out_as_contiguous_vertex_runs_with_their_count() {
        let items = fence_to_items(&[square(true), square(false)]);
        assert_eq!(items.len(), 8);
        assert!(items[..4]
            .iter()
            .all(|it| it.command == 5001 && it.params[0] == 4.0));
        assert!(items[4..]
            .iter()
            .all(|it| it.command == 5002 && it.params[0] == 4.0));
        assert_eq!((items[1].lat, items[1].lon), (36.0, 137.01));
    }

    #[test]
    fn circles_carry_the_radius_in_param1() {
        let c = FenceZone::Circle {
            inclusion: false,
            center: ll(36.0, 137.0),
            radius: 80.0,
        };
        let items = fence_to_items(std::slice::from_ref(&c));
        assert_eq!((items[0].command, items[0].params[0]), (5004, 80.0));
        assert_eq!(fence_from_items(&items).unwrap(), vec![c]);
    }

    #[test]
    fn a_fence_round_trips_and_skips_the_return_point() {
        let zones = vec![
            square(true),
            FenceZone::Circle {
                inclusion: true,
                center: ll(36.0, 137.0),
                radius: 300.0,
            },
            square(false),
        ];
        let mut items = fence_to_items(&zones);
        items.insert(0, located(5000, ll(36.0, 137.0), 0.0));
        assert_eq!(fence_from_items(&items).unwrap(), zones);
    }

    #[test]
    fn an_incomplete_polygon_is_an_error() {
        let mut items = fence_to_items(&[square(true)]);
        items.pop();
        assert!(fence_from_items(&items).is_err());
    }

    #[test]
    fn validation_mirrors_ardupilot() {
        let two = FenceZone::Polygon {
            inclusion: true,
            vertices: vec![ll(36.0, 137.0), ll(36.0, 137.01)],
        };
        let flat = FenceZone::Circle {
            inclusion: true,
            center: ll(36.0, 137.0),
            radius: 0.0,
        };
        let codes: Vec<_> = validate_fence(&[two, flat, square(true)])
            .into_iter()
            .map(|f| (f.code, f.seq))
            .collect();
        assert_eq!(
            codes,
            vec![
                ("fence_vertices".to_string(), Some(1)),
                ("fence_radius".to_string(), Some(2))
            ]
        );
        let many: Vec<_> = (0..20).map(|_| square(true)).collect();
        assert_eq!(validate_fence(&many)[0].code, "fence_size");
    }

    #[test]
    fn coordinates_out_of_range_or_not_finite_are_fatal() {
        let bad = FenceZone::Circle {
            inclusion: true,
            center: ll(91.0, 137.0),
            radius: 50.0,
        };
        let nan = FenceZone::Polygon {
            inclusion: true,
            vertices: vec![ll(36.0, f64::NAN), ll(36.0, 137.01), ll(36.01, 137.0)],
        };
        let codes: Vec<_> = validate_fence(&[bad, nan])
            .into_iter()
            .map(|f| (f.code, f.seq))
            .collect();
        assert_eq!(
            codes,
            vec![
                ("fence_position".to_string(), Some(1)),
                ("fence_position".to_string(), Some(2))
            ]
        );
        let far = RallyPoint {
            lat: 36.0,
            lon: 181.0,
            alt: 60.0,
        };
        let high = RallyPoint {
            lat: 36.0,
            lon: 137.0,
            alt: 40_000.0,
        };
        let deep = RallyPoint {
            lat: 36.0,
            lon: 137.0,
            alt: f32::NAN,
        };
        let codes: Vec<_> = validate_rally(&[far, high, deep])
            .into_iter()
            .map(|f| (f.code, f.seq))
            .collect();
        assert_eq!(
            codes,
            vec![
                ("rally_position".to_string(), Some(1)),
                ("rally_alt".to_string(), Some(2)),
                ("rally_alt".to_string(), Some(3))
            ]
        );
    }

    #[test]
    fn a_fence_beyond_the_protocol_count_is_fatal() {
        // MISSION_COUNT is a u16: a larger list would wrap and send garbage
        let huge = FenceZone::Polygon {
            inclusion: true,
            vertices: vec![ll(36.0, 137.0); 255],
        };
        let zones = vec![huge; 260];
        assert!(validate_fence(&zones)
            .iter()
            .any(|f| f.code == "fence_size" && f.level == crate::FindingLevel::Fatal));
    }

    #[test]
    fn rally_points_round_trip_with_a_relative_altitude() {
        let pts = vec![RallyPoint {
            lat: 36.25,
            lon: 137.63,
            alt: 60.0,
        }];
        let items = rally_to_items(&pts);
        assert_eq!(
            (items[0].command, items[0].frame, items[0].alt),
            (5100, MissionFrame::Rel, 60.0)
        );
        assert_eq!(rally_from_items(&items), pts);
        assert!(validate_rally(&pts).is_empty());
        assert_eq!(validate_rally(&vec![pts[0]; 47])[0].code, "rally_size");
    }
}
