//! Synthetic 10 Hz trajectories against the toilet-bowl detector.

use std::f64::consts::PI;

mod common;
use common::*;

use rgcs_guard::{
    effective, Airframe, ExtLevel, ExternalContext, Sample, TbState, ToiletBowlConfig, ToiletBowlDetector,
    Verdict,
};

fn course_deg(ve: f64, vn: f64) -> f32 {
    ve.atan2(vn).to_degrees() as f32
}

fn edit(samples: Vec<Sample>, f: impl Fn(usize, Sample) -> Sample) -> Vec<Sample> {
    samples.into_iter().enumerate().map(|(i, s)| f(i, s)).collect()
}

fn first_detected(vs: &[Verdict]) -> Option<usize> {
    vs.iter().position(|v| v.state == TbState::Detected)
}

fn never_detected(vs: &[Verdict]) -> bool {
    first_detected(vs).is_none()
}

#[test]
fn spiral_with_all_three_signs_is_detected_after_the_window_fills() {
    let vs = run(&toilet_bowl(0.6));
    let i = first_detected(&vs).expect("detected");
    assert!((90..=106).contains(&i), "first detection at {i}");
    assert_eq!(vs[i].confidence, 1.0);
    assert_eq!(vs[i].recommended_mode, Some("ALT_HOLD"));
    let signs = vs[i].signs.as_ref().expect("signs");
    assert!(signs.a && signs.b && signs.c && signs.target_fixed);
    assert!(vs[..i]
        .iter()
        .all(|v| v.state != TbState::Suspect || v.signs.is_some()));
}

#[test]
fn spiral_without_compass_variance_is_detected_on_a_and_b() {
    let vs = run(&toilet_bowl(0.1));
    let i = first_detected(&vs).expect("detected");
    assert_eq!(vs[i].confidence, 0.7);
    let signs = vs[i].signs.as_ref().expect("signs");
    assert!(signs.a && signs.b && !signs.c);
}

#[test]
fn spiral_with_heading_on_course_is_only_suspect() {
    let samples = edit(toilet_bowl(0.1), |_, s| Sample {
        hdg: Some(course_deg(s.ve.into(), s.vn.into()) + 10.0),
        ..s
    });
    let vs = run(&samples);
    assert!(never_detected(&vs));
    assert!(vs.iter().any(|v| v.state == TbState::Suspect));
    assert!(vs.iter().all(|v| v.recommended_mode.is_none()));
}

#[test]
fn spiral_with_c_only_and_heading_on_course_is_detected_on_a_and_c() {
    let samples = edit(toilet_bowl(0.6), |_, s| Sample {
        hdg: Some(course_deg(s.ve.into(), s.vn.into())),
        ..s
    });
    let vs = run(&samples);
    let i = first_detected(&vs).expect("detected");
    assert_eq!(vs[i].confidence, 0.7);
}

#[test]
fn wind_drift_never_triggers_even_with_b_and_c() {
    let vs = run(&wind_drift());
    assert!(never_detected(&vs));
    let last = vs.last().and_then(|v| v.signs.clone()).expect("signs");
    assert!(!last.a && last.b && last.c, "{last:?}");
}

#[test]
fn constant_radius_orbit_never_triggers() {
    let vs = run(&track(14.0, &spiral(5.0, 0.0, 2.0 * PI / 8.0), 0.6));
    assert!(never_detected(&vs));
}

#[test]
fn circle_mode_is_not_monitored() {
    let samples = edit(toilet_bowl(0.6), |_, s| Sample {
        mode: "CIRCLE".into(),
        ..s
    });
    assert!(run(&samples).iter().all(|v| v.state == TbState::NotMonitored));
}

#[test]
fn disarmed_and_other_airframes_are_not_monitored() {
    let disarmed = edit(toilet_bowl(0.6), |_, s| Sample { armed: false, ..s });
    assert!(run(&disarmed).iter().all(|v| v.state == TbState::NotMonitored));
    let rover = edit(toilet_bowl(0.6), |_, s| Sample {
        airframe: Airframe::Other,
        ..s
    });
    assert!(run(&rover).iter().all(|v| v.state == TbState::NotMonitored));
}

fn guided(target: impl Fn(u64) -> (f64, f64)) -> Vec<Sample> {
    edit(toilet_bowl(0.6), |_, s| Sample {
        mode: "GUIDED".into(),
        target: Some(target(s.t_ms)),
        sticks_centred: None,
        ..s
    })
}

#[test]
fn guided_with_a_moving_target_never_triggers() {
    let vs = run(&guided(|t_ms| latlon(2.0 * (t_ms / 1000) as f64, 0.0)));
    assert!(never_detected(&vs));
    assert!(vs
        .last()
        .and_then(|v| v.signs.clone())
        .is_some_and(|s| !s.target_fixed));
}

#[test]
fn guided_with_a_fixed_target_is_detected() {
    let vs = run(&guided(|_| HOME));
    assert!(first_detected(&vs).is_some());
}

#[test]
fn guided_without_a_known_target_never_triggers() {
    let samples = edit(guided(|_| HOME), |_, s| Sample { target: None, ..s });
    assert!(never_detected(&run(&samples)));
}

#[test]
fn auto_is_not_monitored_until_the_window_starts_at_the_waypoint() {
    let samples = edit(track(18.0, &spiral(2.0, 0.3, 2.0 * PI / 8.0), 0.6), |_, s| {
        Sample {
            mode: "AUTO".into(),
            mission_seq: Some(3),
            wp_dist: Some(if s.t_ms < 4_000 { 40 } else { 2 }),
            sticks_centred: None,
            ..s
        }
    });
    let vs = run(&samples);
    assert!(vs[..140].iter().all(|v| v.state == TbState::NotMonitored));
    assert!(vs[140..].iter().any(|v| v.state == TbState::Detected));
}

#[test]
fn auto_with_a_mission_seq_change_in_the_window_never_triggers() {
    let samples = edit(toilet_bowl(0.6), |i, s| Sample {
        mode: "AUTO".into(),
        mission_seq: Some(if i % 40 < 20 { 3 } else { 4 }),
        wp_dist: Some(2),
        sticks_centred: None,
        ..s
    });
    assert!(never_detected(&run(&samples)));
}

#[test]
fn loiter_with_sticks_moved_never_triggers_but_no_rc_does() {
    let moved = edit(toilet_bowl(0.6), |_, s| Sample {
        sticks_centred: Some(false),
        ..s
    });
    assert!(never_detected(&run(&moved)));
    let no_rc = edit(toilet_bowl(0.6), |_, s| Sample {
        sticks_centred: None,
        ..s
    });
    assert!(first_detected(&run(&no_rc)).is_some());
}

#[test]
fn quadplane_qloiter_recommends_qhover_and_fw_guided_is_not_monitored() {
    let qloiter = edit(toilet_bowl(0.6), |_, s| Sample {
        airframe: Airframe::QuadPlane,
        mode: "QLOITER".into(),
        vtol_mc: true,
        ..s
    });
    let vs = run(&qloiter);
    let i = first_detected(&vs).expect("detected");
    assert_eq!(vs[i].recommended_mode, Some("QHOVER"));
    let fw = edit(guided(|_| HOME), |_, s| Sample {
        airframe: Airframe::QuadPlane,
        vtol_mc: false,
        ..s
    });
    assert!(run(&fw).iter().all(|v| v.state == TbState::NotMonitored));
    let mc = edit(guided(|_| HOME), |_, s| Sample {
        airframe: Airframe::QuadPlane,
        vtol_mc: true,
        ..s
    });
    assert!(first_detected(&run(&mc)).is_some());
}

#[test]
fn clears_after_sixteen_seconds_of_hover() {
    let bowl = toilet_bowl(0.6);
    let end = bowl.last().cloned().expect("end");
    let hover: Vec<Sample> = (1..=160)
        .map(|i| {
            let t_ms = end.t_ms + i * 100;
            Sample {
                t_ms,
                vn: 0.0,
                ve: 0.0,
                ekf_t_ms: Some(t_ms / 500 * 500),
                compass_var: Some(0.1),
                ..end.clone()
            }
        })
        .collect();
    let all: Vec<Sample> = bowl.into_iter().chain(hover).collect();
    let vs = run(&all);
    assert!(first_detected(&vs).is_some());
    let after = &vs[141..];
    assert_ne!(
        after[0].state,
        TbState::Clear,
        "the hold keeps it uncleared right after"
    );
    assert_eq!(vs.last().map(|v| v.state), Some(TbState::Clear));
}

#[test]
fn monitored_mode_exit_clears_the_window() {
    let samples = edit(toilet_bowl(0.6), |i, s| Sample {
        mode: if i == 20 {
            "ALT_HOLD".into()
        } else {
            s.mode.clone()
        },
        ..s
    });
    let vs = run(&samples);
    assert_eq!(vs[20].state, TbState::NotMonitored);
    let i = first_detected(&vs).expect("detected after re-entry");
    assert!(i >= 21 + 90, "window restarted, got {i}");
}

#[test]
fn slow_spiral_is_detected_only_under_strong_kp() {
    let samples = track(14.0, &spiral(2.0, 0.3, 2.0 * PI / 16.0), 0.6);
    let base = ToiletBowlConfig::default();
    let ok = effective(
        &base,
        &ExternalContext {
            kp: Some(ExtLevel::Ok),
        },
    );
    assert!(never_detected(&run_with(&samples, &ok)));
    let strong = effective(
        &base,
        &ExternalContext {
            kp: Some(ExtLevel::Strong),
        },
    );
    let vs = run_with(&samples, &strong);
    assert!(first_detected(&vs).is_some(), "{:?}", vs.last());
}

#[test]
fn slow_constant_orbit_stays_silent_under_strong_kp() {
    let strong = effective(
        &ToiletBowlConfig::default(),
        &ExternalContext {
            kp: Some(ExtLevel::Strong),
        },
    );
    let orbit = track(14.0, &spiral(5.0, 0.0, 2.0 * PI / 16.0), 0.6);
    assert!(never_detected(&run_with(&orbit, &strong)));
}

#[test]
fn wind_drift_stays_silent_under_strong_kp() {
    let strong = effective(
        &ToiletBowlConfig::default(),
        &ExternalContext {
            kp: Some(ExtLevel::Strong),
        },
    );
    assert!(never_detected(&run_with(&wind_drift(), &strong)));
}

#[test]
fn hover_with_high_compass_variance_and_strong_kp_stays_silent() {
    let strong = effective(
        &ToiletBowlConfig::default(),
        &ExternalContext {
            kp: Some(ExtLevel::Strong),
        },
    );
    let hover = track(14.0, &|_| (0.0, 0.0, 0.0, 0.0), 0.9);
    assert!(never_detected(&run_with(&hover, &strong)));
}

#[test]
fn evaluate_matches_push_on_the_window() {
    let samples = toilet_bowl(0.6);
    let cfg = ToiletBowlConfig::default();
    let (det, v) = samples
        .iter()
        .fold((ToiletBowlDetector::default(), None), |(d, _), s| {
            let (n, v) = d.push(s, &cfg);
            (n, Some(v))
        });
    let window = det.window();
    assert!(window.len() <= 101 && window.len() >= 100);
    assert_eq!(rgcs_guard::evaluate(&window, &cfg), v.expect("verdict"));
}

#[test]
fn config_serde_round_trip_and_empty_object_is_default() {
    let cfg = ToiletBowlConfig {
        compass_var: 0.42,
        ..ToiletBowlConfig::default()
    };
    let json = serde_json::to_string(&cfg).expect("ser");
    assert_eq!(serde_json::from_str::<ToiletBowlConfig>(&json).expect("de"), cfg);
    assert_eq!(
        serde_json::from_str::<ToiletBowlConfig>("{}").expect("de"),
        ToiletBowlConfig::default()
    );
}

#[test]
fn verdict_round_trips_through_owned_json() {
    let vs = run(&toilet_bowl(0.6));
    let v = vs[first_detected(&vs).expect("detected")].clone();
    let json: String = serde_json::to_string(&v).expect("ser");
    assert_eq!(serde_json::from_str::<Verdict>(&json).expect("de"), v);
}
