use super::*;
use crate::mission::{FenceInfo, FindingLevel, Mission, MissionFrame};

/// A positioned item, or one with x / y / z at 0 for a command without a location.
fn item(command: u16, params: [f32; 4]) -> MissionItem {
    let (lat, lon, alt) = if stored_in_location(command) {
        (36.25, 137.64, 50.0)
    } else {
        (0.0, 0.0, 0.0)
    };
    MissionItem {
        command,
        frame: MissionFrame::Rel,
        params,
        lat,
        lon,
        alt,
        autocontinue: true,
    }
}

fn do_item(command: u16, params: [f32; 4], xyz: (f64, f64, f32)) -> MissionItem {
    MissionItem {
        lat: xyz.0,
        lon: xyz.1,
        alt: xyz.2,
        ..item(command, params)
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
fn loiter_to_alt_drops_param1_and_keeps_radius_sign_and_xtrack() {
    // The plan that read back as a mismatch: [100, 0, 0, 0] comes back as [0, 0, 0, 0]
    let got = as_stored(&item(31, [100.0, 0.0, 0.0, 0.0]), true);
    assert_eq!(got.params, [0.0, 0.0, 0.0, 0.0]);
    assert_eq!((got.lat, got.lon, got.alt), (36.25, 137.64, 50.0));
    let got = as_stored(&item(31, [100.0, -80.7, 3.0, 2.0]), true);
    assert_eq!(got.params, [0.0, -80.0, 0.0, 1.0]);
    let got = as_stored(&item(31, [0.0, 120.0, 0.0, -1.0]), false);
    assert_eq!(got.params, [0.0, 120.0, 0.0, 0.0]);
}

/// (command, ArduPlane build, sent params, read-back params) for each modelled command.
const PARAM_TABLE: &[(u16, bool, [f32; 4], [f32; 4])] = &[
    (16, false, [2.7, 5.0, 3.0, 9.0], [2.0, 0.0, 0.0, 0.0]),
    (16, true, [2.7, 5.9, 300.0, 9.0], [0.0, 5.0, 255.0, 0.0]),
    (17, true, [4.0, 1.0, -75.5, 1.0], [0.0, 0.0, -75.0, 0.0]),
    (18, false, [2.0, 9.0, 20.0, 1.0], [2.0, 0.0, 20.0, 1.0]),
    (18, false, [0.5, 0.0, -30.0, 0.0], [0.5, 0.0, -30.0, 0.0]),
    (18, false, [300.0, 0.0, 1234.0, 0.0], [255.0, 0.0, 1230.0, 0.0]),
    (18, false, [1.0, 0.0, 100.0, 0.0], [1.0, 0.0, 100.0, 0.0]),
    (19, true, [10.9, 4.0, 0.0, 0.0], [10.0, 0.0, 1.0, 0.0]),
    (19, true, [10.0, 0.0, -5.0, 3.0], [10.0, 0.0, -1.0, 1.0]),
    (20, false, [1.0, 2.0, 3.0, 4.0], [0.0, 0.0, 0.0, 0.0]),
    (21, true, [12.5, 3.0, 4.0, 0.0], [12.0, 0.0, 0.0, 1.0]),
    (21, true, [0.0, 0.0, 0.0, -2.0], [0.0, 0.0, 0.0, -1.0]),
    (22, false, [15.0, 1.0, 2.0, 3.0], [15.0, 0.0, 0.0, 0.0]),
    (36, false, [-45.5, 1.5, 0.0, 0.0], [-45.0, 0.0, 0.0, 0.0]),
    (36, false, [90.0, 0.0, 0.0, 0.0], [90.0, 0.0, 0.0, 0.0]),
    (82, false, [3.0, 1.0, 0.0, 0.0], [3.0, 0.0, 0.0, 0.0]),
    (84, true, [1.0, 2.0, 3.0, 4.0], [0.0, 0.0, 0.0, 0.0]),
    (85, true, [1.0, 2.0, 3.0, 4.0], [1.0, 0.0, 0.0, 0.0]),
    (93, false, [10.5, -1.0, 30.0, 300.0], [10.5, -1.0, 30.0, 127.0]),
    (112, false, [5.25, 1.0, 0.0, 0.0], [5.25, 0.0, 0.0, 0.0]),
    (114, false, [50.5, 1.0, 0.0, 0.0], [50.5, 0.0, 0.0, 0.0]),
    (115, false, [90.5, 10.5, -1.0, 1.0], [90.5, 10.5, -1.0, 1.0]),
    (177, false, [3.0, -1.0, 7.0, 0.0], [3.0, -1.0, 0.0, 0.0]),
    (178, true, [0.0, 18.3, -1.0, 4.0], [0.0, 18.3, -1.0, 0.0]),
    (178, false, [1.5, 8.0, 50.0, 0.0], [1.0, 8.0, 50.0, 0.0]),
    (181, false, [1.0, 1.0, 5.0, 0.0], [1.0, 1.0, 0.0, 0.0]),
    (182, false, [1.0, 3.0, 2.5, 9.0], [1.0, 3.0, 2.5, 0.0]),
    (183, false, [9.0, 1500.5, 1.0, 0.0], [9.0, 1500.0, 0.0, 0.0]),
    (184, false, [9.0, 1700.0, 2.0, 2.5], [9.0, 1700.0, 2.0, 2.5]),
    (189, true, [1.0, 0.0, 0.0, 0.0], [0.0, 0.0, 0.0, 0.0]),
    (201, false, [3.0, 1.0, 0.0, 0.0], [3.0, 0.0, 0.0, 0.0]),
    (203, false, [1.0, 2.0, -1.0, 2.0], [1.0, 2.0, -1.0, 2.0]),
    (205, false, [-45.5, 10.0, 20.0, 1.0], [-45.5, 10.0, 20.0, 0.0]),
    (206, false, [20.5, 4.0, 1.0, 0.0], [20.5, 0.0, 1.0, 0.0]),
    (207, false, [2.0, 1.0, 0.0, 0.0], [2.0, 0.0, 0.0, 0.0]),
    (211, false, [1.0, 1.0, 3.0, 0.0], [1.0, 1.0, 0.0, 0.0]),
    (218, false, [300.0, 2.0, 1.0, 0.0], [300.0, 2.0, 0.0, 0.0]),
    (1000, false, [-45.7, 170.2, 5.0, 6.0], [-45.0, 170.0, 5.0, 6.0]),
    (3000, true, [4.0, 1.0, 0.0, 0.0], [4.0, 0.0, 0.0, 0.0]),
];

#[test]
fn stored_params_follow_ap_mission_for_each_modelled_command() {
    for &(command, plane, sent, want) in PARAM_TABLE {
        let got = as_stored(&item(command, sent), plane);
        assert_eq!(got.params, want, "MAV_CMD {command} plane={plane} {sent:?}");
    }
}

#[test]
fn location_commands_keep_their_position() {
    for &(command, plane, sent, _) in PARAM_TABLE {
        if stored_in_location(command) {
            let got = as_stored(&item(command, sent), plane);
            assert_eq!(
                (got.lat, got.lon, got.alt),
                (36.25, 137.64, 50.0),
                "MAV_CMD {command}"
            );
        }
    }
}

#[test]
fn commands_without_a_location_keep_only_the_x_y_z_they_store() {
    // DO_CHANGE_SPEED stores no x / y / z: they read back as 0
    let got = as_stored(&do_item(178, [1.0, 8.0, -1.0, 0.0], (4.0, 5.0, 6.0)), false);
    assert_eq!((got.lat, got.lon, got.alt), (0.0, 0.0, 0.0));
    // DIGICAM_CONTROL: x = shooting command (uint8), y = command id (uint8), z dropped
    let got = as_stored(&do_item(203, [0.0; 4], (1.0, 2.0, 3.0)), false);
    assert_eq!((got.lat, got.lon, got.alt), (1.0, 2.0, 0.0));
    // MOUNT_CONTROL always reads back MAV_MOUNT_MODE_MAVLINK_TARGETING (2) in z
    let got = as_stored(&do_item(205, [0.0; 4], (0.0, 0.0, 4.0)), false);
    assert_eq!((got.lat, got.lon, got.alt), (0.0, 0.0, 2.0));
    // GIMBAL_MANAGER_PITCHYAW: x = flags (uint8), z = gimbal id (uint8), y dropped
    let got = as_stored(&do_item(1000, [0.0; 4], (16.0, 3.0, 1.6)), false);
    assert_eq!((got.lat, got.lon, got.alt), (16.0, 0.0, 1.0));
}

#[test]
fn an_unmodelled_command_reads_back_as_sent() {
    let sent = do_item(5000, [0.1, 1e-7, 123_456.79, -3.3], (36.25, 137.64, 12.5));
    assert_eq!(as_stored(&sent, false), sent);
    assert_eq!(as_stored(&sent, true), sent);
}

#[test]
fn an_unknown_airframe_accepts_either_waypoint_packing() {
    let wp = item(16, [3.0, 5.0, 0.0, 0.0]);
    let forms = stored_forms(&wp, None);
    assert!(
        forms.iter().any(|f| f.params == [3.0, 0.0, 0.0, 0.0]),
        "{forms:?}"
    );
    assert!(
        forms.iter().any(|f| f.params == [0.0, 5.0, 0.0, 0.0]),
        "{forms:?}"
    );
    assert_eq!(stored_forms(&wp, Some(VehicleKind::Plane)).len(), 1);
    assert_eq!(
        stored_forms(&wp, Some(VehicleKind::Rover))[0].params,
        [3.0, 0.0, 0.0, 0.0]
    );
    assert_eq!(stored_forms(&item(31, [0.0; 4]), None).len(), 1);
}

fn ignored(m: &Mission, kind: Option<VehicleKind>) -> Vec<crate::mission::Finding> {
    m.validate_for(&FenceInfo::default(), kind)
        .into_iter()
        .filter(|f| f.code == "param_ignored")
        .collect()
}

#[test]
fn validation_warns_about_a_param_ardupilot_discards() {
    let m = mission(vec![
        item(84, [0.0; 4]),
        item(31, [100.0, 0.0, 0.0, 0.0]),
        item(19, [10.0, 0.0, 0.0, 0.0]),
        item(85, [0.0; 4]),
    ]);
    let f = ignored(&m, Some(VehicleKind::Plane));
    assert_eq!(f.len(), 1, "{f:?}");
    assert_eq!(f[0].level, FindingLevel::Warn);
    assert_eq!(f[0].seq, Some(2));
    assert!(f[0].message.contains("NAV_LOITER_TO_ALT"), "{}", f[0].message);
    assert!(f[0].message.contains("param1"), "{}", f[0].message);
    assert_eq!(
        f[0].param,
        Some(crate::mission::StoredParam {
            index: 1,
            sent: 100.0,
            stored: 0.0
        })
    );
}

#[test]
fn validation_names_a_changed_param_and_skips_what_survives() {
    let m = mission(vec![
        item(22, [0.0; 4]),
        item(16, [2.5, 0.0, 0.0, 0.0]),
        item(16, [0.0, 5.0, 0.0, 0.0]),
        item(178, [1.0, 8.5, -1.0, 0.0]),
        item(20, [0.0; 4]),
    ]);
    let f = ignored(&m, Some(VehicleKind::Copter));
    let seqs: Vec<_> = f.iter().map(|f| f.seq).collect();
    assert_eq!(seqs, vec![Some(2), Some(3)], "{f:?}");
    assert!(
        f[0].message.contains("2.5") && f[0].message.contains('2'),
        "{}",
        f[0].message
    );
    assert!(f[1].message.contains("param2"), "{}", f[1].message);
    let change = f[0].param.expect("param detail");
    assert_eq!((change.index, change.sent, change.stored), (1, 2.5, 2.0));
}

#[test]
fn other_findings_carry_no_param_detail() {
    let m = mission(vec![item(16, [0.0; 4])]);
    let f = m.validate_for(&FenceInfo::default(), Some(VehicleKind::Copter));
    assert!(!f.is_empty());
    assert!(f.iter().all(|f| f.param.is_none()), "{f:?}");
}

#[test]
fn an_unknown_airframe_warns_only_about_what_every_build_discards() {
    let m = mission(vec![
        item(22, [0.0; 4]),
        item(16, [3.0, 0.0, 0.0, 0.0]),
        item(16, [0.0, 5.0, 0.0, 0.0]),
        item(31, [100.0, 0.0, 0.0, 0.0]),
        item(20, [0.0; 4]),
    ]);
    let seqs: Vec<_> = ignored(&m, None).iter().map(|f| f.seq).collect();
    assert_eq!(seqs, vec![Some(4)]);
}

#[test]
fn validation_judges_the_arc_angle_rgcs_actually_sends() {
    // for_vehicle rounds 45.5 to 46, which ArduPilot keeps: no warning about param1
    let m = mission(vec![
        item(22, [0.0; 4]),
        item(36, [45.5, 0.0, 0.0, 0.0]),
        item(20, [0.0; 4]),
    ]);
    assert!(ignored(&m, Some(VehicleKind::Copter)).is_empty());
}
