//! Intervention state machine, RC takeover watch and decision records.

mod common;

use common::*;
use rgcs_guard::{
    replay, DecisionRecord, Effect, ExtLevel, ExternalContext, Input, Intervention, Level, Phase, Policy,
    RcWatch, Sample, TakeoverWhy, TbState, ToiletBowlConfig, ToiletBowlDetector, Verdict, OWNER_GCS,
    RECORD_VERSION,
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

fn verdict(state: TbState, mode: Option<&'static str>) -> Verdict {
    Verdict {
        state,
        confidence: if state == TbState::Detected { 1.0 } else { 0.0 },
        signs: None,
        recommended_mode: if state == TbState::Detected { mode } else { None },
    }
}

fn detected() -> Verdict {
    verdict(TbState::Detected, Some("ALT_HOLD"))
}

fn clear() -> Verdict {
    verdict(TbState::Clear, None)
}

/// Feeds `inputs` in order and returns the final machine and every effect.
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

fn countdown(p: &Policy) -> Intervention {
    let d = detected();
    let (m, effects) = Intervention::default().step(p, Input::Verdict { v: &d, now_ms: 0 });
    assert_eq!(m.phase, Phase::Countdown);
    assert_eq!(
        effects,
        vec![
            Effect::Alert {
                phase: Phase::Countdown,
                sound: true
            },
            Effect::Record {
                phase: Phase::Countdown
            },
        ]
    );
    assert_eq!(m.deadline_ms, Some(5000));
    m
}

#[test]
fn l2_counts_down_executes_then_goes_unanswered_and_never_acts_again() {
    let p = policy(Level::L2);
    let d = detected();
    let m = countdown(&p);
    let (m, e) = m.step(&p, Input::Tick { now_ms: 4999 });
    assert_eq!((m.phase, sends(&e)), (Phase::Countdown, 0));
    let (m, _) = m.step(&p, Input::Verdict { v: &d, now_ms: 4500 });
    let (m, e) = m.step(&p, Input::Tick { now_ms: 5000 });
    assert_eq!(
        e,
        vec![
            Effect::SendMode("ALT_HOLD"),
            Effect::Record {
                phase: Phase::Executing
            }
        ]
    );
    assert!(m.acted_this_flight);
    let (m, e) = m.step(
        &p,
        Input::ActionResult {
            ok: true,
            now_ms: 5000,
        },
    );
    assert_eq!(m.phase, Phase::Executed);
    assert!(e.contains(&Effect::Alert {
        phase: Phase::Executed,
        sound: false
    }));
    let (m, e) = m.step(&p, Input::Tick { now_ms: 24_999 });
    assert_eq!((m.phase, e.len()), (Phase::Executed, 0));
    let (m, e) = m.step(&p, Input::Tick { now_ms: 25_001 });
    assert_eq!(m.phase, Phase::Unanswered);
    assert!(e.contains(&Effect::Alert {
        phase: Phase::Unanswered,
        sound: true
    }));
    assert!(m.hands_off);
    let (_, e) = drive(
        &p,
        m,
        vec![
            Input::Verdict {
                v: &d,
                now_ms: 30_000,
            },
            Input::Tick { now_ms: 40_000 },
            Input::Verdict {
                v: &d,
                now_ms: 60_000,
            },
            Input::Tick { now_ms: 90_000 },
        ],
    );
    assert_eq!(sends(&e), 0);
}

#[test]
fn l2_rechecks_the_verdict_after_the_countdown() {
    let p = policy(Level::L2);
    let c = clear();
    let (m, e) = drive(
        &p,
        countdown(&p),
        vec![
            Input::Verdict { v: &c, now_ms: 3000 },
            Input::Tick { now_ms: 5000 },
        ],
    );
    assert_eq!((m.phase, sends(&e)), (Phase::Due, 0));
    assert!(!m.acted_this_flight);
}

#[test]
fn l2_detected_more_than_one_second_before_the_deadline_does_not_execute() {
    let p = policy(Level::L2);
    let s = verdict(TbState::Suspect, None);
    let (m, e) = drive(
        &p,
        countdown(&p),
        vec![
            Input::Verdict { v: &s, now_ms: 1000 },
            Input::Tick { now_ms: 5000 },
        ],
    );
    assert_eq!((m.phase, sends(&e)), (Phase::Due, 0));
}

#[test]
fn cancel_during_the_countdown_stops_the_action_for_the_flight() {
    let p = policy(Level::L2);
    let d = detected();
    let (m, e) = countdown(&p).step(
        &p,
        Input::Cancel {
            by: "alice".into(),
            now_ms: 2000,
        },
    );
    assert_eq!(m.phase, Phase::Cancelled);
    assert_eq!(m.by, "alice");
    assert!(e.contains(&Effect::Record {
        phase: Phase::Cancelled
    }));
    let (m, e) = drive(
        &p,
        m,
        vec![
            Input::Verdict { v: &d, now_ms: 4900 },
            Input::Tick { now_ms: 5000 },
            Input::Tick { now_ms: 9000 },
            Input::Verdict {
                v: &d,
                now_ms: 30_000,
            },
            Input::Tick { now_ms: 36_000 },
        ],
    );
    assert_eq!(sends(&e), 0);
    assert!(m.hands_off);
}

#[test]
fn takeover_during_the_countdown_is_hands_off_until_disarmed() {
    let p = policy(Level::L2);
    let d = detected();
    let (m, e) = countdown(&p).step(
        &p,
        Input::Takeover {
            why: TakeoverWhy::GcsCommand,
            now_ms: 1000,
        },
    );
    assert_eq!(m.phase, Phase::TakenOver);
    assert!(e.contains(&Effect::Alert {
        phase: Phase::TakenOver,
        sound: false
    }));
    let (m, e) = drive(
        &p,
        m,
        vec![
            Input::Verdict { v: &d, now_ms: 4900 },
            Input::Tick { now_ms: 5000 },
            Input::Verdict {
                v: &d,
                now_ms: 20_000,
            },
            Input::Tick { now_ms: 26_000 },
        ],
    );
    assert_eq!(sends(&e), 0);
    assert!(m.hands_off);
    let (m, _) = m.step(&p, Input::Disarmed);
    assert!(!m.hands_off && !m.acted_this_flight);
    assert_eq!(m.phase, Phase::Idle);
}

#[test]
fn takeover_after_execution_is_taken_over_not_unanswered() {
    let p = policy(Level::L3);
    let d = detected();
    let (m, _) = drive(
        &p,
        Intervention::default(),
        vec![
            Input::Verdict { v: &d, now_ms: 0 },
            Input::ActionResult {
                ok: true,
                now_ms: 300,
            },
            Input::Takeover {
                why: TakeoverWhy::Rc,
                now_ms: 4000,
            },
        ],
    );
    assert_eq!(m.phase, Phase::TakenOver);
    let (m, e) = m.step(&p, Input::Tick { now_ms: 30_000 });
    assert_eq!((m.phase, e.len()), (Phase::TakenOver, 0));
}

#[test]
fn l3_executes_immediately() {
    let p = policy(Level::L3);
    let d = detected();
    let (m, e) = Intervention::default().step(&p, Input::Verdict { v: &d, now_ms: 0 });
    assert_eq!(m.phase, Phase::Executing);
    assert_eq!(
        e,
        vec![
            Effect::Alert {
                phase: Phase::Executing,
                sound: true
            },
            Effect::SendMode("ALT_HOLD"),
            Effect::Record {
                phase: Phase::Executing
            },
        ]
    );
}

#[test]
fn quadplane_switches_to_qhover() {
    let p = policy(Level::L3);
    let d = verdict(TbState::Detected, Some("QHOVER"));
    let (_, e) = Intervention::default().step(&p, Input::Verdict { v: &d, now_ms: 0 });
    assert!(e.contains(&Effect::SendMode("QHOVER")));
}

#[test]
fn l1_alerts_only() {
    let p = policy(Level::L1);
    let d = detected();
    let (m, e) = Intervention::default().step(&p, Input::Verdict { v: &d, now_ms: 0 });
    assert_eq!(m.phase, Phase::Alerting);
    assert!(e.contains(&Effect::Alert {
        phase: Phase::Alerting,
        sound: true
    }));
    let (_, e) = drive(
        &p,
        m,
        vec![
            Input::Verdict { v: &d, now_ms: 100 },
            Input::Tick { now_ms: 5000 },
            Input::Tick { now_ms: 60_000 },
        ],
    );
    assert!(e.is_empty(), "{e:?}");
}

#[test]
fn l3_without_auto_ops_behaves_as_l1() {
    let p = Policy {
        auto_ops: false,
        ..policy(Level::L3)
    };
    assert_eq!(p.effective_level(), Level::L1);
    let d = detected();
    let (m, e) = drive(
        &p,
        Intervention::default(),
        vec![
            Input::Verdict { v: &d, now_ms: 0 },
            Input::Tick { now_ms: 10_000 },
        ],
    );
    assert_eq!((m.phase, sends(&e)), (Phase::Alerting, 0));
}

#[test]
fn disabled_gives_no_effects() {
    let p = Policy {
        enabled: false,
        ..policy(Level::L3)
    };
    assert_eq!(p.effective_level(), Level::L0);
    let d = detected();
    let (m, e) = Intervention::default().step(&p, Input::Verdict { v: &d, now_ms: 0 });
    assert_eq!((m.phase, e.len()), (Phase::Idle, 0));
}

#[test]
fn disable_during_the_countdown_cancels_it() {
    let p = policy(Level::L2);
    let off = Policy {
        enabled: false,
        ..p.clone()
    };
    let d = detected();
    let (m, e) = countdown(&p).step(&off, Input::PolicyChanged(&off));
    assert_eq!(m.phase, Phase::Cancelled);
    assert_eq!(m.by, "disabled");
    assert_eq!(sends(&e), 0);
    let (_, e) = drive(
        &off,
        m,
        vec![
            Input::Verdict { v: &d, now_ms: 4900 },
            Input::Tick { now_ms: 5000 },
        ],
    );
    assert_eq!(sends(&e), 0);
}

#[test]
fn refused_action_sets_the_latch() {
    let p = policy(Level::L3);
    let d = detected();
    let (m, e) = drive(
        &p,
        Intervention::default(),
        vec![
            Input::Verdict { v: &d, now_ms: 0 },
            Input::ActionResult {
                ok: false,
                now_ms: 3000,
            },
        ],
    );
    assert_eq!(m.phase, Phase::Refused);
    assert!(m.acted_this_flight && m.hands_off);
    assert!(e.contains(&Effect::Record {
        phase: Phase::Refused
    }));
    let c = clear();
    let (m, e) = drive(
        &p,
        m,
        vec![
            Input::Verdict {
                v: &c,
                now_ms: 20_000,
            },
            Input::Verdict {
                v: &d,
                now_ms: 40_000,
            },
        ],
    );
    assert_eq!(m.phase, Phase::Alerting);
    assert_eq!(sends(&e), 0);
}

#[test]
fn latch_survives_clear_and_re_detect() {
    let p = policy(Level::L2);
    let d = detected();
    let c = clear();
    let (m, e) = drive(
        &p,
        Intervention::default(),
        vec![
            Input::Verdict { v: &d, now_ms: 0 },
            Input::Verdict { v: &d, now_ms: 4900 },
            Input::Tick { now_ms: 5000 },
            Input::ActionResult {
                ok: true,
                now_ms: 5100,
            },
            Input::Takeover {
                why: TakeoverWhy::ModeChange,
                now_ms: 6000,
            },
            Input::Verdict {
                v: &c,
                now_ms: 30_000,
            },
        ],
    );
    assert_eq!(sends(&e), 1);
    assert_eq!(m.phase, Phase::Idle);
    assert!(e.contains(&Effect::Clear));
    let (m, e) = drive(
        &p,
        m,
        vec![
            Input::Verdict {
                v: &d,
                now_ms: 40_000,
            },
            Input::Verdict {
                v: &d,
                now_ms: 44_900,
            },
            Input::Tick { now_ms: 45_000 },
            Input::Tick { now_ms: 90_000 },
        ],
    );
    assert_eq!(m.phase, Phase::Alerting);
    assert_eq!(sends(&e), 0);
    assert!(e.contains(&Effect::Alert {
        phase: Phase::Alerting,
        sound: true
    }));
}

#[test]
fn disarmed_resets_the_latch_and_returns_to_idle() {
    let p = policy(Level::L3);
    let d = detected();
    let (m, _) = drive(
        &p,
        Intervention::default(),
        vec![
            Input::Verdict { v: &d, now_ms: 0 },
            Input::ActionResult {
                ok: true,
                now_ms: 100,
            },
        ],
    );
    let (m, e) = m.step(&p, Input::Disarmed);
    assert_eq!(m, Intervention::default());
    assert!(e.contains(&Effect::Clear));
    let (_, e) = m.step(
        &p,
        Input::Verdict {
            v: &d,
            now_ms: 100_000,
        },
    );
    assert_eq!(sends(&e), 1);
}

// ---- RcWatch -------------------------------------------------------------------------------

/// 50 Hz frames from `from` to `to` (inclusive) with ch1 = `ch1`, the rest centred.
fn frames(w: RcWatch, from: u64, to: u64, ch1: u16) -> RcWatch {
    (from..=to)
        .step_by(20)
        .fold(w, |w, t| w.push(t, [ch1, 1500, 1500, 1500]))
}

fn baseline_at_1500() -> RcWatch {
    frames(RcWatch::default(), 0, 2000, 1500).freeze_baseline(2000)
}

#[test]
fn rc_constant_sticks_are_not_moved() {
    let w = baseline_at_1500();
    assert_eq!(w.baseline(), Some([1500; 4]));
    let w = frames(w, 2020, 4000, 1500);
    assert!(!w.moved(4000, 60, 300));
    assert_eq!(w.centred(4000, 40), Some(true));
}

#[test]
fn rc_deviation_must_hold_for_the_hold_time() {
    let short = frames(baseline_at_1500(), 2020, 2220, 1580);
    assert!(!short.moved(2220, 60, 300));
    let long = frames(baseline_at_1500(), 2020, 2370, 1580);
    assert!(long.moved(2370, 60, 300));
    assert_eq!(long.centred(2370, 40), Some(false));
}

#[test]
fn rc_single_glitch_is_not_moved() {
    let w = baseline_at_1500().push(2020, [1700, 1500, 1500, 1500]);
    assert!(!w.moved(2020, 60, 300));
    let w = frames(w, 2040, 2600, 1500);
    assert!(!w.moved(2600, 60, 300));
}

#[test]
fn rc_baseline_is_the_median_of_the_last_second() {
    let w = frames(RcWatch::default(), 0, 1000, 1400);
    let w = frames(w, 1020, 2000, 1500).push(2000, [1900, 1500, 1500, 1500]);
    assert_eq!(w.freeze_baseline(2000).baseline(), Some([1500; 4]));
    let moved_off_1500 = frames(w.freeze_baseline(2000), 2020, 2400, 1440);
    assert!(moved_off_1500.moved(2400, 60, 300));
}

#[test]
fn rc_without_baseline_is_never_moved() {
    let w = frames(RcWatch::default(), 0, 1000, 1800);
    assert!(!w.moved(1000, 60, 300));
}

#[test]
fn rc_stale_after_two_seconds_without_frames() {
    let w = baseline_at_1500();
    assert!(!w.stale(3900));
    assert!(w.stale(4100));
    assert_eq!(w.centred(4100, 40), None);
    assert!(!w.moved(4100, 60, 300));
    assert!(RcWatch::default().stale(0));
    assert_eq!(RcWatch::default().centred(0, 40), None);
}

// ---- Decision records ----------------------------------------------------------------------

/// Runs the detector over `samples`, stopping at the first verdict that satisfies `stop`.
/// Without a stop it returns the raw verdict of the final window (no hold).
fn detector_at(samples: &[Sample], stop: impl Fn(&Verdict) -> bool) -> (ToiletBowlDetector, Verdict, u64) {
    let cfg = ToiletBowlConfig::default();
    let init = (ToiletBowlDetector::default(), None::<(Verdict, u64)>);
    let (det, hit) = samples.iter().fold(init, |(det, hit), s| match hit {
        Some(_) => (det, hit),
        None => {
            let (next, v) = det.push(s, &cfg);
            let hit = stop(&v).then_some((v, s.t_ms));
            (next, hit)
        }
    });
    let (v, ts) = hit.unwrap_or_else(|| {
        let ts = samples.last().map_or(0, |s| s.t_ms);
        (rgcs_guard::evaluate(&det.window(), &cfg), ts)
    });
    (det, v, ts)
}

fn record_of(det: &ToiletBowlDetector, verdict: Verdict, ts_ms: u64, phase: Phase) -> DecisionRecord {
    DecisionRecord {
        version: RECORD_VERSION,
        config: ToiletBowlConfig::default(),
        context: ExternalContext::default(),
        samples: det.window(),
        last_detected_ms: det.last_detected_ms(),
        verdict,
        phase,
        action: None,
        by: "ai-guard".into(),
        owner: OWNER_GCS.into(),
        ts_ms,
    }
}

#[test]
fn spiral_record_round_trips_and_replays_to_detected() {
    let (det, v, ts) = detector_at(&toilet_bowl(0.6), |v| v.state == TbState::Detected);
    let r = DecisionRecord {
        action: Some("ALT_HOLD".into()),
        ..record_of(&det, v.clone(), ts, Phase::Countdown)
    };
    assert!(r.samples.len() <= rgcs_guard::MAX_RECORD_SAMPLES);
    let json = serde_json::to_string(&r).expect("ser");
    let back: DecisionRecord = serde_json::from_str(&json).expect("de");
    assert_eq!(back, r);
    assert_eq!(back.owner, "gcs");
    assert_eq!(replay(&back).state, TbState::Detected);
    assert_eq!(replay(&back), v);
}

#[test]
fn wind_drift_record_replays_to_not_detected() {
    let samples = wind_drift();
    let (det, v, ts) = detector_at(&samples, |_| false);
    let r = record_of(&det, v, ts, Phase::Idle);
    assert_ne!(replay(&r).state, TbState::Detected);
}

#[test]
fn record_taken_in_the_clear_hold_replays_exactly() {
    let bowl = toilet_bowl(0.6);
    let end = bowl.last().cloned().expect("end");
    let hover = (1..=60).map(|i| Sample {
        t_ms: end.t_ms + i * 100,
        vn: 0.0,
        ve: 0.0,
        compass_var: Some(0.1),
        ekf_t_ms: Some((end.t_ms + i * 100) / 500 * 500),
        ..end.clone()
    });
    let all: Vec<Sample> = bowl.into_iter().chain(hover).collect();
    let (det, v, ts) = detector_at(&all, |_| false);
    let cfg = ToiletBowlConfig::default();
    let v = rgcs_guard::apply_hold(v, det.last_detected_ms(), ts, &cfg);
    assert_eq!(v.state, TbState::Suspect, "held");
    let r = record_of(&det, v.clone(), ts, Phase::Alerting);
    assert_eq!(replay(&r), v);
}

#[test]
fn replay_uses_the_recorded_external_context() {
    let samples = track(14.0, &spiral(2.0, 0.3, 2.0 * std::f64::consts::PI / 16.0), 0.6);
    let (det, _, ts) = detector_at(&samples, |_| false);
    let strong = ExternalContext {
        kp: Some(ExtLevel::Strong),
    };
    let cfg = rgcs_guard::effective(&ToiletBowlConfig::default(), &strong);
    let v = rgcs_guard::evaluate(&det.window(), &cfg);
    let r = DecisionRecord {
        context: strong,
        ..record_of(&det, v.clone(), ts, Phase::Alerting)
    };
    assert_eq!(replay(&r), v);
    assert_eq!(replay(&r).state, TbState::Detected);
}
