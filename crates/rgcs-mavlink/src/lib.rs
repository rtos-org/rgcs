//! MAVLink side of RGCS: link URL parsing, per-system routing, ArduPilot telemetry decoding,
//! heartbeat-based link health and the "ask for streams only if they are missing" logic
//! ported from the MT11 Python app.

pub mod calib_frame;
pub mod command;
pub mod connection;
pub mod decode;
pub mod guard_tap;
pub mod heartbeat;
pub mod inspector;
pub mod interval;
pub mod link;
pub mod link_stats;
pub mod log_frame;
pub mod mission_frame;
pub mod modes;
pub mod port;
pub mod queue;
pub mod router;
pub mod statustext;
pub mod takeoff;

pub use calib_frame::calib_frame;
pub use command::{
    encode_guided_target, encode_log_request_data, encode_log_request_end, encode_log_request_list,
    encode_param_request_index, encode_param_request_list, encode_param_request_read, encode_param_set,
};
pub use connection::{run_link, LinkChannels};
pub use guard_tap::{GuardBody, GuardFrame, GUARD_CAPACITY};
pub use inspector::Inspector;
pub use link::{LinkUrl, LinkUrlError};
pub use link_stats::{component_kind, frame_bytes, ComponentStats, LinkStats, LinkStatsSnapshot};
pub use log_frame::LogFrame;
pub use mission_frame::MissionFrame;
pub use port::{tap, MavPort, PayloadFrame, PortError, PAYLOAD_CAPACITY, PAYLOAD_IDS};
pub use queue::{run_queue, Ack, Outcome, Outgoing, QueuedCommand};
pub use router::{Clock, Router, RouterEvent, SystemTimeSample, GLOBAL_POSITION_INT_ID};
