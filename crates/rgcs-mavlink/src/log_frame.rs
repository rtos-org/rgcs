//! Owned copies of the DataFlash log transfer payloads (LOG_ENTRY / LOG_DATA), routed to the
//! server's log hub without holding the whole `MavMessage` enum.

use mavlink::dialects::ardupilotmega::{MavMessage, LOG_DATA_DATA, LOG_ENTRY_DATA};

#[derive(Debug, Clone, PartialEq)]
pub enum LogFrame {
    Entry(LOG_ENTRY_DATA),
    Data(LOG_DATA_DATA),
}

impl LogFrame {
    pub fn from_message(msg: &MavMessage) -> Option<Self> {
        Some(match msg {
            MavMessage::LOG_ENTRY(d) => Self::Entry(d.clone()),
            MavMessage::LOG_DATA(d) => Self::Data(d.clone()),
            _ => return None,
        })
    }

    pub fn into_message(self) -> MavMessage {
        match self {
            Self::Entry(d) => MavMessage::LOG_ENTRY(d),
            Self::Data(d) => MavMessage::LOG_DATA(d),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use mavlink::dialects::ardupilotmega::HEARTBEAT_DATA;

    #[test]
    fn log_frames_round_trip_and_others_are_ignored() {
        let entry = LOG_ENTRY_DATA {
            id: 7,
            num_logs: 1,
            last_log_num: 7,
            time_utc: 1_700_000_000,
            size: 10_240,
        };
        let f = LogFrame::from_message(&MavMessage::LOG_ENTRY(entry.clone())).unwrap();
        assert_eq!(f, LogFrame::Entry(entry.clone()));
        assert_eq!(f.into_message(), MavMessage::LOG_ENTRY(entry));
        let data = LOG_DATA_DATA {
            ofs: 90,
            id: 7,
            count: 90,
            data: [1; 90],
        };
        assert!(matches!(
            LogFrame::from_message(&MavMessage::LOG_DATA(data)),
            Some(LogFrame::Data(_))
        ));
        assert!(LogFrame::from_message(&MavMessage::HEARTBEAT(HEARTBEAT_DATA::DEFAULT)).is_none());
    }
}
