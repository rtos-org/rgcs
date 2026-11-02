//! Network view types (`GET /api/network`). `NetworkTopology` is assembled by
//! rgcs-server and sent as `GET /api/network` and the 1 Hz WS `network_status` frame.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// What a MAVLink component is (80 §2): from its HEARTBEAT `MAV_TYPE`, else from its COMPID.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, rename_all = "snake_case")]
pub enum ComponentKind {
    Autopilot,
    Camera,
    Gimbal,
    Companion,
    Gcs,
    Other,
}

use crate::camera::{CameraKind, VideoSource};
use crate::operator::Role;
use crate::vehicle::{LinkStatus, SysId, VehicleKind};

/// Everything the network view draws. Elements that do not exist on a standalone server are
/// named in `unconfigured` instead of being invented.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct NetworkTopology {
    pub server: ServerNode,
    pub links: Vec<MavLinkInfo>,
    pub vehicles: Vec<NetVehicle>,
    pub clients: Vec<ClientSession>,
    pub media: MediaServer,
    pub unconfigured: Vec<Unconfigured>,
    #[ts(type = "number")]
    pub at_unix_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ServerNode {
    pub hostname: String,
    pub version: String,
    pub build: String,
    pub listen: String,
    /// "standalone" | "edge" | "hub"
    pub role: String,
    #[ts(type = "number")]
    pub uptime_s: u64,
    #[ts(type = "number")]
    pub started_unix_ms: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, rename_all = "snake_case")]
pub enum MavLinkKind {
    Udpin,
    Udpout,
    Tcp,
    Serial,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct MavLinkInfo {
    pub id: String,
    pub url: String,
    pub kind: MavLinkKind,
    pub connected: bool,
    #[ts(type = "number | null")]
    pub connected_since_unix_ms: Option<u64>,
    pub reconnects: u32,
    pub last_error: Option<String>,
    pub rx_msgs_per_s: f32,
    pub rx_bytes_per_s: f32,
    pub loss_pct: f32,
    #[ts(type = "number | null")]
    pub last_rx_age_ms: Option<u64>,
    /// Connected but no frame for more than 3 s (80 §3): shown as a warning,「受信なし」.
    pub stale: bool,
    pub systems: Vec<NetSystem>,
}

/// A MAVLink system seen on a link; `vehicle` is true when it sent an FC heartbeat.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct NetSystem {
    pub sysid: u8,
    pub vehicle: bool,
    pub components: Vec<NetComponent>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct NetComponent {
    pub compid: u8,
    pub kind: ComponentKind,
    pub mav_type: Option<u8>,
    pub rx_msgs_per_s: f32,
    pub loss_pct: f32,
    #[ts(type = "number")]
    pub last_rx_age_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct NetVehicle {
    pub sysid: SysId,
    pub name: String,
    pub kind: VehicleKind,
    pub link: LinkStatus,
    pub link_id: String,
    #[ts(type = "number | null")]
    pub heartbeat_age_ms: Option<u64>,
    pub components: Vec<NetComponent>,
    pub camera: Option<CameraLink>,
    pub video: Option<VideoPath>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, rename_all = "snake_case")]
pub enum CameraTransport {
    TcpUdp,
    ViaFc,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct CameraLink {
    pub kind: CameraKind,
    pub transport: CameraTransport,
    pub endpoint: String,
    pub connected: bool,
    pub firmware: Option<String>,
    pub last_error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct VideoPath {
    pub source: VideoSource,
    pub probe_ok: bool,
    pub scanning: bool,
    pub whep_path: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct MediaServer {
    pub whep_upstream: String,
    /// `None` until the first probe has finished.
    pub reachable: Option<bool>,
}

/// One WebSocket session (one browser tab).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct ClientSession {
    #[ts(type = "number")]
    pub id: u64,
    pub username: String,
    pub role: Role,
    pub addr: Option<String>,
    pub browser: String,
    #[ts(type = "number")]
    pub connected_since_unix_ms: u64,
}

/// Elements of the M5 picture this server does not have.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, rename_all = "snake_case")]
pub enum Unconfigured {
    Hub,
    Lte,
    Mesh,
    Gateway,
    Ntrip,
    Node,
}

pub const UNCONFIGURED_STANDALONE: [Unconfigured; 6] = [
    Unconfigured::Hub,
    Unconfigured::Lte,
    Unconfigured::Mesh,
    Unconfigured::Gateway,
    Unconfigured::Ntrip,
    Unconfigured::Node,
];

#[cfg(test)]
mod tests {
    use super::*;
    use crate::camera::{CameraKind, VideoSource};
    use crate::operator::Role;
    use crate::vehicle::{LinkStatus, VehicleKind};
    use crate::ws::ServerMessage;

    fn component(compid: u8, kind: ComponentKind) -> NetComponent {
        NetComponent {
            compid,
            kind,
            mav_type: Some(2),
            rx_msgs_per_s: 48.6,
            loss_pct: 0.0,
            last_rx_age_ms: 120,
        }
    }

    fn vehicle(sysid: u8) -> NetVehicle {
        NetVehicle {
            sysid,
            name: format!("UAV-{sysid:02}"),
            kind: VehicleKind::Copter,
            link: LinkStatus::Ok,
            link_id: "link0".into(),
            heartbeat_age_ms: Some(480),
            components: vec![
                component(1, ComponentKind::Autopilot),
                component(100, ComponentKind::Camera),
                component(154, ComponentKind::Gimbal),
            ],
            camera: Some(CameraLink {
                kind: CameraKind::SiyiMt11,
                transport: CameraTransport::TcpUdp,
                endpoint: "192.168.144.25:37260".into(),
                connected: true,
                firmware: Some("1.2.3".into()),
                last_error: None,
            }),
            video: Some(VideoPath {
                source: VideoSource::Mt11,
                probe_ok: true,
                scanning: false,
                whep_path: "uav1".into(),
            }),
        }
    }

    fn client(id: u64) -> ClientSession {
        ClientSession {
            id,
            username: "operator".into(),
            role: Role::Operator,
            addr: Some("192.168.10.21:51234".into()),
            browser: "Chrome".into(),
            connected_since_unix_ms: 1_760_000_000_000,
        }
    }

    fn sample_with(vehicles: u8, clients: u64) -> NetworkTopology {
        NetworkTopology {
            server: ServerNode {
                hostname: "rgcs-pi".into(),
                version: "0.1.0".into(),
                build: "a04ecc6".into(),
                listen: "0.0.0.0:8000".into(),
                role: "standalone".into(),
                uptime_s: 3600,
                started_unix_ms: 1_759_996_400_000,
            },
            links: vec![MavLinkInfo {
                id: "link0".into(),
                url: "tcp:127.0.0.1:5760".into(),
                kind: MavLinkKind::Tcp,
                connected: true,
                connected_since_unix_ms: Some(1_759_996_410_000),
                reconnects: 0,
                last_error: None,
                rx_msgs_per_s: 312.4,
                rx_bytes_per_s: 9_800.0,
                loss_pct: 0.0,
                last_rx_age_ms: Some(20),
                stale: false,
                systems: (1..=vehicles)
                    .map(|sysid| NetSystem {
                        sysid,
                        vehicle: true,
                        components: vec![component(1, ComponentKind::Autopilot)],
                    })
                    .collect(),
            }],
            vehicles: (1..=vehicles).map(vehicle).collect(),
            clients: (1..=clients).map(client).collect(),
            media: MediaServer {
                whep_upstream: "http://127.0.0.1:8889".into(),
                reachable: Some(true),
            },
            unconfigured: UNCONFIGURED_STANDALONE.to_vec(),
            at_unix_ms: 1_760_000_001_000,
        }
    }

    fn sample() -> NetworkTopology {
        sample_with(1, 2)
    }

    #[test]
    fn component_kind_is_snake_case() {
        assert_eq!(
            serde_json::to_string(&ComponentKind::Autopilot).unwrap(),
            "\"autopilot\""
        );
        assert_eq!(serde_json::to_string(&ComponentKind::Gcs).unwrap(), "\"gcs\"");
    }

    #[test]
    fn network_status_tag() {
        let v = serde_json::to_value(ServerMessage::NetworkStatus { topology: sample() }).unwrap();
        assert_eq!(v["t"], "network_status");
        assert_eq!(v["topology"]["server"]["role"], "standalone");
    }

    #[test]
    fn enums_are_snake_case() {
        let s = |v: &dyn erased::Ser| v.to_json();
        assert_eq!(s(&CameraTransport::TcpUdp), "\"tcp_udp\"");
        assert_eq!(s(&CameraTransport::ViaFc), "\"via_fc\"");
        assert_eq!(s(&MavLinkKind::Udpin), "\"udpin\"");
        assert_eq!(s(&Unconfigured::Gateway), "\"gateway\"");
        assert_eq!(s(&ComponentKind::Companion), "\"companion\"");
    }

    #[test]
    fn sample_round_trips() {
        let t = sample();
        let back: NetworkTopology = serde_json::from_str(&serde_json::to_string(&t).unwrap()).unwrap();
        assert_eq!(back, t);
    }

    #[test]
    fn standalone_lists_every_unconfigured_element() {
        assert_eq!(sample().unconfigured.len(), 6);
    }

    #[test]
    fn topology_stays_small() {
        let bytes = serde_json::to_vec(&sample_with(6, 5)).unwrap();
        assert!(bytes.len() <= 8192, "{} bytes", bytes.len());
    }

    mod erased {
        pub trait Ser {
            fn to_json(&self) -> String;
        }
        impl<T: serde::Serialize> Ser for T {
            fn to_json(&self) -> String {
                serde_json::to_string(self).unwrap()
            }
        }
    }
}
