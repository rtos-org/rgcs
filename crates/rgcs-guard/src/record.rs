//! Replayable decision records.

use serde::{Deserialize, Serialize};

use crate::intervention::Phase;
use crate::sample::Sample;
use crate::sensitivity::{effective, ExternalContext};
use crate::toilet_bowl::{apply_hold, evaluate, ToiletBowlConfig, Verdict};

pub const RECORD_VERSION: u32 = 1;
/// Who owns the decision; always the GCS in v1.
pub const OWNER_GCS: &str = "gcs";
/// The most samples a record keeps (the 10 s window at 10 Hz is ~101).
pub const MAX_RECORD_SAMPLES: usize = 120;

/// One row per phase change: everything needed to re-run the verdict.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DecisionRecord {
    pub version: u32,
    /// The admin's base config; the effective one is re-derived with `context`.
    pub config: ToiletBowlConfig,
    pub context: ExternalContext,
    /// The detector window, oldest first (≤ [`MAX_RECORD_SAMPLES`]).
    pub samples: Vec<Sample>,
    /// [`crate::ToiletBowlDetector::last_detected_ms`] at record time, so the clear hold
    /// replays exactly.
    #[serde(default)]
    pub last_detected_ms: Option<u64>,
    pub verdict: Verdict,
    pub phase: Phase,
    /// The mode sent, if any (`"ALT_HOLD"` / `"QHOVER"`).
    pub action: Option<String>,
    /// `ai-guard`, a username, `disabled`, or the takeover source.
    pub by: String,
    pub owner: String,
    pub ts_ms: u64,
}

/// Re-runs the detector on the record: the same result `ToiletBowlDetector::push` gave for the
/// window's last sample. The hold is evaluated at that sample's time (`ts_ms` when empty).
pub fn replay(r: &DecisionRecord) -> Verdict {
    let cfg = effective(&r.config, &r.context);
    let now_ms = r.samples.last().map_or(r.ts_ms, |s| s.t_ms);
    apply_hold(evaluate(&r.samples, &cfg), r.last_detected_ms, now_ms, &cfg)
}
