//! L2 "due" state: a countdown that ends without a `Detected` in the last
//! `RECHECK_MS` stays cancellable and acts on the first fresh `Detected` until the detector
//! clears. Pure machine flows, then the detector + machine pipeline on synthetic and SITL data.

mod common;

use common::*;
use rgcs_guard::{
    Effect, Input, Intervention, Level, Phase, Policy, Sample, TakeoverWhy, TbState, ToiletBowlConfig,
    ToiletBowlDetector, Verdict,
};

fn policy(level: Level) -> Policy {
    Policy {
        enabled: true,
        auto_ops: true,
        level,
        countdown_ms: 5000,
        takeover_wait_ms: 20000,
    }
}

fn verdict(state: TbState) -> Verdict {
    let hit = state == TbState::Detected;
    Verdict {
        state,
        confidence: if hit { 1.0 } else { 0.0 },
        signs: None,
        recommended_mode: hit.then_some("ALT_HOLD"),
    }
}

fn drive(p: &Policy, start: Intervention, inputs: Vec<Input<'_>>) -> (Intervention, Vec<Effect>) {
    inputs
        .into_iter()
        .fold((start, Vec::new()), |(m, mut all), input| {
            let (next, effects) = m.step(p, input);
            all.extend(effects);
            (next, all)
        })
}

fn sends(effects: &[Effect]) -> usize {
    effects
        .iter()
        .filter(|e| matches!(e, Effect::SendMode(_)))
        .count()
}

/// Detected at 0 (countdown to 5000), nothing fresh at the deadline: the machine is due.
fn due(p: &Policy) -> Intervention {
    let d = verdict(TbState::Detected);
    let (m, e) = drive(
        p,
        Intervention::default(),
        vec![Input::Verdict { v: &d, now_ms: 0 }, Input::Tick { now_ms: 5000 }],
    );
    assert_eq!((m.phase, sends(&e)), (Phase::Due, 0));
    assert!(e.contains(&Effect::Alert {
        phase: Phase::Due,
        sound: false
    }));
    assert!(e.contains(&Effect::Record { phase: Phase::Due }));
    assert!(!m.hands_off && !m.acted_this_flight);
    m
}

#[test]
fn a_fresh_detection_after_an_uncancelled_countdown_acts_once() {
    let p = policy(Level::L2);
    let d = verdict(TbState::Detected);
    let (m, e) = drive(
        &p,
        due(&p),
        vec![
            Input::Tick { now_ms: 6000 },
            Input::Verdict { v: &d, now_ms: 8000 },
        ],
    );
    assert_eq!(sends(&e), 1);
    assert_eq!(m.phase, Phase::Executing);
    assert!(m.acted_this_flight);
    let (_, e) = drive(
        &p,
        m,
        vec![
            Input::Verdict { v: &d, now_ms: 8100 },
            Input::Tick { now_ms: 9000 },
        ],
    );
    assert_eq!(sends(&e), 0, "at most once");
}

#[test]
fn cancel_while_due_sends_nothing() {
    let p = policy(Level::L2);
    let d = verdict(TbState::Detected);
    let (m, e) = drive(
        &p,
        due(&p),
        vec![
            Input::Cancel {
                by: "alice".into(),
                now_ms: 6000,
            },
            Input::Verdict { v: &d, now_ms: 8000 },
            Input::Tick { now_ms: 14_000 },
        ],
    );
    assert_eq!(m.phase, Phase::Cancelled);
    assert_eq!(m.by, "alice");
    assert!(m.hands_off);
    assert_eq!(sends(&e), 0);
}

#[test]
fn clear_while_due_goes_idle_and_the_next_detection_counts_down_again() {
    let p = policy(Level::L2);
    let (c, d) = (verdict(TbState::Clear), verdict(TbState::Detected));
    let (m, e) = due(&p).step(
        &p,
        Input::Verdict {
            v: &c,
            now_ms: 20_000,
        },
    );
    assert_eq!(m.phase, Phase::Idle);
    assert!(e.contains(&Effect::Clear));
    let (m, e) = m.step(
        &p,
        Input::Verdict {
            v: &d,
            now_ms: 30_000,
        },
    );
    assert_eq!((m.phase, sends(&e)), (Phase::Countdown, 0));
    assert_eq!(m.deadline_ms, Some(35_000));
}

#[test]
fn takeover_and_disable_while_due_never_act() {
    let p = policy(Level::L2);
    let d = verdict(TbState::Detected);
    let why = TakeoverWhy::Rc;
    let (m, e) = drive(
        &p,
        due(&p),
        vec![
            Input::Takeover { why, now_ms: 6000 },
            Input::Verdict { v: &d, now_ms: 7000 },
        ],
    );
    assert_eq!((m.phase, sends(&e)), (Phase::TakenOver, 0));
    let off = Policy {
        enabled: false,
        ..p.clone()
    };
    let (m, e) = due(&p).step(&off, Input::PolicyChanged(&off));
    assert_eq!((m.phase, sends(&e)), (Phase::Cancelled, 0));
}

#[test]
fn losing_consent_3_while_due_falls_back_to_alerting() {
    let p = policy(Level::L2);
    let l1 = Policy {
        auto_ops: false,
        ..p.clone()
    };
    let d = verdict(TbState::Detected);
    let (m, e) = drive(
        &l1,
        due(&p),
        vec![Input::PolicyChanged(&l1), Input::Verdict { v: &d, now_ms: 7000 }],
    );
    assert_eq!((m.phase, sends(&e)), (Phase::Alerting, 0));
}

#[test]
fn a_lowered_level_at_the_deadline_alerts_instead_of_going_due() {
    let p = policy(Level::L2);
    let l1 = policy(Level::L1);
    let d = verdict(TbState::Detected);
    let (m, _) = Intervention::default().step(&p, Input::Verdict { v: &d, now_ms: 0 });
    let (m, e) = m.step(&l1, Input::Tick { now_ms: 5000 });
    assert_eq!((m.phase, sends(&e)), (Phase::Alerting, 0));
}

/// Pushes `samples` through the detector and an L2 machine; returns the send times and phases.
fn pipeline(samples: &[Sample]) -> (Vec<u64>, Vec<Phase>) {
    let (p, cfg) = (policy(Level::L2), ToiletBowlConfig::default());
    let start = (
        ToiletBowlDetector::default(),
        Intervention::default(),
        Vec::new(),
        Vec::new(),
    );
    let (_, _, sent, phases) = samples.iter().fold(start, |(det, m, sent, phases), s| {
        let (det, v) = det.push(s, &cfg);
        let (m, e1) = m.step(
            &p,
            Input::Verdict {
                v: &v,
                now_ms: s.t_ms,
            },
        );
        let (m, e2) = m.step(&p, Input::Tick { now_ms: s.t_ms });
        let n = sends(&e1) + sends(&e2);
        let sent = [sent, vec![s.t_ms; n]].concat();
        let phases = [phases, vec![m.phase]].concat();
        (det, m, sent, phases)
    });
    (sent, phases)
}

#[test]
fn a_flickering_growing_bowl_acts_once() {
    let samples = track(30.0, &spiral(2.0, 0.3, 2.0 * std::f64::consts::PI / 8.0), 0.6);
    let first = run(&samples)
        .iter()
        .position(|v| v.state == TbState::Detected)
        .expect("detected");
    let deadline = samples[first].t_ms + 5000;
    // A stick blip 2 s around the deadline blanks sign A for a whole window (10 s), shorter than
    // the 15 s clear. Restarting the countdown would act only 5 s after the bowl is seen again.
    let flicker: Vec<Sample> = samples
        .into_iter()
        .map(|s| {
            let blank = s.t_ms + 1500 >= deadline && s.t_ms <= deadline + 500;
            Sample {
                sticks_centred: Some(!blank),
                ..s
            }
        })
        .collect();
    let back = run(&flicker)
        .iter()
        .zip(&flicker)
        .position(|(v, s)| v.state == TbState::Detected && s.t_ms > deadline)
        .map(|i| flicker[i].t_ms)
        .expect("detected again after the blip");
    let (sent, phases) = pipeline(&flicker);
    assert!(phases.contains(&Phase::Due), "went due");
    assert_eq!(sent, vec![back], "acts once, on the first fresh Detected");
}

#[test]
fn the_sitl_compass_bowl_still_never_acts_at_l2() {
    let path = format!(
        "{}/tests/fixtures/sitl_copter_toilet_bowl.jsonl",
        env!("CARGO_MANIFEST_DIR")
    );
    let text = std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{path}: {e}"));
    let samples: Vec<Sample> = text.lines().map(|l| serde_json::from_str(l).unwrap()).collect();
    let (sent, _) = pipeline(&samples);
    assert!(sent.is_empty());
}
