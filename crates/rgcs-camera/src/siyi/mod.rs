//! SIYI SDK protocol: frame codec, command encoders, reply parsers.

pub mod ai;
pub mod apply;
pub mod client;
pub mod encode;
pub(crate) mod exec;
pub mod expire;
pub mod frame;
pub mod parse;
pub mod polls;
pub(crate) mod session;
#[cfg(any(test, feature = "sim"))]
pub mod sim;
#[cfg(any(test, feature = "sim"))]
pub mod sim_media;
pub mod tf_card;
pub mod thermal;
