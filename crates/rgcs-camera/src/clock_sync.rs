//! Camera clock sync state machine, a port of the Python `time_sync.py`.
//! A pure value: `tick` returns the next state plus the wire actions for the driver to run.
//! Times are the driver's monotonic microseconds.

pub const RESYNC_US: u64 = 600_000_000;
pub const SAMPLE_MAX_AGE_US: u64 = 5_000_000;
pub const READBACK_TIMEOUT_US: u64 = 1_000_000;

/// A flight-controller UTC sample and the monotonic time it arrived.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct GpsSample {
    pub unix_us: u64,
    pub received_at_us: u64,
}

/// The sample's UTC advanced by the time since it was received.
pub fn current_unix_us(s: &GpsSample, now_us: u64) -> u64 {
    s.unix_us + now_us.saturating_sub(s.received_at_us)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ClockAction {
    /// Send 0x30 with this UTC (microseconds).
    SetUtc(u64),
    /// Send 0x40 to read the camera clock back.
    ReadBack,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct ClockStatus {
    pub last_sync_at_us: Option<u64>,
    pub ok: Option<bool>,
    pub offset_ms: Option<f32>,
    pub rtt_ms: Option<f32>,
    pub error: Option<&'static str>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ClockSync {
    pending: bool,
    was_connected: bool,
    readback: Option<(u64, GpsSample)>,
    status: ClockStatus,
}

impl Default for ClockSync {
    fn default() -> Self {
        Self::new()
    }
}

fn round1(v: f64) -> f32 {
    ((v * 10.0).round() / 10.0) as f32
}

impl ClockSync {
    pub fn new() -> Self {
        Self {
            pending: true,
            was_connected: true,
            readback: None,
            status: ClockStatus::default(),
        }
    }

    /// 今すぐ同期: sync on the next tick that has fresh GPS time.
    pub fn request(&self) -> Self {
        Self {
            pending: true,
            ..self.clone()
        }
    }

    pub fn status(&self) -> &ClockStatus {
        &self.status
    }

    pub fn tick(&self, now_us: u64, connected: bool, sample: Option<GpsSample>) -> (Self, Vec<ClockAction>) {
        let base = Self {
            pending: self.pending || (connected && !self.was_connected),
            was_connected: connected,
            ..self.clone()
        }
        .expire_readback(now_us);
        if !connected || base.readback.is_some() {
            return (base, vec![]);
        }
        let due = base.pending
            || base
                .status
                .last_sync_at_us
                .is_none_or(|t| now_us.saturating_sub(t) >= RESYNC_US);
        if !due {
            return (base, vec![]);
        }
        match sample {
            None => (base.with_error("no_gps_time"), vec![]),
            Some(s) if s.received_at_us > now_us || now_us - s.received_at_us > SAMPLE_MAX_AGE_US => {
                (base.with_error("gps_time_stale"), vec![])
            }
            Some(s) => {
                let next = Self {
                    pending: false,
                    readback: Some((now_us, s)),
                    status: ClockStatus {
                        last_sync_at_us: Some(now_us),
                        ok: Some(true),
                        ..ClockStatus::default()
                    },
                    ..base
                };
                let actions = vec![
                    ClockAction::SetUtc(current_unix_us(&s, now_us)),
                    ClockAction::ReadBack,
                ];
                (next, actions)
            }
        }
    }

    /// A 0x40 reply. Only a reply received after the sync was sent completes the read-back.
    pub fn on_camera_time(&self, camera_unix_us: u64, received_at_us: u64) -> Self {
        let Some((sent, s)) = self.readback else {
            return self.clone();
        };
        if received_at_us < sent {
            return self.clone();
        }
        let mid = sent + (received_at_us - sent) / 2;
        let diff = camera_unix_us as i128 - current_unix_us(&s, mid) as i128;
        Self {
            readback: None,
            status: ClockStatus {
                offset_ms: Some(round1(diff as f64 / 1000.0)),
                rtt_ms: Some(round1((received_at_us - sent) as f64 / 1000.0)),
                error: None,
                ..self.status.clone()
            },
            ..self.clone()
        }
    }

    /// A 0x30 reply. A rejected time fails the sync in flight (or just completed): no offset
    /// is shown as a success, and a later read-back does not clear the error.
    pub fn on_utc_ack(&self, accepted: bool) -> Self {
        if accepted || self.status.last_sync_at_us.is_none() {
            return self.clone();
        }
        Self {
            readback: None,
            status: ClockStatus {
                ok: Some(false),
                offset_ms: None,
                rtt_ms: None,
                error: Some("rejected"),
                ..self.status.clone()
            },
            ..self.clone()
        }
    }

    fn expire_readback(self, now_us: u64) -> Self {
        match self.readback {
            Some((sent, _)) if now_us.saturating_sub(sent) >= READBACK_TIMEOUT_US => Self {
                readback: None,
                status: ClockStatus {
                    offset_ms: None,
                    rtt_ms: None,
                    error: Some("no_readback"),
                    ..self.status
                },
                ..self
            },
            _ => self,
        }
    }

    fn with_error(self, code: &'static str) -> Self {
        Self {
            status: ClockStatus {
                error: Some(code),
                ..self.status
            },
            ..self
        }
    }
}

#[cfg(test)]
#[path = "clock_sync_tests.rs"]
mod tests;
