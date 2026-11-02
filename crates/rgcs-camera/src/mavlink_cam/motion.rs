//! ArduPilot treats any `GIMBAL_MANAGER_SET_PITCHYAW` rate frame, zeros
//! included, as "MAVLink targeting" and drops mission / RC / ROI pointing. So a rate-0 frame
//! goes out only when it actually stops something: while a non-zero rate is in effect, or
//! within `ZERO_REPEAT_MS` of the last one (so a lost stop can be repeated).

use rgcs_core::CameraCommand;
use tokio::time::Instant;

pub const ZERO_REPEAT_MS: u64 = 2_000;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Motion {
    moving: bool,
    last_nonzero: Option<Instant>,
}

impl Motion {
    /// The next state and whether `cmd` should be sent.
    pub fn admit(&self, cmd: &CameraCommand, now: Instant) -> (Self, bool) {
        match cmd {
            CameraCommand::GimbalRate { yaw: 0, pitch: 0 } => {
                let recent = self.last_nonzero.is_some_and(|t| {
                    now.saturating_duration_since(t).as_millis() < u128::from(ZERO_REPEAT_MS)
                });
                let send = self.moving || recent;
                (
                    Self {
                        moving: false,
                        ..*self
                    },
                    send,
                )
            }
            CameraCommand::GimbalRate { .. } => (
                Self {
                    moving: true,
                    last_nonzero: Some(now),
                },
                true,
            ),
            CameraCommand::GimbalAngle { .. } | CameraCommand::GimbalCenter { .. } => (Self::default(), true),
            _ => (*self, true),
        }
    }

    /// An ROI start / stop replaced any rate targeting.
    pub fn pointed() -> Self {
        Self::default()
    }
}
