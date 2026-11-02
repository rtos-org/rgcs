#![allow(deprecated)] // MISSION_REQUEST: deprecated on the wire since 2020, still sent by some firmware
//! Owned copies of the Mission Protocol payloads, so the server can route them without
//! holding the whole `MavMessage` enum (and so tests can build them directly).

use mavlink::dialects::ardupilotmega::{
    MavMessage, MISSION_ACK_DATA, MISSION_COUNT_DATA, MISSION_CURRENT_DATA, MISSION_ITEM_INT_DATA,
    MISSION_REQUEST_DATA, MISSION_REQUEST_INT_DATA,
};

#[derive(Debug, Clone, PartialEq)]
#[allow(deprecated)]
pub enum MissionFrame {
    Count(MISSION_COUNT_DATA),
    ItemInt(MISSION_ITEM_INT_DATA),
    /// Deprecated on the wire since 2020, still sent by some firmware.
    Request(MISSION_REQUEST_DATA),
    RequestInt(MISSION_REQUEST_INT_DATA),
    Ack(MISSION_ACK_DATA),
    Current(MISSION_CURRENT_DATA),
}

impl MissionFrame {
    #[allow(deprecated)]
    pub fn from_message(msg: &MavMessage) -> Option<Self> {
        Some(match msg {
            MavMessage::MISSION_COUNT(d) => Self::Count(d.clone()),
            MavMessage::MISSION_ITEM_INT(d) => Self::ItemInt(d.clone()),
            MavMessage::MISSION_REQUEST(d) => Self::Request(d.clone()),
            MavMessage::MISSION_REQUEST_INT(d) => Self::RequestInt(d.clone()),
            MavMessage::MISSION_ACK(d) => Self::Ack(d.clone()),
            MavMessage::MISSION_CURRENT(d) => Self::Current(d.clone()),
            _ => return None,
        })
    }

    #[allow(deprecated)]
    pub fn into_message(self) -> MavMessage {
        match self {
            Self::Count(d) => MavMessage::MISSION_COUNT(d),
            Self::ItemInt(d) => MavMessage::MISSION_ITEM_INT(d),
            Self::Request(d) => MavMessage::MISSION_REQUEST(d),
            Self::RequestInt(d) => MavMessage::MISSION_REQUEST_INT(d),
            Self::Ack(d) => MavMessage::MISSION_ACK(d),
            Self::Current(d) => MavMessage::MISSION_CURRENT(d),
        }
    }
}
