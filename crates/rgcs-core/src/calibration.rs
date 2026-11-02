//! 点検・校正: one calibration session per vehicle at a time, driven by
//! the flight controller's replies. The session is a plain value; the server feeds it frames
//! and broadcasts every new state.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// What is being calibrated / tested; also the key of the last-run record.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, rename_all = "snake_case")]
pub enum CalibKind {
    Accel,
    Compass,
    Level,
    Rc,
    Esc,
    Motor,
}

impl CalibKind {
    pub const ALL: [CalibKind; 6] = [
        Self::Accel,
        Self::Compass,
        Self::Level,
        Self::Rc,
        Self::Esc,
        Self::Motor,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            Self::Accel => "accel",
            Self::Compass => "compass",
            Self::Level => "level",
            Self::Rc => "rc",
            Self::Esc => "esc",
            Self::Motor => "motor",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|k| k.as_str() == s)
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, rename_all = "snake_case")]
pub enum CalibPhase {
    /// Sent; waiting for the vehicle.
    Running,
    /// Accelerometer: the vehicle asks for `position`; the operator places it and confirms.
    Waiting,
    Done,
    Failed,
    Cancelled,
}

/// One compass during an onboard compass calibration (MAG_CAL_PROGRESS / MAG_CAL_REPORT).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CompassProgress {
    pub id: u8,
    pub pct: u8,
    /// Final `MAG_CAL_STATUS` (4 success, 5 failed, 6 bad orientation, 7 bad radius), once reported.
    pub status: Option<u8>,
    pub fitness: Option<f32>,
}

/// One RC input channel during an RC calibration (µs).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct RcRange {
    pub min: u16,
    pub max: u16,
    pub value: u16,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CalibStatus {
    pub kind: CalibKind,
    pub phase: CalibPhase,
    /// Accelerometer: the requested `ACCELCAL_VEHICLE_POS` (1 level … 6 on its back).
    pub position: Option<u8>,
    pub compass: Vec<CompassProgress>,
    pub rc: Vec<RcRange>,
    /// The new calibration is used only after a reboot (compass).
    pub reboot: bool,
    pub reason: Option<String>,
}

/// The latest run of one kind (`GET …/calibration`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CalibRecord {
    pub kind: CalibKind,
    pub ok: bool,
    #[ts(type = "number")]
    pub at: u64,
    pub operator: String,
    pub detail: Option<String>,
}

/// What the flight controller says during a calibration (decoded by `rgcs-mavlink`).
#[derive(Debug, Clone, PartialEq)]
pub enum CalibFrame {
    /// `COMMAND_LONG(MAV_CMD_ACCELCAL_VEHICLE_POS)` sent by the vehicle: param1.
    AccelPos(u32),
    MagProgress {
        id: u8,
        pct: u8,
    },
    MagReport {
        id: u8,
        status: u8,
        fitness: f32,
    },
    /// `RC_CHANNELS`: the first `chancount` raw values.
    RcChannels(Vec<u16>),
}

pub const ACCELCAL_SUCCESS: u32 = 16_777_215;
pub const ACCELCAL_FAILED: u32 = 16_777_216;
pub const MAG_CAL_SUCCESS: u8 = 4;
/// An RC channel counts as calibrated when the sticks swept at least this far (µs).
pub const RC_MIN_SWEEP: u16 = 400;

impl CalibStatus {
    pub fn start(kind: CalibKind) -> Self {
        Self {
            kind,
            phase: CalibPhase::Running,
            position: None,
            compass: Vec::new(),
            rc: Vec::new(),
            reboot: false,
            reason: None,
        }
    }

    pub fn is_active(&self) -> bool {
        matches!(self.phase, CalibPhase::Running | CalibPhase::Waiting)
    }

    pub fn with_phase(self, phase: CalibPhase, reason: Option<String>) -> Self {
        Self {
            phase,
            reason,
            ..self
        }
    }

    /// The next state for a frame, or `None` when the frame does not concern this session.
    pub fn on_frame(&self, frame: &CalibFrame) -> Option<Self> {
        if !self.is_active() {
            return None;
        }
        match (self.kind, frame) {
            (CalibKind::Accel, CalibFrame::AccelPos(p)) => Some(self.accel(*p)),
            (CalibKind::Compass, CalibFrame::MagProgress { id, pct }) => {
                Some(self.compass_entry(*id, |c| CompassProgress { pct: *pct, ..c }))
            }
            (CalibKind::Compass, CalibFrame::MagReport { id, status, fitness }) => Some(
                self.compass_entry(*id, |c| CompassProgress {
                    pct: if *status == MAG_CAL_SUCCESS { 100 } else { c.pct },
                    status: Some(*status),
                    fitness: Some(*fitness),
                    ..c
                })
                .compass_verdict(),
            ),
            (CalibKind::Rc, CalibFrame::RcChannels(values)) => Some(self.rc_sample(values)),
            _ => None,
        }
    }

    fn accel(&self, p: u32) -> Self {
        match p {
            ACCELCAL_SUCCESS => self.clone().with_phase(CalibPhase::Done, None),
            ACCELCAL_FAILED => self
                .clone()
                .with_phase(CalibPhase::Failed, Some("accelcal_failed".into())),
            1..=6 => Self {
                phase: CalibPhase::Waiting,
                position: Some(p as u8),
                ..self.clone()
            },
            _ => self.clone(),
        }
    }

    fn compass_entry(&self, id: u8, f: impl FnOnce(CompassProgress) -> CompassProgress) -> Self {
        let blank = CompassProgress {
            id,
            pct: 0,
            status: None,
            fitness: None,
        };
        let current = self.compass.iter().find(|c| c.id == id).cloned().unwrap_or(blank);
        let next = f(current);
        let mut compass: Vec<CompassProgress> = self
            .compass
            .iter()
            .filter(|c| c.id != id)
            .cloned()
            .chain([next])
            .collect();
        compass.sort_by_key(|c| c.id);
        Self {
            compass,
            ..self.clone()
        }
    }

    /// Done when every compass seen so far reported success; failed as soon as one reports anything else.
    fn compass_verdict(self) -> Self {
        if self
            .compass
            .iter()
            .any(|c| c.status.is_some_and(|s| s != MAG_CAL_SUCCESS))
        {
            return self.with_phase(CalibPhase::Failed, Some("compass_failed".into()));
        }
        if self.compass.iter().all(|c| c.status == Some(MAG_CAL_SUCCESS)) {
            return Self {
                reboot: true,
                ..self.with_phase(CalibPhase::Done, None)
            };
        }
        self
    }

    fn rc_sample(&self, values: &[u16]) -> Self {
        let rc = values
            .iter()
            .enumerate()
            .map(|(i, &v)| match self.rc.get(i) {
                // 0 / 65535 = channel not present
                _ if v == 0 || v == u16::MAX => RcRange {
                    min: 0,
                    max: 0,
                    value: 0,
                },
                Some(r) if r.max > 0 => RcRange {
                    min: r.min.min(v),
                    max: r.max.max(v),
                    value: v,
                },
                _ => RcRange {
                    min: v,
                    max: v,
                    value: v,
                },
            })
            .collect();
        Self { rc, ..self.clone() }
    }

    /// RC parameters to write at the end: `(channel 1-based, min, max, trim)` for every channel
    /// whose sweep reached [`RC_MIN_SWEEP`]; trim is where the stick rests now.
    pub fn rc_result(&self) -> Vec<(usize, u16, u16, u16)> {
        self.rc
            .iter()
            .enumerate()
            .filter(|(_, r)| r.max.saturating_sub(r.min) >= RC_MIN_SWEEP)
            .map(|(i, r)| (i + 1, r.min, r.max, r.value.clamp(r.min, r.max)))
            .collect()
    }
}

#[cfg(test)]
#[path = "calibration_tests.rs"]
mod tests;
