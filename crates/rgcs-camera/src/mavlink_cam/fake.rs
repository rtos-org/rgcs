//! An ArduPilot-like camera (compid 1, device 1) and gimbal manager (compid 1, device 1) on
//! the `MavPort` channels, for driver and server tests. It answers `REQUEST_MESSAGE` 259 / 280,
//! ACKs every command (DENIED for `reject`, silence for `mute`), streams 260 / 262 at 1 Hz (from
//! the start unless `!camera_streams_unasked`) and 285 at 10 Hz (after a `SET_MESSAGE_INTERVAL`
//! unless `stream_unasked`), and applies zoom,
//! recording and gimbal angles.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use mavlink::dialects::ardupilotmega::{
    CameraCapFlags, GimbalDeviceFlags, GimbalManagerCapFlags, MavCmd, MavMessage, MavResult,
    CAMERA_CAPTURE_STATUS_DATA, CAMERA_INFORMATION_DATA, CAMERA_SETTINGS_DATA,
    GIMBAL_DEVICE_ATTITUDE_STATUS_DATA, GIMBAL_MANAGER_INFORMATION_DATA, HEARTBEAT_DATA,
};
use mavlink::MavHeader;
use rgcs_core::SysId;
use rgcs_mavlink::{Ack, MavPort, Outgoing, PayloadFrame, PAYLOAD_CAPACITY};
use tokio::sync::{broadcast, mpsc};
use tokio::task::JoinHandle;

const GIMBAL_COMPID: u8 = 1;
const STREAM_TICK: Duration = Duration::from_millis(100);
const ATTITUDE_ID: f32 = 285.0;
const CAMERA_STREAM_IDS: [f32; 2] = [260.0, 262.0];

#[derive(Debug, Clone)]
pub struct FakeConfig {
    pub cam_flags: u32,
    pub cam_compid: u8,
    pub camera_device_id: u8,
    pub firmware: u32,
    pub manager_caps: u32,
    pub gimbal_device_id: u8,
    /// Degrees, (min, max).
    pub pitch_range_deg: (f32, f32),
    /// Answered with `MAV_RESULT_DENIED` and not applied.
    pub reject: Vec<MavCmd>,
    /// Never answered and not applied.
    pub mute: Vec<MavCmd>,
    /// Stream 285 from the start instead of after a `SET_MESSAGE_INTERVAL`.
    pub stream_unasked: bool,
    /// Stream 260 / 262 from the start (default). `false` is ArduPilot-like: only after a
    /// `SET_MESSAGE_INTERVAL` for 260 / 262.
    pub camera_streams_unasked: bool,
}

impl Default for FakeConfig {
    fn default() -> Self {
        Self {
            cam_flags: 0xC3,
            cam_compid: 1,
            camera_device_id: 1,
            firmware: 0x030201,
            manager_caps: 32 | 256 | 2 | 131_072,
            gimbal_device_id: 1,
            pitch_range_deg: (-90.0, 30.0),
            reject: Vec::new(),
            mute: Vec::new(),
            stream_unasked: false,
            camera_streams_unasked: true,
        }
    }
}

/// What the fake camera / gimbal currently reports.
#[derive(Debug, Clone, Copy, PartialEq)]
struct World {
    zoom: f32,
    video_status: u8,
    /// MAVLink yaw (+right) and pitch, radians.
    attitude: (f32, f32),
    attitude_stream: bool,
    camera_stream: bool,
}

pub struct FakeMav {
    port: MavPort,
    log: Arc<Mutex<Vec<MavMessage>>>,
    paused: Arc<AtomicBool>,
    task: JoinHandle<()>,
}

impl FakeMav {
    pub fn start(sysid: SysId, cfg: FakeConfig) -> Self {
        let (out_tx, out_rx) = mpsc::channel(64);
        let (acks, _) = broadcast::channel(64);
        let (payload, _) = broadcast::channel(PAYLOAD_CAPACITY);
        let port = MavPort::new(out_tx, acks.clone(), payload.clone());
        let log = Arc::new(Mutex::new(Vec::new()));
        let paused = Arc::new(AtomicBool::new(false));
        let fake = Responder {
            sysid,
            cfg,
            acks,
            payload,
            log: log.clone(),
            paused: paused.clone(),
        };
        let task = tokio::spawn(fake.run(out_rx));
        Self {
            port,
            log,
            paused,
            task,
        }
    }

    pub fn port(&self) -> MavPort {
        self.port.clone()
    }

    /// Every frame the driver sent, in order.
    pub fn sent(&self) -> Vec<MavMessage> {
        self.log.lock().map(|l| l.clone()).unwrap_or_default()
    }

    /// The commands of the COMMAND_LONG / COMMAND_INT frames sent, in order.
    pub fn commands(&self) -> Vec<MavCmd> {
        self.sent()
            .iter()
            .filter_map(|m| match m {
                MavMessage::COMMAND_LONG(d) => Some(d.command),
                MavMessage::COMMAND_INT(d) => Some(d.command),
                _ => None,
            })
            .collect()
    }

    /// Stops answering and streaming (link loss) while `true`.
    pub fn set_paused(&self, paused: bool) {
        self.paused.store(paused, Ordering::SeqCst);
    }
}

impl Drop for FakeMav {
    fn drop(&mut self) {
        self.task.abort();
    }
}

struct Responder {
    sysid: SysId,
    cfg: FakeConfig,
    acks: broadcast::Sender<Ack>,
    payload: broadcast::Sender<PayloadFrame>,
    log: Arc<Mutex<Vec<MavMessage>>>,
    paused: Arc<AtomicBool>,
}

impl Responder {
    async fn run(self, mut out_rx: mpsc::Receiver<Outgoing>) {
        let mut world = World {
            zoom: 0.0,
            video_status: 0,
            attitude: (0.0, 0.0),
            attitude_stream: self.cfg.stream_unasked,
            camera_stream: self.cfg.camera_streams_unasked,
        };
        let mut tick = tokio::time::interval(STREAM_TICK);
        let mut ticks: u64 = 0;
        loop {
            tokio::select! {
                out = out_rx.recv() => match out {
                    Some(out) => world = self.on_frame(world, out.message),
                    None => break,
                },
                _ = tick.tick() => {
                    ticks += 1;
                    self.stream(&world, ticks);
                }
            }
        }
    }

    fn paused(&self) -> bool {
        self.paused.load(Ordering::SeqCst)
    }

    fn on_frame(&self, world: World, message: MavMessage) -> World {
        if let Ok(mut log) = self.log.lock() {
            log.push(message.clone());
        }
        if self.paused() {
            return world;
        }
        match &message {
            MavMessage::COMMAND_LONG(d) if d.target_system == self.sysid => {
                self.on_command(world, d.command, [d.param1, d.param2])
            }
            MavMessage::COMMAND_INT(d) if d.target_system == self.sysid => {
                self.on_command(world, d.command, [d.param1, d.param2])
            }
            MavMessage::GIMBAL_MANAGER_SET_PITCHYAW(d) if d.pitch.is_finite() && d.yaw.is_finite() => World {
                attitude: (d.yaw, d.pitch),
                ..world
            },
            _ => world,
        }
    }

    fn on_command(&self, world: World, command: MavCmd, p: [f32; 2]) -> World {
        if self.cfg.mute.contains(&command) {
            return world;
        }
        if self.cfg.reject.contains(&command) {
            self.ack(command, MavResult::MAV_RESULT_DENIED);
            return world;
        }
        self.ack(command, MavResult::MAV_RESULT_ACCEPTED);
        match command {
            MavCmd::MAV_CMD_REQUEST_MESSAGE => {
                self.info(p[0]);
                world
            }
            MavCmd::MAV_CMD_SET_MESSAGE_INTERVAL if p[0] == ATTITUDE_ID => World {
                attitude_stream: true,
                ..world
            },
            MavCmd::MAV_CMD_SET_MESSAGE_INTERVAL if CAMERA_STREAM_IDS.contains(&p[0]) => World {
                camera_stream: true,
                ..world
            },
            MavCmd::MAV_CMD_SET_CAMERA_ZOOM if p[0] == 2.0 => World { zoom: p[1], ..world },
            MavCmd::MAV_CMD_VIDEO_START_CAPTURE => World {
                video_status: 1,
                ..world
            },
            MavCmd::MAV_CMD_VIDEO_STOP_CAPTURE => World {
                video_status: 0,
                ..world
            },
            _ => world,
        }
    }

    fn ack(&self, command: MavCmd, result: MavResult) {
        let _ = self.acks.send(Ack {
            sysid: self.sysid,
            command,
            result,
        });
    }

    fn emit(&self, compid: u8, message: MavMessage) {
        let header = MavHeader {
            system_id: self.sysid,
            component_id: compid,
            sequence: 0,
        };
        let _ = self.payload.send(PayloadFrame { header, message });
    }

    fn info(&self, msg_id: f32) {
        if msg_id == 259.0 {
            self.emit(self.cfg.cam_compid, self.camera_information());
        } else if msg_id == 280.0 {
            self.emit(GIMBAL_COMPID, self.manager_information());
        }
    }

    fn camera_information(&self) -> MavMessage {
        MavMessage::CAMERA_INFORMATION(CAMERA_INFORMATION_DATA {
            flags: CameraCapFlags::from_bits_truncate(self.cfg.cam_flags),
            firmware_version: self.cfg.firmware,
            focal_length: f32::NAN,
            sensor_size_h: f32::NAN,
            sensor_size_v: f32::NAN,
            camera_device_id: self.cfg.camera_device_id,
            gimbal_device_id: self.cfg.gimbal_device_id,
            ..CAMERA_INFORMATION_DATA::DEFAULT
        })
    }

    fn manager_information(&self) -> MavMessage {
        let (pmin, pmax) = self.cfg.pitch_range_deg;
        MavMessage::GIMBAL_MANAGER_INFORMATION(GIMBAL_MANAGER_INFORMATION_DATA {
            cap_flags: GimbalManagerCapFlags::from_bits_truncate(self.cfg.manager_caps),
            pitch_min: pmin.to_radians(),
            pitch_max: pmax.to_radians(),
            yaw_min: -std::f32::consts::PI,
            yaw_max: std::f32::consts::PI,
            gimbal_device_id: self.cfg.gimbal_device_id,
            ..GIMBAL_MANAGER_INFORMATION_DATA::DEFAULT
        })
    }

    /// 285 every tick (10 Hz) once enabled; 260 / 262 every 10th tick (1 Hz) once enabled;
    /// the FC HEARTBEAT at 1 Hz.
    fn stream(&self, world: &World, ticks: u64) {
        if self.paused() {
            return;
        }
        if world.attitude_stream {
            self.emit(GIMBAL_COMPID, self.attitude(world));
        }
        if ticks % 10 == 1 {
            self.emit(GIMBAL_COMPID, MavMessage::HEARTBEAT(HEARTBEAT_DATA::DEFAULT));
        }
        if world.camera_stream && ticks % 10 == 0 {
            self.emit(self.cfg.cam_compid, self.settings(world));
            self.emit(self.cfg.cam_compid, self.capture_status(world));
        }
    }

    fn settings(&self, world: &World) -> MavMessage {
        MavMessage::CAMERA_SETTINGS(CAMERA_SETTINGS_DATA {
            zoomLevel: world.zoom,
            focusLevel: f32::NAN,
            camera_device_id: self.cfg.camera_device_id,
            ..CAMERA_SETTINGS_DATA::DEFAULT
        })
    }

    fn capture_status(&self, world: &World) -> MavMessage {
        MavMessage::CAMERA_CAPTURE_STATUS(CAMERA_CAPTURE_STATUS_DATA {
            video_status: world.video_status,
            camera_device_id: self.cfg.camera_device_id,
            ..CAMERA_CAPTURE_STATUS_DATA::DEFAULT
        })
    }

    /// Body frame (ArduPilot's `YAW_IN_VEHICLE_FRAME`), roll 0, ZYX.
    fn attitude(&self, world: &World) -> MavMessage {
        let (yaw, pitch) = world.attitude;
        let (sy, cy) = (yaw / 2.0).sin_cos();
        let (sp, cp) = (pitch / 2.0).sin_cos();
        MavMessage::GIMBAL_DEVICE_ATTITUDE_STATUS(GIMBAL_DEVICE_ATTITUDE_STATUS_DATA {
            q: [cp * cy, -sp * sy, sp * cy, cp * sy],
            flags: GimbalDeviceFlags::GIMBAL_DEVICE_FLAGS_YAW_IN_VEHICLE_FRAME,
            delta_yaw: f32::NAN,
            delta_yaw_velocity: f32::NAN,
            angular_velocity_x: f32::NAN,
            angular_velocity_y: f32::NAN,
            angular_velocity_z: f32::NAN,
            gimbal_device_id: self.cfg.gimbal_device_id,
            ..GIMBAL_DEVICE_ATTITUDE_STATUS_DATA::DEFAULT
        })
    }
}
