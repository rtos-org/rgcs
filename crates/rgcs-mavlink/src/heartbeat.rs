//! Link health from the age of the last HEARTBEAT: 3 s → delay, 10 s → lost.

use mavlink::dialects::ardupilotmega::MavAutopilot;
use rgcs_core::LinkStatus;

pub const DELAY_MS: u64 = 3_000;
pub const LOST_MS: u64 = 10_000;

pub fn link_status(age_ms: u64) -> LinkStatus {
    if age_ms >= LOST_MS {
        LinkStatus::Lost
    } else if age_ms >= DELAY_MS {
        LinkStatus::Delay
    } else {
        LinkStatus::Ok
    }
}

/// GCS / companion computers send `MAV_AUTOPILOT_INVALID`; only real flight controllers count.
pub fn is_flight_controller(autopilot: MavAutopilot) -> bool {
    autopilot != MavAutopilot::MAV_AUTOPILOT_INVALID
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn thresholds() {
        assert_eq!(link_status(0), LinkStatus::Ok);
        assert_eq!(link_status(2_999), LinkStatus::Ok);
        assert_eq!(link_status(3_000), LinkStatus::Delay);
        assert_eq!(link_status(9_999), LinkStatus::Delay);
        assert_eq!(link_status(10_000), LinkStatus::Lost);
    }

    #[test]
    fn gcs_heartbeats_are_not_vehicles() {
        assert!(is_flight_controller(MavAutopilot::MAV_AUTOPILOT_ARDUPILOTMEGA));
        assert!(!is_flight_controller(MavAutopilot::MAV_AUTOPILOT_INVALID));
    }
}
