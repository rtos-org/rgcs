//! One telemetry point fed to the detectors, and the monitored-mode gate.

use serde::{Deserialize, Serialize};

/// Airframe class as far as the guard cares: which modes are monitored and which mode it
/// would switch to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Airframe {
    Copter,
    QuadPlane,
    Other,
}

/// One 10 Hz telemetry point (one per `GLOBAL_POSITION_INT`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Sample {
    pub t_ms: u64,
    pub lat: f64,
    pub lon: f64,
    /// m/s north, from `GLOBAL_POSITION_INT.vx`.
    pub vn: f32,
    /// m/s east, from `GLOBAL_POSITION_INT.vy`.
    pub ve: f32,
    /// Heading in degrees.
    pub hdg: Option<f32>,
    /// Latest `EKF_STATUS_REPORT.compass_variance`; `None` if never seen.
    pub compass_var: Option<f32>,
    /// Arrival time of that EKF report (same clock as `t_ms`).
    pub ekf_t_ms: Option<u64>,
    pub airframe: Airframe,
    pub mode: String,
    pub armed: bool,
    /// `EXTENDED_SYS_STATE.vtol_state == MC`.
    pub vtol_mc: bool,
    /// GUIDED target (lat, lon).
    pub target: Option<(f64, f64)>,
    pub mission_seq: Option<u16>,
    /// Distance to the active waypoint in metres.
    pub wp_dist: Option<u32>,
    /// `None` = no RC stream.
    pub sticks_centred: Option<bool>,
}

/// Whether this single sample is in a monitored mode (armed, airframe-specific mode list).
/// The AUTO 「WP 待機」 proxy (`wp_dist` at the window start) is checked over the window by
/// [`crate::evaluate`].
pub fn monitored(s: &Sample) -> bool {
    if !s.armed {
        return false;
    }
    match s.airframe {
        Airframe::Copter => matches!(s.mode.as_str(), "LOITER" | "POSHOLD" | "GUIDED" | "AUTO"),
        Airframe::QuadPlane => s.mode == "QLOITER" || (s.mode == "GUIDED" && s.vtol_mc),
        Airframe::Other => false,
    }
}

/// The no-position-hold mode the guard would switch this airframe to.
pub fn recommended_mode(airframe: Airframe) -> Option<&'static str> {
    match airframe {
        Airframe::Copter => Some("ALT_HOLD"),
        Airframe::QuadPlane => Some("QHOVER"),
        Airframe::Other => None,
    }
}
