//! Toilet-bowl detector: verdict = A && (B || C).
//!
//! [`evaluate`] is the single source of truth over a window; [`ToiletBowlDetector::push`] only
//! maintains the window and the clear hold ([`apply_hold`]).

use std::collections::VecDeque;

use serde::{Deserialize, Serialize};

use crate::sample::{monitored, recommended_mode, Sample};
use crate::signs;

/// The AUTO 「WP 待機」 proxy: the window must start within this distance of the waypoint.
const AUTO_WP_DIST_M: u32 = 3;
const SUSPECT_CONFIDENCE: f32 = 0.3;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct ToiletBowlConfig {
    pub window_ms: u64,
    pub min_samples: usize,
    pub min_speed_mps: f32,
    pub min_turn_deg: f32,
    pub turn_consistency: f32,
    pub min_radius_growth_mps: f32,
    pub min_radius_m: f32,
    pub heading_course_deg: f32,
    pub heading_course_frac: f32,
    pub compass_var: f32,
    pub compass_hold_ms: u64,
    pub clear_ms: u64,
}

impl Default for ToiletBowlConfig {
    fn default() -> Self {
        Self {
            window_ms: 10_000,
            min_samples: 80,
            min_speed_mps: 0.8,
            min_turn_deg: 270.0,
            turn_consistency: 0.8,
            min_radius_growth_mps: 0.05,
            min_radius_m: 1.5,
            heading_course_deg: 45.0,
            heading_course_frac: 0.6,
            compass_var: 0.5,
            compass_hold_ms: 2_000,
            clear_ms: 15_000,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TbState {
    NotMonitored,
    Clear,
    Suspect,
    Detected,
}

/// The measured values behind a verdict (kept in decision records).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Signs {
    pub a: bool,
    pub b: bool,
    pub c: bool,
    /// |Σ wrapped course change| over the moving steps, degrees.
    pub turn_deg: f32,
    /// Share of the moving steps that turn the same way as Σ.
    pub consistency: f32,
    /// Mean distance to the fitted centre over the last second, metres (0 without a fit).
    pub radius_m: f32,
    /// Slope of the distance to the fitted centre over time, m/s (0 without a fit).
    pub growth_mps: f32,
    pub heading_course_frac: f32,
    pub compass_var: Option<f32>,
    pub target_fixed: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Verdict {
    pub state: TbState,
    pub confidence: f32,
    pub signs: Option<Signs>,
    pub recommended_mode: Option<&'static str>,
}

/// Owned form for deserializing stored records (a `&'static str` cannot borrow from them).
#[derive(Deserialize)]
struct VerdictWire {
    state: TbState,
    confidence: f32,
    signs: Option<Signs>,
    recommended_mode: Option<String>,
}

impl<'de> Deserialize<'de> for Verdict {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let w = VerdictWire::deserialize(d)?;
        let recommended_mode = w.recommended_mode.and_then(|m| match m.as_str() {
            "ALT_HOLD" => Some("ALT_HOLD"),
            "QHOVER" => Some("QHOVER"),
            _ => None,
        });
        Ok(Self {
            state: w.state,
            confidence: w.confidence,
            signs: w.signs,
            recommended_mode,
        })
    }
}

/// Per-vehicle detector: a time-trimmed window plus the time of the last raw detection.
#[derive(Debug, Clone, Default)]
pub struct ToiletBowlDetector {
    window: VecDeque<Sample>,
    last_detected_ms: Option<u64>,
}

impl ToiletBowlDetector {
    /// Adds one sample. A non-monitored sample, a mode change or time going backwards starts
    /// a fresh window (and forgets the last detection).
    pub fn push(&self, s: &Sample, cfg: &ToiletBowlConfig) -> (Self, Verdict) {
        if !monitored(s) {
            return (Self::default(), not_monitored());
        }
        let continues = self
            .window
            .back()
            .is_some_and(|last| last.mode == s.mode && last.t_ms <= s.t_ms);
        let base = if continues { self.clone() } else { Self::default() };
        let window: Vec<Sample> = base
            .window
            .iter()
            .filter(|old| old.t_ms + cfg.window_ms >= s.t_ms)
            .cloned()
            .chain(std::iter::once(s.clone()))
            .collect();
        let raw = evaluate(&window, cfg);
        let last_detected_ms = if raw.state == TbState::Detected {
            Some(s.t_ms)
        } else {
            base.last_detected_ms
        };
        let verdict = apply_hold(raw, last_detected_ms, s.t_ms, cfg);
        (
            Self {
                window: VecDeque::from(window),
                last_detected_ms,
            },
            verdict,
        )
    }

    pub fn window(&self) -> Vec<Sample> {
        self.window.iter().cloned().collect()
    }

    /// Time of the last raw `Detected` from [`evaluate`] (input to [`apply_hold`]).
    pub fn last_detected_ms(&self) -> Option<u64> {
        self.last_detected_ms
    }
}

fn not_monitored() -> Verdict {
    Verdict {
        state: TbState::NotMonitored,
        confidence: 0.0,
        signs: None,
        recommended_mode: None,
    }
}

/// Pure core used by `push` and replay: the verdict for one window (oldest sample first).
///
/// Only the trailing run of monitored samples in the latest sample's mode, within `window_ms`
/// of it, is used. It is judged once it holds ≥ `min_samples` samples spanning ≥ 90 % of
/// `window_ms` (9 s by default); before that it is `Clear` without signs.
pub fn evaluate(window: &[Sample], cfg: &ToiletBowlConfig) -> Verdict {
    let Some(latest) = window.last().filter(|s| monitored(s)) else {
        return not_monitored();
    };
    let start = window
        .iter()
        .rposition(|s| !monitored(s) || s.mode != latest.mode || s.t_ms + cfg.window_ms < latest.t_ms)
        .map_or(0, |i| i + 1);
    let w = &window[start..];
    if latest.mode == "AUTO" && !w[0].wp_dist.is_some_and(|d| d <= AUTO_WP_DIST_M) {
        return not_monitored();
    }
    let span = latest.t_ms - w[0].t_ms;
    if w.len() < cfg.min_samples || span * 10 < cfg.window_ms * 9 {
        return Verdict {
            state: TbState::Clear,
            ..not_monitored()
        };
    }
    let signs = signs::compute(w, cfg);
    let (state, confidence) = match (signs.a, signs.b, signs.c) {
        (true, true, true) => (TbState::Detected, 1.0),
        (true, true, false) | (true, false, true) => (TbState::Detected, 0.7),
        (true, false, false) => (TbState::Suspect, SUSPECT_CONFIDENCE),
        _ => (TbState::Clear, 0.0),
    };
    let recommended_mode = if state == TbState::Detected {
        recommended_mode(latest.airframe)
    } else {
        None
    };
    Verdict {
        state,
        confidence,
        signs: Some(signs),
        recommended_mode,
    }
}

/// The clear hold: within `clear_ms` of the last raw detection a raw `Clear` is reported as
/// `Suspect`, so `Clear` means "15 s without `Detected`".
pub fn apply_hold(
    raw: Verdict,
    last_detected_ms: Option<u64>,
    now_ms: u64,
    cfg: &ToiletBowlConfig,
) -> Verdict {
    let held = last_detected_ms.is_some_and(|t| now_ms.saturating_sub(t) < cfg.clear_ms);
    if raw.state == TbState::Clear && held {
        Verdict {
            state: TbState::Suspect,
            ..raw
        }
    } else {
        raw
    }
}
