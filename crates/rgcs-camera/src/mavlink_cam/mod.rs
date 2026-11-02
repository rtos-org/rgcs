//! MAVLink camera / gimbal driver (the `mavlink` camera kind). Pure protocol modules:
//! `binding` picks "our" camera and gimbal manager, `caps` turns them into `CameraCaps`,
//! `attitude` converts the gimbal quaternion, `encode` builds the outgoing frames and
//! `apply` folds received frames into a `Model`.

pub mod apply;
pub mod attitude;
pub mod binding;
pub mod caps;
pub mod driver;
pub mod encode;
#[cfg(any(test, feature = "sim"))]
pub mod fake;
mod motion;
pub mod requests;
