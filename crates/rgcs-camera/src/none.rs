//! No camera assigned: every capability absent, every command refused.

use async_trait::async_trait;
use rgcs_core::{CameraCaps, CameraCommand, CameraState};
use tokio::sync::watch;

use crate::{Camera, CameraError};

pub struct NoneCamera {
    state: watch::Sender<CameraState>,
}

impl Default for NoneCamera {
    fn default() -> Self {
        let (state, _) = watch::channel(CameraState::disconnected(0.0));
        Self { state }
    }
}

#[async_trait]
impl Camera for NoneCamera {
    fn caps(&self) -> CameraCaps {
        CameraCaps::none()
    }

    async fn send(&self, _cmd: CameraCommand) -> Result<(), CameraError> {
        Err(CameraError::Unsupported("no camera"))
    }

    fn state(&self) -> watch::Receiver<CameraState> {
        self.state.subscribe()
    }

    async fn connect(&self) -> Result<(), CameraError> {
        Ok(())
    }

    async fn disconnect(&self) {}
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn none_camera_refuses_roi() {
        let cam = NoneCamera::default();
        assert!(matches!(
            cam.roi_location(35.0, 139.0, 10.0).await,
            Err(CameraError::Unsupported("roi"))
        ));
        assert!(matches!(
            cam.roi_none().await,
            Err(CameraError::Unsupported("roi"))
        ));
    }
}
