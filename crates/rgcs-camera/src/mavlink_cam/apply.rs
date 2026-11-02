//! Received camera / gimbal frames → the next `Model`. Frames
//! must already be filtered to the vehicle's system id; components that are not bound are
//! ignored (they neither change the state nor keep the link alive).

use std::collections::BTreeMap;

use mavlink::dialects::ardupilotmega::MavMessage;
use mavlink::{MavHeader, Message};
use rgcs_core::{CameraCaps, CameraState, Firmware, GimbalAttitude, RecordingState, SysId};
use rgcs_mavlink::PayloadFrame;

use crate::mavlink_cam::attitude::to_attitude;
use crate::mavlink_cam::binding::{attitude_matches, bind_camera, bind_gimbal, CameraBinding, GimbalBinding};
use crate::mavlink_cam::caps::mavlink_caps;
use crate::mavlink_cam::encode::Targets;

/// connected ⇔ bound and a frame from a bound component arrived within this window.
pub const LIVENESS_MS: u64 = 3_000;
const ATTITUDE_MSG_ID: u32 = 285;

#[derive(Debug, Clone, PartialEq)]
pub struct Model {
    pub camera: Option<CameraBinding>,
    pub gimbal: Option<GimbalBinding>,
    /// Last frame from a bound component.
    pub last_rx_ms: Option<u64>,
    /// Last accepted frame per message id (stream staleness, attitude age).
    pub seen_ms: BTreeMap<u32, u64>,
    pub state: CameraState,
}

impl Default for Model {
    fn default() -> Self {
        Self::new()
    }
}

impl Model {
    pub fn new() -> Self {
        Self {
            camera: None,
            gimbal: None,
            last_rx_ms: None,
            seen_ms: BTreeMap::new(),
            state: CameraState {
                zoom: 0.0,
                ..CameraState::disconnected(100.0)
            },
        }
    }

    pub fn caps(&self) -> CameraCaps {
        mavlink_caps(self.camera.as_ref(), self.gimbal.as_ref())
    }

    pub fn targets(&self, sysid: SysId) -> Targets {
        Targets {
            sysid,
            camera: self.camera.as_ref().map(|c| (c.compid, c.device_id)),
            gimbal: self
                .gimbal
                .as_ref()
                .map(|g| (g.manager_compid, g.device_id, g.pitch_range)),
        }
    }

    fn sent_by_camera(&self, h: &MavHeader, device: u8) -> bool {
        self.camera
            .as_ref()
            .is_some_and(|c| c.compid == h.component_id && c.device_id == device)
    }

    fn sent_by_manager(&self, h: &MavHeader) -> bool {
        self.gimbal
            .as_ref()
            .is_some_and(|g| g.manager_compid == h.component_id)
    }

    /// The same model with `msg_id` marked as received now.
    fn seen(self, msg_id: u32, now_ms: u64) -> Self {
        let mut seen_ms = self.seen_ms.clone();
        seen_ms.insert(msg_id, now_ms);
        Self {
            last_rx_ms: Some(now_ms),
            seen_ms,
            ..self
        }
    }
}

/// Folds one frame into the model; an unrelated frame returns it unchanged.
pub fn apply(m: &Model, f: &PayloadFrame, profile_comp_id: u8, now_ms: u64) -> Model {
    let h = &f.header;
    let next = match &f.message {
        MavMessage::CAMERA_INFORMATION(info) => Some(with_camera(
            m,
            bind_camera(m.camera.as_ref(), h, info, profile_comp_id),
        )),
        MavMessage::GIMBAL_MANAGER_INFORMATION(info) => Some(Model {
            gimbal: bind_gimbal(m.gimbal.as_ref(), m.camera.as_ref(), h, info),
            ..m.clone()
        }),
        MavMessage::GIMBAL_MANAGER_STATUS(_) => m.sent_by_manager(h).then(|| m.clone()),
        msg => camera_state(m, h, msg).map(|state| Model { state, ..m.clone() }),
    };
    match next {
        Some(next) if is_bound_sender(&next, f) => next.seen(f.message.message_id(), now_ms),
        Some(next) => next,
        None => m.clone(),
    }
}

/// The next `CameraState` for a settings / capture / attitude frame from a bound component.
fn camera_state(m: &Model, h: &MavHeader, msg: &MavMessage) -> Option<CameraState> {
    let cur = &m.state;
    match msg {
        MavMessage::CAMERA_SETTINGS(s) if m.sent_by_camera(h, s.camera_device_id) => {
            let zoom = if s.zoomLevel.is_finite() {
                s.zoomLevel
            } else {
                cur.zoom
            };
            Some(CameraState { zoom, ..cur.clone() })
        }
        MavMessage::CAMERA_CAPTURE_STATUS(s) if m.sent_by_camera(h, s.camera_device_id) => {
            let recording = match s.video_status {
                0 => RecordingState::Idle,
                1 => RecordingState::Recording,
                _ => cur.recording,
            };
            Some(CameraState {
                recording,
                ..cur.clone()
            })
        }
        MavMessage::GIMBAL_DEVICE_ATTITUDE_STATUS(s)
            if m.gimbal.as_ref().is_some_and(|g| attitude_matches(g, h, s)) =>
        {
            let gimbal = to_attitude(s).map(|(yaw, pitch, roll)| GimbalAttitude {
                yaw,
                pitch,
                roll,
                age_ms: 0,
            });
            Some(CameraState {
                gimbal,
                ..cur.clone()
            })
        }
        _ => None,
    }
}

fn state(m: &Model, state: CameraState) -> Model {
    Model { state, ..m.clone() }
}

/// A new camera binding also sets the firmware text.
fn with_camera(m: &Model, camera: Option<CameraBinding>) -> Model {
    // A bound camera's own firmware wins, including "unknown" (a swapped camera reports 0).
    let firmware = match camera.as_ref() {
        Some(c) => c.firmware.clone().map(|fw| Firmware {
            camera: fw,
            gimbal: String::new(),
            zoom: String::new(),
        }),
        None => m.state.firmware.clone(),
    };
    Model {
        camera,
        state: CameraState {
            firmware,
            ..m.state.clone()
        },
        ..m.clone()
    }
}

/// Whether `f` came from what `next` has bound (info frames count once they bind).
fn is_bound_sender(next: &Model, f: &PayloadFrame) -> bool {
    let h = &f.header;
    match &f.message {
        MavMessage::CAMERA_INFORMATION(i) => next.sent_by_camera(h, i.camera_device_id),
        MavMessage::GIMBAL_MANAGER_INFORMATION(i) => {
            next.sent_by_manager(h)
                && next
                    .gimbal
                    .as_ref()
                    .is_some_and(|g| g.device_id == i.gimbal_device_id)
        }
        _ => true,
    }
}

/// `state.connected` and the attitude age at `now_ms`.
pub fn liveness(m: &Model, now_ms: u64) -> Model {
    let bound = m.camera.is_some() || m.gimbal.is_some();
    let fresh = m
        .last_rx_ms
        .is_some_and(|t| now_ms.saturating_sub(t) <= LIVENESS_MS);
    let age = m.seen_ms.get(&ATTITUDE_MSG_ID).map(|&t| now_ms.saturating_sub(t));
    let gimbal = m.state.gimbal.clone().map(|g| GimbalAttitude {
        age_ms: age.unwrap_or(g.age_ms),
        ..g
    });
    state(
        m,
        CameraState {
            connected: bound && fresh,
            gimbal,
            ..m.state.clone()
        },
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mavlink_cam::binding::tests::{cam_info, header, manager_info};
    use mavlink::dialects::ardupilotmega::{
        MavMessage, CAMERA_CAPTURE_STATUS_DATA, CAMERA_INFORMATION_DATA, CAMERA_SETTINGS_DATA,
        GIMBAL_DEVICE_ATTITUDE_STATUS_DATA,
    };
    use rgcs_core::{Firmware, GimbalAttitude, RecordingState};

    fn frame(compid: u8, message: MavMessage) -> PayloadFrame {
        PayloadFrame {
            header: header(compid),
            message,
        }
    }

    fn bound() -> Model {
        let m = apply(
            &Model::new(),
            &frame(1, MavMessage::CAMERA_INFORMATION(cam_info(1, 0xC3, 1))),
            100,
            1_000,
        );
        apply(
            &m,
            &frame(
                1,
                MavMessage::GIMBAL_MANAGER_INFORMATION(manager_info(1, 32 | 256)),
            ),
            100,
            1_000,
        )
    }

    fn settings(zoom: f32) -> MavMessage {
        MavMessage::CAMERA_SETTINGS(CAMERA_SETTINGS_DATA {
            zoomLevel: zoom,
            camera_device_id: 1,
            ..CAMERA_SETTINGS_DATA::DEFAULT
        })
    }

    #[test]
    fn new_model_starts_at_zero_percent() {
        let m = Model::new();
        assert_eq!(m.state.zoom, 0.0);
        assert_eq!(m.state.zoom_max, 100.0);
        assert!(!m.state.connected);
        assert_eq!(
            m.targets(1),
            Targets {
                sysid: 1,
                camera: None,
                gimbal: None
            }
        );
    }

    /// A camera swapped after an FC reboot (live SITL: Siyi ZT30 → servo camera) reports
    /// firmware 0: the old camera's firmware text must not stay on screen.
    #[test]
    fn rebinding_without_firmware_clears_it() {
        let swapped = CAMERA_INFORMATION_DATA {
            firmware_version: 0,
            ..cam_info(1, 0x02, 1)
        };
        let m = apply(
            &bound(),
            &frame(1, MavMessage::CAMERA_INFORMATION(swapped)),
            100,
            2_000,
        );
        assert_eq!(m.camera.as_ref().map(|c| c.flags), Some(0x02));
        assert_eq!(m.state.firmware, None);
    }

    #[test]
    fn information_binds_and_sets_firmware() {
        let m = bound();
        assert_eq!(m.camera.as_ref().map(|c| c.compid), Some(1));
        assert_eq!(m.gimbal.as_ref().map(|g| g.device_id), Some(1));
        assert_eq!(
            m.state.firmware,
            Some(Firmware {
                camera: "1.2.3".into(),
                gimbal: String::new(),
                zoom: String::new(),
            })
        );
        assert!(m.caps().photo);
        assert_eq!(m.last_rx_ms, Some(1_000));
        assert_eq!(m.targets(1).camera, Some((1, 1)));
        assert_eq!(m.targets(1).gimbal.map(|g| (g.0, g.1)), Some((1, 1)));
    }

    #[test]
    fn camera_settings_sets_zoom_percent() {
        let m = apply(&bound(), &frame(1, settings(40.0)), 100, 1_500);
        assert_eq!(m.state.zoom, 40.0);
        assert_eq!(m.seen_ms.get(&260), Some(&1_500));
        let m = apply(&m, &frame(1, settings(f32::NAN)), 100, 1_600);
        assert_eq!(m.state.zoom, 40.0);
    }

    #[test]
    fn capture_status_sets_recording() {
        let status = |v: u8| {
            MavMessage::CAMERA_CAPTURE_STATUS(CAMERA_CAPTURE_STATUS_DATA {
                video_status: v,
                camera_device_id: 1,
                ..CAMERA_CAPTURE_STATUS_DATA::DEFAULT
            })
        };
        let m = apply(&bound(), &frame(1, status(1)), 100, 1_100);
        assert_eq!(m.state.recording, RecordingState::Recording);
        let m = apply(&m, &frame(1, status(0)), 100, 1_200);
        assert_eq!(m.state.recording, RecordingState::Idle);
    }

    #[test]
    fn foreign_component_ignored() {
        let m = bound();
        assert_eq!(apply(&m, &frame(50, settings(40.0)), 100, 2_000), m);
        assert_eq!(
            apply(&Model::new(), &frame(1, settings(40.0)), 100, 2_000),
            Model::new()
        );
    }

    #[test]
    fn liveness_3s() {
        let m = bound();
        assert!(liveness(&m, 4_000).state.connected);
        assert!(!liveness(&m, 4_001).state.connected);
        assert!(!liveness(&Model::new(), 0).state.connected);
    }

    #[test]
    fn attitude_sets_gimbal() {
        let att = MavMessage::GIMBAL_DEVICE_ATTITUDE_STATUS(GIMBAL_DEVICE_ATTITUDE_STATUS_DATA {
            q: [0.707_106_77, 0.0, 0.0, 0.707_106_77],
            gimbal_device_id: 1,
            flags: Default::default(),
            delta_yaw: f32::NAN,
            ..GIMBAL_DEVICE_ATTITUDE_STATUS_DATA::DEFAULT
        });
        let m = apply(&bound(), &frame(1, att), 100, 2_000);
        let g: GimbalAttitude = m.state.gimbal.clone().expect("gimbal");
        assert!(
            (g.yaw + 90.0).abs() < 0.01 && g.pitch.abs() < 0.01 && g.roll.abs() < 0.01,
            "{g:?}"
        );
        assert_eq!(g.age_ms, 0);
        let later = liveness(&m, 2_250);
        assert_eq!(later.state.gimbal.expect("gimbal").age_ms, 250);
        assert!(later.state.connected);
    }
}
