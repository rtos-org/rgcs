//! External-factor (外的要因) rules for RGCS (spec 2026-10-24 §5.3–§5.5): per-source parsers,
//! safety-side fusion, sunrise / sunset and WMM declination. Pure: no I/O, no clock beyond
//! arguments. Fetchers live in the server.

pub mod fusion;
pub mod location;
pub mod magnetic;
pub mod parse;
pub mod reading;
pub mod sun;
pub mod thresholds;

pub use fusion::{fuse, Fused, FusedFactor, Rated};
pub use parse::{Note, ParseError, Station};
pub use reading::{Class, FactorKind, Reading, SourceId, GNSS_HDOP_NOTE, GNSS_SATS_NOTE};
pub use thresholds::{rate, Level, Thresholds};

pub use location::round_cell;
pub use magnetic::declination_deg;
pub use sun::{daylight_minutes, sun_times};
