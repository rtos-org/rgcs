//! Pilot takeover from RC sticks (fixed values: Takeover).
//!
//! The caller maps `RC_CHANNELS` into `[roll, pitch, throttle, yaw]` (ch 1–4, or the
//! `RCMAP_*` channels when cached) and pushes one frame per message. At alert time it freezes
//! the baseline (the median of the last second), then asks [`RcWatch::moved`] on every frame.

use std::collections::VecDeque;

/// Frames older than this are dropped (bounds memory; a hold longer than this never fires).
const RETAIN_MS: u64 = 5_000;
/// The baseline is the median of this much history before the alert.
const BASELINE_MS: u64 = 1_000;
/// No frame for longer than this means "RC not received".
const STALE_MS: u64 = 2_000;
const CENTRE_US: u16 = 1500;

#[derive(Debug, Clone, Default, PartialEq)]
pub struct RcWatch {
    frames: VecDeque<(u64, [u16; 4])>,
    baseline: Option<[u16; 4]>,
}

impl RcWatch {
    /// Adds one frame. A frame older than the newest one restarts the history (clock reset).
    pub fn push(&self, t_ms: u64, sticks: [u16; 4]) -> Self {
        let restart = self.frames.back().is_some_and(|&(last, _)| t_ms < last);
        let kept = self
            .frames
            .iter()
            .filter(|&&(t, _)| !restart && t + RETAIN_MS >= t_ms)
            .copied();
        Self {
            frames: kept.chain(std::iter::once((t_ms, sticks))).collect(),
            baseline: self.baseline,
        }
    }

    /// Per-channel median of the frames in the last second before `now_ms` (`None` without
    /// frames there).
    pub fn freeze_baseline(&self, now_ms: u64) -> Self {
        let recent: Vec<[u16; 4]> = self
            .frames
            .iter()
            .filter(|&&(t, _)| t <= now_ms && t + BASELINE_MS >= now_ms)
            .map(|&(_, s)| s)
            .collect();
        let baseline = (!recent.is_empty()).then(|| std::array::from_fn(|ch| median(&recent, ch)));
        Self {
            frames: self.frames.clone(),
            baseline,
        }
    }

    pub fn baseline(&self) -> Option<[u16; 4]> {
        self.baseline
    }

    /// True when every frame of the trailing run that deviates (any stick ≥ `dev_us` from the
    /// baseline) spans at least `hold_ms` up to `now_ms`. A single glitch never counts, and
    /// neither does anything without a baseline or with a stale stream.
    pub fn moved(&self, now_ms: u64, dev_us: u16, hold_ms: u64) -> bool {
        let Some(base) = self.baseline else {
            return false;
        };
        if self.stale(now_ms) {
            return false;
        }
        let deviates = |s: &[u16; 4]| s.iter().zip(base).any(|(&v, b)| v.abs_diff(b) >= dev_us);
        let run_start = self
            .frames
            .iter()
            .rev()
            .take_while(|(_, s)| deviates(s))
            .last()
            .map(|&(t, _)| t);
        run_start.is_some_and(|t| now_ms.saturating_sub(t) >= hold_ms)
    }

    /// More than 2 s since the last frame (or never a frame).
    pub fn stale(&self, now_ms: u64) -> bool {
        self.frames
            .back()
            .is_none_or(|&(t, _)| now_ms.saturating_sub(t) > STALE_MS)
    }

    /// Whether every stick of the latest frame is within `tol_us` of 1500; `None` when stale.
    /// (Takes `now_ms` because the crate has no clock.)
    pub fn centred(&self, now_ms: u64, tol_us: u16) -> Option<bool> {
        if self.stale(now_ms) {
            return None;
        }
        self.frames
            .back()
            .map(|(_, s)| s.iter().all(|v| v.abs_diff(CENTRE_US) <= tol_us))
    }
}

fn median(frames: &[[u16; 4]], ch: usize) -> u16 {
    let mut v: Vec<u16> = frames.iter().map(|s| s[ch]).collect();
    v.sort_unstable();
    v[v.len() / 2]
}
