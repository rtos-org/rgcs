//! The three toilet-bowl signs over one window (plan fixed values).

use crate::geo::{enu, kasa_fit, wrap_deg};
use crate::sample::Sample;
use crate::toilet_bowl::{Signs, ToiletBowlConfig};

/// A GUIDED target counts as fixed while it stays within this distance of where it started.
const TARGET_FIXED_M: f64 = 1.0;
/// "Keeps rotating": at least this share of the last second's samples must still be moving.
const ONGOING_MOVING_FRAC: f32 = 0.5;
const LAST_SECOND_MS: u64 = 1_000;

fn speed(s: &Sample) -> f32 {
    s.vn.hypot(s.ve)
}

fn course(s: &Sample) -> f32 {
    s.ve.atan2(s.vn).to_degrees()
}

fn now_ms(w: &[Sample]) -> u64 {
    w.last().map_or(0, |s| s.t_ms)
}

fn last_second(w: &[Sample]) -> impl Iterator<Item = &Sample> {
    let from = now_ms(w).saturating_sub(LAST_SECOND_MS);
    w.iter().filter(move |s| s.t_ms >= from)
}

/// (|Σ| degrees, consistency) over the steps whose both ends move at ≥ `min_speed_mps`.
fn rotation(w: &[Sample], cfg: &ToiletBowlConfig) -> (f32, f32) {
    let steps: Vec<f32> = w
        .windows(2)
        .filter(|p| speed(&p[0]) >= cfg.min_speed_mps && speed(&p[1]) >= cfg.min_speed_mps)
        .map(|p| wrap_deg(course(&p[1]) - course(&p[0])))
        .collect();
    if steps.is_empty() {
        return (0.0, 0.0);
    }
    let sigma: f32 = steps.iter().sum();
    let same = steps
        .iter()
        .filter(|d| **d != 0.0 && d.signum() == sigma.signum())
        .count();
    (sigma.abs(), same as f32 / steps.len() as f32)
}

fn local_points(w: &[Sample]) -> Vec<(f64, f64)> {
    let Some(first) = w.first() else { return Vec::new() };
    w.iter()
        .map(|s| enu(first.lat, first.lon, s.lat, s.lon))
        .map(|p| (p.e, p.n))
        .collect()
}

fn mid_s(w: &[Sample]) -> f64 {
    let (a, b) = (w.first().map_or(0, |s| s.t_ms), w.last().map_or(0, |s| s.t_ms));
    (a + b) as f64 / 2000.0
}

/// (mean radius over the last second, radius growth m/s), zeros without a fit.
///
/// A Kåsa circle is fitted to each half of the window ("the radius of the circle fitted to the
/// track is increasing"); growth = Δr / Δt between the halves' mid-times. One fit
/// over the whole window would absorb the growth whenever the window covers less than a full
/// turn (a 0.3 m/s spiral over 225° reads 0.01 m/s that way).
fn spiral(w: &[Sample]) -> (f32, f32) {
    let pts = local_points(w);
    let half = w.len() / 2;
    let (early, late) = (kasa_fit(&pts[..half]), kasa_fit(&pts[half..]));
    let (Some(early), Some(late)) = (early, late) else {
        return (0.0, 0.0);
    };
    let dt = mid_s(&w[half..]) - mid_s(&w[..half]);
    let growth = if dt > 0.0 { (late.r - early.r) / dt } else { 0.0 };
    let from = now_ms(w).saturating_sub(LAST_SECOND_MS);
    let recent: Vec<f64> = w
        .iter()
        .zip(&pts)
        .filter(|(s, _)| s.t_ms >= from)
        .map(|(_, (x, y))| (x - late.cx).hypot(y - late.cy))
        .collect();
    let radius = recent.iter().sum::<f64>() / recent.len().max(1) as f64;
    (radius as f32, growth as f32)
}

fn guided_target_fixed(w: &[Sample]) -> bool {
    let Some(Some((lat0, lon0))) = w.first().map(|s| s.target) else {
        return false;
    };
    w.iter().all(|s| {
        s.target.is_some_and(|(lat, lon)| {
            let p = enu(lat0, lon0, lat, lon);
            p.e.hypot(p.n) < TARGET_FIXED_M
        })
    })
}

/// The target-fixed gate of sign A for the window's mode.
fn target_fixed(w: &[Sample]) -> bool {
    match w.last().map(|s| s.mode.as_str()) {
        Some("GUIDED") => guided_target_fixed(w),
        Some("AUTO") => {
            let seq = w.first().and_then(|s| s.mission_seq);
            seq.is_some() && w.iter().all(|s| s.mission_seq == seq)
        }
        Some(_) => w.iter().all(|s| s.sticks_centred != Some(false)),
        None => false,
    }
}

fn ongoing(w: &[Sample], cfg: &ToiletBowlConfig) -> bool {
    let (moving, total) = last_second(w).fold((0usize, 0usize), |(m, t), s| {
        (m + usize::from(speed(s) >= cfg.min_speed_mps), t + 1)
    });
    total > 0 && moving as f32 / total as f32 >= ONGOING_MOVING_FRAC
}

/// Share of the moving samples whose heading is off the course by ≥ `heading_course_deg`.
fn heading_course_frac(w: &[Sample], cfg: &ToiletBowlConfig) -> f32 {
    let offs: Vec<f32> = w
        .iter()
        .filter(|s| speed(s) >= cfg.min_speed_mps)
        .filter_map(|s| s.hdg.map(|h| wrap_deg(h - course(s)).abs()))
        .collect();
    if offs.is_empty() {
        return 0.0;
    }
    offs.iter().filter(|d| **d >= cfg.heading_course_deg).count() as f32 / offs.len() as f32
}

/// Sign C: every distinct EKF report of the last `compass_hold_ms` (at least 2) is over the limit.
fn compass_high(w: &[Sample], cfg: &ToiletBowlConfig) -> bool {
    let from = now_ms(w).saturating_sub(cfg.compass_hold_ms);
    // Every sample repeats the latest report, so one report shows up as a run of samples.
    let mut reports: Vec<(u64, f32)> = w
        .iter()
        .filter_map(|s| s.ekf_t_ms.zip(s.compass_var))
        .filter(|(t, _)| *t >= from)
        .collect();
    reports.dedup_by_key(|r| r.0);
    reports.len() >= 2 && reports.iter().all(|(_, v)| *v >= cfg.compass_var)
}

/// All signs for a ready window (oldest first, one monitored mode).
pub(crate) fn compute(w: &[Sample], cfg: &ToiletBowlConfig) -> Signs {
    let (turn_deg, consistency) = rotation(w, cfg);
    let (radius_m, growth_mps) = spiral(w);
    let fixed = target_fixed(w);
    let rotating = turn_deg >= cfg.min_turn_deg && consistency >= cfg.turn_consistency;
    let growing = growth_mps >= cfg.min_radius_growth_mps && radius_m >= cfg.min_radius_m;
    let hc = heading_course_frac(w, cfg);
    Signs {
        a: fixed && rotating && growing && ongoing(w, cfg),
        b: hc > 0.0 && hc >= cfg.heading_course_frac,
        c: compass_high(w, cfg),
        turn_deg,
        consistency,
        radius_m,
        growth_mps,
        heading_course_frac: hc,
        compass_var: w.last().and_then(|s| s.compass_var),
        target_fixed: fixed,
    }
}
