//! Camera / gimbal drivers. `siyi` is the MT11 protocol ported from the Python app;
//! the `Camera` trait is what the server talks to.

pub mod camera;
pub mod clock_sync;
pub mod error;
pub mod mavlink_cam;
pub mod none;
pub mod roi;
pub mod siyi;

pub use camera::Camera;
pub use error::CameraError;
pub use mavlink_cam::driver::MavlinkCamera;
pub use none::NoneCamera;
pub use siyi::client::SiyiMt11;
