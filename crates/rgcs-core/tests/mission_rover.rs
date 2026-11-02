//! A rover drives its mission from the first waypoint: no takeoff, and ending on a waypoint is normal.
use rgcs_core::mission::{FenceInfo, Mission, MissionFrame, MissionItem};
use rgcs_core::vehicle::VehicleKind;

fn wp(lat: f64, lon: f64) -> MissionItem {
    MissionItem {
        command: 16,
        frame: MissionFrame::Rel,
        params: [0.0; 4],
        lat,
        lon,
        alt: 0.0,
        autocontinue: true,
    }
}

fn mission(items: Vec<MissionItem>) -> Mission {
    Mission {
        id: None,
        name: "rover".into(),
        sysid: None,
        default_alt: 0.0,
        default_frame: MissionFrame::Rel,
        speed: 2.0,
        home: None,
        items,
        fence: Vec::new(),
        rally: Vec::new(),
        surveys: Vec::new(),
    }
}

fn codes(m: &Mission, kind: Option<VehicleKind>) -> Vec<String> {
    m.validate_for(&FenceInfo::default(), kind)
        .into_iter()
        .map(|f| f.code.to_string())
        .collect()
}

#[test]
fn a_rover_waypoint_only_mission_needs_no_takeoff_or_land() {
    let m = mission(vec![wp(36.25, 137.63), wp(36.251, 137.631)]);
    let c = codes(&m, Some(VehicleKind::Rover));
    assert!(!c.contains(&"first_not_takeoff".to_string()), "{c:?}");
    assert!(!c.contains(&"no_land_or_rtl".to_string()), "{c:?}");
    assert!(!Mission::has_fatal(
        &m.validate_for(&FenceInfo::default(), Some(VehicleKind::Rover))
    ));
}

#[test]
fn a_flying_or_unknown_vehicle_still_needs_a_takeoff() {
    let m = mission(vec![wp(36.25, 137.63)]);
    for kind in [Some(VehicleKind::Copter), Some(VehicleKind::Plane), None] {
        assert!(
            codes(&m, kind).contains(&"first_not_takeoff".to_string()),
            "{kind:?}"
        );
    }
}
