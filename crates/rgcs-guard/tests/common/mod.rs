//! Shared synthetic 10 Hz trajectories (detector tests and decision records).
#![allow(dead_code)]

use rgcs_guard::{Airframe, Sample, ToiletBowlConfig, ToiletBowlDetector, Verdict};
use std::f64::consts::PI;

pub const HOME: (f64, f64) = (36.2509, 137.6385);
const R: f64 = 6_371_008.8;

/// Position (east, north) and velocity (ve, vn) at time `t` seconds.
pub type Motion = dyn Fn(f64) -> (f64, f64, f64, f64);

pub fn latlon(e: f64, n: f64) -> (f64, f64) {
    let lat = HOME.0 + (n / R).to_degrees();
    let lon = HOME.1 + (e / (R * HOME.0.to_radians().cos())).to_degrees();
    (lat, lon)
}

pub fn spiral(r0: f64, growth: f64, omega: f64) -> Box<Motion> {
    Box::new(move |t| {
        let (r, th) = (r0 + growth * t, omega * t);
        let ve = growth * th.cos() - r * omega * th.sin();
        let vn = growth * th.sin() + r * omega * th.cos();
        (r * th.cos(), r * th.sin(), ve, vn)
    })
}

/// Copter, LOITER, armed, sticks centred, EKF reports at 2 Hz, heading fixed 0°.
pub fn track(secs: f64, motion: &Motion, compass_var: f32) -> Vec<Sample> {
    let n = (secs * 10.0).round() as u64;
    (0..=n)
        .map(|i| {
            let t_ms = i * 100;
            let (e, nn, ve, vn) = motion(t_ms as f64 / 1000.0);
            let (lat, lon) = latlon(e, nn);
            Sample {
                t_ms,
                lat,
                lon,
                vn: vn as f32,
                ve: ve as f32,
                hdg: Some(0.0),
                compass_var: Some(compass_var),
                ekf_t_ms: Some(t_ms / 500 * 500),
                airframe: Airframe::Copter,
                mode: "LOITER".into(),
                armed: true,
                vtol_mc: false,
                target: None,
                mission_seq: None,
                wp_dist: None,
                sticks_centred: Some(true),
            }
        })
        .collect()
}

pub fn toilet_bowl(compass_var: f32) -> Vec<Sample> {
    track(14.0, &spiral(2.0, 0.3, 2.0 * PI / 8.0), compass_var)
}

pub fn run_with(samples: &[Sample], cfg: &ToiletBowlConfig) -> Vec<Verdict> {
    samples
        .iter()
        .scan(ToiletBowlDetector::default(), |det, s| {
            let (next, v) = det.push(s, cfg);
            *det = next;
            Some(v)
        })
        .collect()
}

pub fn run(samples: &[Sample]) -> Vec<Verdict> {
    run_with(samples, &ToiletBowlConfig::default())
}

pub fn wind_drift() -> Vec<Sample> {
    track(14.0, &|t| (2.0 * t, 0.0, 2.0, 0.0), 0.6)
}
