use super::*;

fn item(command: u16, lat: f64, lon: f64, alt: f32) -> MissionItem {
    MissionItem {
        command,
        frame: MissionFrame::Rel,
        params: [0.0; 4],
        lat,
        lon,
        alt,
        autocontinue: true,
    }
}

fn mission(items: Vec<MissionItem>) -> Mission {
    Mission {
        id: None,
        name: "t".into(),
        sysid: None,
        default_alt: 50.0,
        default_frame: MissionFrame::Rel,
        speed: 8.0,
        home: None,
        items,
        fence: Vec::new(),
        rally: Vec::new(),
        surveys: Vec::new(),
    }
}

#[test]
fn the_vehicle_copy_has_whole_degree_arc_angles() {
    // ArduPilot keeps |param1| as a uint16 (45.5 reads back as 45): send what it will store
    let mut arc = item(MAV_CMD_NAV_ARC_WAYPOINT, 36.0, 137.0, 30.0);
    arc.params = [-45.5, 1.5, 0.0, 0.0];
    let mut wp = item(16, 36.0, 137.0, 30.0);
    wp.params = [2.5, 0.0, 0.0, 0.0];
    let sent = mission(vec![arc, wp]).for_vehicle();
    assert_eq!(sent.items[0].params, [-46.0, 1.5, 0.0, 0.0]);
    assert_eq!(sent.items[1].params[0], 2.5);
}

#[test]
fn plane_loiter_to_alt_and_vtol_commands_are_positional() {
    for cmd in [31, 84, 85] {
        assert!(item(cmd, 36.0, 137.0, 30.0).is_positional(), "MAV_CMD {cmd}");
    }
}

#[test]
fn arc_waypoint_is_positional_and_counts_its_arc_length() {
    let east = |m: f64| m / (111_320.0 * (36.25f64).to_radians().cos());
    let mut arc = item(MAV_CMD_NAV_ARC_WAYPOINT, 36.25, 137.6 + east(100.0), 50.0);
    arc.params[0] = 90.0;
    assert!(arc.has_position());
    let m = mission(vec![item(MAV_CMD_NAV_TAKEOFF, 36.25, 137.6, 50.0), arc]);
    // chord 100 m, 90° → r = 70.71 m, arc = r·π/2 = 111.07 m
    assert!(
        (m.stats().distance_m - 111.07).abs() < 0.5,
        "{}",
        m.stats().distance_m
    );
}

fn codes(f: &[Finding]) -> Vec<&str> {
    f.iter().map(|x| x.code.as_str()).collect()
}

#[test]
fn frames_map_to_mav_ids() {
    assert_eq!(MissionFrame::Rel.mav(), 3);
    assert_eq!(MissionFrame::Abs.mav(), 0);
    assert_eq!(MissionFrame::Ter.mav(), 10);
    assert_eq!(MissionFrame::from_mav(10), Some(MissionFrame::Ter));
    assert_eq!(MissionFrame::from_mav(5), None);
}

#[test]
fn a_quadplane_mission_may_take_off_and_land_vertically() {
    let f = mission(vec![
        item(MAV_CMD_NAV_VTOL_TAKEOFF, 0.0, 0.0, 40.0),
        item(MAV_CMD_NAV_WAYPOINT, 36.0, 139.0, 60.0),
        item(MAV_CMD_NAV_VTOL_LAND, 0.0, 0.0, 0.0),
    ])
    .validate(&FenceInfo::default());
    let c = codes(&f);
    for code in ["first_not_takeoff", "zero_position", "no_land_or_rtl"] {
        assert!(!c.contains(&code), "{code} in {c:?}");
    }
}

#[test]
fn validate_flags_empty_and_first_not_takeoff() {
    let f = mission(vec![]).validate(&FenceInfo::default());
    assert_eq!(f[0].level, FindingLevel::Fatal);
    assert_eq!(f[0].code, "empty");
    let f = mission(vec![item(MAV_CMD_NAV_WAYPOINT, 36.0, 139.0, 50.0)]).validate(&FenceInfo::default());
    assert!(codes(&f).contains(&"first_not_takeoff"));
    assert!(Mission::has_fatal(&f));
}

#[test]
fn fence_alt_is_fatal_only_when_known_and_enabled() {
    let m = mission(vec![
        item(MAV_CMD_NAV_TAKEOFF, 35.481883, 138.48029, 30.0),
        item(MAV_CMD_NAV_WAYPOINT, 35.482883, 138.48129, 120.0),
    ]);
    let f = m.validate(&FenceInfo {
        enabled: Some(true),
        alt_max: Some(100.0),
        radius: None,
    });
    let fatal: Vec<_> = f.iter().filter(|x| x.level == FindingLevel::Fatal).collect();
    assert_eq!(fatal.len(), 1);
    assert_eq!(fatal[0].code, "fence_alt");
    assert_eq!(fatal[0].seq, Some(2));
    let f = m.validate(&FenceInfo::default());
    assert!(!Mission::has_fatal(&f));
    assert!(codes(&f).contains(&"fence_unknown"));
    let f = m.validate(&FenceInfo {
        enabled: Some(false),
        alt_max: None,
        radius: None,
    });
    assert!(!codes(&f).contains(&"fence_unknown"));
}

#[test]
fn fence_radius_uses_home_when_present() {
    let mut m = mission(vec![
        item(MAV_CMD_NAV_TAKEOFF, 35.481883, 138.48029, 30.0),
        item(MAV_CMD_NAV_WAYPOINT, 35.481883, 138.49829, 50.0), // ≈1.6 km east
    ]);
    let fence = FenceInfo {
        enabled: Some(true),
        alt_max: Some(120.0),
        radius: Some(1000.0),
    };
    let f = m.validate(&fence);
    assert!(codes(&f).contains(&"fence_radius"));
    // Home halfway between the two points: both are ~810 m from it, inside the 1 km fence.
    m.home = Some(Home {
        lat: 35.481883,
        lon: 138.48929,
        alt: 0.0,
    });
    let f = m.validate(&fence);
    assert!(!codes(&f).contains(&"fence_radius"), "{f:?}");
}

#[test]
fn jump_target_out_of_range_is_fatal() {
    let mut jump = item(MAV_CMD_DO_JUMP, 0.0, 0.0, 0.0);
    jump.params[0] = 5.0;
    let m = mission(vec![item(MAV_CMD_NAV_TAKEOFF, 35.481883, 138.48029, 30.0), jump]);
    let f = m.validate(&FenceInfo::default());
    let j = f.iter().find(|x| x.code == "jump_target").expect("finding");
    assert_eq!(j.level, FindingLevel::Fatal);
    assert_eq!(j.seq, Some(2));
}

#[test]
fn stats_sum_distance_time_and_max_alt() {
    let mut wp = item(MAV_CMD_NAV_WAYPOINT, 35.481883, 138.49139, 80.0);
    wp.params[0] = 10.0;
    let m = mission(vec![item(MAV_CMD_NAV_TAKEOFF, 35.481883, 138.48029, 30.0), wp]);
    let s = m.stats();
    assert!((990.0..1010.0).contains(&s.distance_m), "{}", s.distance_m);
    assert!((123.0..137.0).contains(&s.duration_s), "{}", s.duration_s);
    assert_eq!(s.max_alt, 80.0);
}

#[test]
fn read_back_shaped_mission_has_no_frame_warnings() {
    // ArduPilot returns RTL (no position) in MAV_FRAME_GLOBAL: not a mixed-frame mission.
    let mut m = demo20();
    m.items[19].frame = MissionFrame::Abs;
    let f = m.validate(&FenceInfo {
        enabled: Some(true),
        alt_max: Some(120.0),
        radius: None,
    });
    assert!(!codes(&f).contains(&"mixed_frames"), "{f:?}");
    assert!(!codes(&f).contains(&"fence_frame_unchecked"), "{f:?}");
}

#[test]
fn demo_mission_is_valid_with_warnings_only() {
    let f = demo20().validate(&FenceInfo::default());
    assert!(!Mission::has_fatal(&f), "{f:?}");
    assert_eq!(demo20().items.len(), 20);
}
fn survey(first: u32, count: u32) -> SurveyBlock {
    SurveyBlock {
        id: "s".into(),
        first,
        count,
        spec: serde_json::json!({}),
    }
}

fn three_wps() -> Vec<MissionItem> {
    vec![
        item(MAV_CMD_NAV_TAKEOFF, 36.0, 137.0, 30.0),
        item(16, 36.0, 137.001, 30.0),
        item(16, 36.0, 137.002, 30.0),
    ]
}

#[test]
fn validate_flags_survey_out_of_range() {
    let mut m = mission(three_wps());
    m.surveys = vec![survey(2, 2)];
    let f = m.validate(&FenceInfo::default());
    assert!(
        f.iter()
            .any(|x| x.code == "survey_range" && x.level == FindingLevel::Fatal),
        "{f:?}"
    );
    m.surveys = vec![survey(1, 0)];
    assert!(codes(&m.validate(&FenceInfo::default())).contains(&"survey_range"));
    m.surveys = vec![survey(1, 2)];
    assert!(!codes(&m.validate(&FenceInfo::default())).contains(&"survey_range"));
}

#[test]
fn validate_flags_overlapping_surveys() {
    let mut m = mission(three_wps());
    m.surveys = vec![survey(0, 2), survey(1, 2)];
    let f = m.validate(&FenceInfo::default());
    assert!(codes(&f).contains(&"survey_range"), "{f:?}");
}

#[test]
fn mission_without_surveys_deserializes() {
    let mut v = serde_json::to_value(mission(three_wps())).unwrap();
    v.as_object_mut().unwrap().remove("surveys");
    let m: Mission = serde_json::from_value(v).unwrap();
    assert!(m.surveys.is_empty());
}
