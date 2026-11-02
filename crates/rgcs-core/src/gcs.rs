//! The GCS's own MAVLink identity (user request 2026-10-19: configurable SYSID, default 255).

use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::Arc;

/// Default MAVLink system id of a ground station.
pub const DEFAULT_GCS_SYSID: u8 = 255;

/// The current GCS SYSID, shared by the link (frame headers) and the mission protocol (target
/// filter); a change applies to the next frame.
#[derive(Debug, Clone)]
pub struct GcsId(Arc<AtomicU8>);

impl Default for GcsId {
    fn default() -> Self {
        Self(Arc::new(AtomicU8::new(DEFAULT_GCS_SYSID)))
    }
}

impl GcsId {
    pub fn get(&self) -> u8 {
        self.0.load(Ordering::Relaxed)
    }

    pub fn set(&self, sysid: u8) {
        self.0.store(sysid, Ordering::Relaxed);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gcs_id_defaults_to_255_and_is_shared_by_clones() {
        let a = GcsId::default();
        let b = a.clone();
        assert_eq!(a.get(), 255);
        b.set(200);
        assert_eq!(a.get(), 200);
    }
}
