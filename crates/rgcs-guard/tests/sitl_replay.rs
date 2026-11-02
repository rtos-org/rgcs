//! Replay of telemetry recorded on a scratch ArduCopter SITL by `tests/sitl/guard_toilet_bowl.py`
//! with `RGCS_GUARD_DUMP`. One `Sample` per line, LOITER only.
//!
//! - `sitl_copter_toilet_bowl.jsonl`: mis-oriented compass (COMPASS_ORIENT 2 plus a hard-iron
//!   offset), LOITER entered at index 0. The vehicle circles with a radius that grows to ~1.55 m
//!   and then decays as the EKF recovers.
//! - `sitl_copter_wind.jsonl`: 60 s of LOITER in a steady 8 m/s wind (scenario A).
//! - `sitl_copter_wind_spiral.jsonl`: weak loiter (LOIT_ANG_MAX 5) in a wind turning 30 deg/s and
//!   strengthening: a growing circle with the nose held (the scenario B pipeline check).
//! - `sitl_decisions.json`: decision records from `GET /api/guard/decisions` of those runs.

use rgcs_guard::{replay, DecisionRecord, Sample, TbState, ToiletBowlConfig, ToiletBowlDetector};

fn load(name: &str) -> Vec<Sample> {
    let path = format!("{}/tests/fixtures/{name}", env!("CARGO_MANIFEST_DIR"));
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{path}: {e}"));
    text.lines()
        .map(|l| serde_json::from_str(l).expect("a Sample per line"))
        .collect()
}

/// The index of every sample whose verdict is `Detected`, pushing the fixture through the
/// detector with the default (v1) thresholds.
fn detected(samples: &[Sample]) -> Vec<usize> {
    let cfg = ToiletBowlConfig::default();
    let (_, hits) = samples.iter().enumerate().fold(
        (ToiletBowlDetector::default(), Vec::new()),
        |(det, hits), (i, s)| {
            let (det, v) = det.push(s, &cfg);
            let hits = if v.state == TbState::Detected {
                [hits, vec![i]].concat()
            } else {
                hits
            };
            (det, hits)
        },
    );
    hits
}

#[test]
fn compass_fault_bowl_is_detected_as_soon_as_the_window_is_full() {
    let s = load("sitl_copter_toilet_bowl.jsonl");
    assert!(s.iter().all(|x| x.mode == "LOITER" && x.armed));
    let hits = detected(&s);
    let first = *hits.first().expect("the SITL compass-fault bowl is detected");
    // LOITER (and the circling) starts at index 0; the 10 s window needs >= 9 s of samples.
    assert!((90..=110).contains(&first), "first detection at {first}");
    // The bowl decays (EKF recovers): no detection once the radius shrinks below 1.5 m.
    assert!(hits.iter().all(|&i| i < 120), "late detections: {hits:?}");
}

#[test]
fn steady_wind_in_loiter_is_never_detected() {
    let s = load("sitl_copter_wind.jsonl");
    assert!(s.len() >= 590, "60 s at 10 Hz");
    assert!(detected(&s).is_empty());
}

#[test]
fn rotating_wind_spiral_is_detected_once_the_turn_reaches_270_degrees() {
    let s = load("sitl_copter_wind_spiral.jsonl");
    let hits = detected(&s);
    let first = *hits.first().expect("the growing circle is detected");
    assert!((290..=310).contains(&first), "first detection at {first}");
}

#[test]
fn recorded_decisions_replay_to_their_verdicts() {
    let path = format!(
        "{}/tests/fixtures/sitl_decisions.json",
        env!("CARGO_MANIFEST_DIR")
    );
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{path}: {e}"));
    let records: Vec<DecisionRecord> = serde_json::from_str(&text).expect("decision records");
    assert!(records.len() >= 3);
    for r in &records {
        assert_eq!(replay(r).state, r.verdict.state, "record at {}", r.ts_ms);
    }
}
