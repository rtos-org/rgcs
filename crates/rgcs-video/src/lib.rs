//! Video plumbing: no transcoding here, only reachability, source choice and
//! WHEP signalling relayed to MediaMTX.

pub mod probe;
pub mod source;
pub mod whep;

pub use probe::{probe_rtsp, rtsp_request_uri, ProbeError};
pub use source::{initial_status, next_status, ProbeFn, SourceMonitor, Timings, WHEP_PATH};
pub use whep::{WhepAnswer, WhepError, WhepRelay, MAX_OFFER_BYTES};
