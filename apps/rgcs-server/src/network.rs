//! Network view: assemble the standalone server's real topology
//! from plain snapshots and broadcast it at 1 Hz.

use std::collections::BTreeMap;
use std::net::SocketAddr;
use std::time::Duration;

use rgcs_core::camera::{CameraKind, CameraProfile, CameraSnapshot, VideoSourceStatus};
use rgcs_core::network::{
    CameraLink, CameraTransport, ClientSession, MavLinkInfo, MavLinkKind, MediaServer, NetComponent,
    NetSystem, NetVehicle, NetworkTopology, ServerNode, VideoPath, UNCONFIGURED_STANDALONE,
};
use rgcs_core::vehicle::{SysId, VehicleState};
use rgcs_core::ServerMessage;
use rgcs_mavlink::{ComponentStats, LinkStatsSnapshot, LinkUrl};
use tokio::time::MissedTickBehavior;

use crate::app::AppState;
use crate::config::{Config, Role};

/// The only MAVLink link today.
pub const LINK_ID: &str = "link0";
/// HEARTBEAT message id (its age is the vehicle's heartbeat age).
const HEARTBEAT_ID: u32 = 0;

/// What `config.toml` says about this server (listen address, link, role).
#[derive(Debug, Clone)]
pub struct NetworkConfig {
    pub listen: SocketAddr,
    pub mavlink_url: String,
    pub role: Role,
}

impl Default for NetworkConfig {
    fn default() -> Self {
        let c = Config::default();
        Self {
            listen: c.listen,
            mavlink_url: c.mavlink_url,
            role: c.role,
        }
    }
}

/// Plain snapshots `assemble` turns into a topology; gathered by `collect`.
pub struct NetworkInputs {
    pub config: NetworkConfig,
    pub hostname: String,
    pub uptime_s: u64,
    pub started_unix_ms: u64,
    pub now_unix_ms: u64,
    /// Router states with their heartbeat age (ms).
    pub vehicles: Vec<(VehicleState, Option<u64>)>,
    pub link: LinkStatsSnapshot,
    pub cameras: Vec<(CameraProfile, Option<CameraSnapshot>)>,
    pub video: Vec<(SysId, VideoSourceStatus)>,
    pub media: MediaServer,
    pub clients: Vec<ClientSession>,
}

/// Pure: the topology from snapshots.
pub fn assemble(i: &NetworkInputs) -> NetworkTopology {
    NetworkTopology {
        server: server_node(i),
        links: vec![link_info(i)],
        vehicles: i.vehicles.iter().map(|(v, age)| vehicle(i, v, *age)).collect(),
        clients: i.clients.clone(),
        media: i.media.clone(),
        unconfigured: UNCONFIGURED_STANDALONE.to_vec(),
        at_unix_ms: i.now_unix_ms,
    }
}

fn role_name(role: Role) -> &'static str {
    match role {
        Role::Standalone => "standalone",
        Role::Edge => "edge",
        Role::Hub => "hub",
    }
}

fn server_node(i: &NetworkInputs) -> ServerNode {
    ServerNode {
        hostname: i.hostname.clone(),
        version: env!("CARGO_PKG_VERSION").into(),
        build: crate::BUILD.into(),
        listen: i.config.listen.to_string(),
        role: role_name(i.config.role).into(),
        uptime_s: i.uptime_s,
        started_unix_ms: i.started_unix_ms,
    }
}

/// `mavlink_url` was validated at start; an unparsable one (tests only) reads as `udpin`.
fn link_kind(url: &str) -> MavLinkKind {
    match url.parse::<LinkUrl>() {
        Ok(LinkUrl::UdpOut { .. }) => MavLinkKind::Udpout,
        Ok(LinkUrl::Tcp { .. }) => MavLinkKind::Tcp,
        Ok(LinkUrl::Serial { .. }) => MavLinkKind::Serial,
        Ok(LinkUrl::UdpIn { .. }) | Err(_) => MavLinkKind::Udpin,
    }
}

fn link_info(i: &NetworkInputs) -> MavLinkInfo {
    let s = &i.link;
    MavLinkInfo {
        id: LINK_ID.into(),
        url: i.config.mavlink_url.clone(),
        kind: link_kind(&i.config.mavlink_url),
        connected: s.connected,
        connected_since_unix_ms: s.connected_since_unix_ms,
        reconnects: s.reconnects,
        last_error: s.last_error.clone(),
        rx_msgs_per_s: s.rx_msgs_per_s,
        rx_bytes_per_s: s.rx_bytes_per_s,
        loss_pct: s.loss_pct,
        last_rx_age_ms: s.last_rx_age_ms,
        stale: s.rx_stale,
        systems: systems(i),
    }
}

/// Every system heard on the link; `vehicle` marks the ones the router tracks.
fn systems(i: &NetworkInputs) -> Vec<NetSystem> {
    let mut by_sysid: BTreeMap<u8, Vec<NetComponent>> = BTreeMap::new();
    for c in &i.link.components {
        by_sysid.entry(c.sysid).or_default().push(component(c));
    }
    by_sysid
        .into_iter()
        .map(|(sysid, components)| NetSystem {
            sysid,
            vehicle: i.vehicles.iter().any(|(v, _)| v.sysid == sysid),
            components,
        })
        .collect()
}

fn component(c: &ComponentStats) -> NetComponent {
    NetComponent {
        compid: c.compid,
        kind: c.kind,
        mav_type: c.mav_type,
        rx_msgs_per_s: c.rx_msgs_per_s,
        loss_pct: c.loss_pct,
        last_rx_age_ms: c.last_rx_age_ms,
    }
}

fn vehicle(i: &NetworkInputs, v: &VehicleState, heartbeat_age_ms: Option<u64>) -> NetVehicle {
    let mut components: Vec<NetComponent> = i
        .link
        .components
        .iter()
        .filter(|c| c.sysid == v.sysid)
        .map(component)
        .collect();
    components.sort_by_key(|c| c.compid);
    NetVehicle {
        sysid: v.sysid,
        name: v.name.clone(),
        kind: v.kind,
        link: v.link,
        link_id: LINK_ID.into(),
        heartbeat_age_ms,
        components,
        camera: i
            .cameras
            .iter()
            .find(|(p, _)| p.sysid == v.sysid)
            .and_then(|(p, snap)| camera_link(p, snap.as_ref())),
        video: i
            .video
            .iter()
            .find(|(sysid, _)| *sysid == v.sysid)
            .map(|(_, s)| video_path(s)),
    }
}

fn camera_link(p: &CameraProfile, snap: Option<&CameraSnapshot>) -> Option<CameraLink> {
    let (transport, endpoint) = match p.kind {
        CameraKind::None => return None,
        CameraKind::SiyiMt11 => (CameraTransport::TcpUdp, format!("{}:{}", p.host, p.port)),
        CameraKind::Mavlink => (CameraTransport::ViaFc, format!("FC · compid {}", p.comp_id)),
    };
    let state = snap.map(|s| &s.state);
    Some(CameraLink {
        kind: p.kind,
        transport,
        endpoint,
        connected: state.is_some_and(|s| s.connected),
        firmware: state
            .and_then(|s| s.firmware.as_ref())
            .map(|f| f.camera.clone())
            .filter(|c| !c.is_empty()),
        last_error: state.and_then(|s| s.last_error.clone()),
    })
}

fn video_path(s: &VideoSourceStatus) -> VideoPath {
    VideoPath {
        source: s.source,
        probe_ok: s.probe_ok,
        scanning: s.scanning,
        whep_path: s.whep_path.clone(),
    }
}

/// Strips credentials (`user:pass@`, query, fragment) from a URL; an unparsable one is hidden.
pub fn redact_url(url: &str) -> String {
    match url::Url::parse(url) {
        Ok(mut u) => {
            // Credentials live in the userinfo, the query (?token=) or the fragment: drop all three.
            // The setters only fail for cannot-be-a-base URLs, which carry no userinfo.
            let _ = u.set_username("");
            let _ = u.set_password(None);
            u.set_query(None);
            u.set_fragment(None);
            u.to_string()
        }
        // Echoing an unparsable value could leak whatever it holds.
        Err(_) => "(invalid url)".into(),
    }
}

/// Router states and heartbeat ages under one lock, released before anything else awaits.
async fn vehicles(app: &AppState) -> Vec<(VehicleState, Option<u64>)> {
    let router = app.router.lock().await;
    router
        .states()
        .into_iter()
        .map(|v| {
            let age = router.message_age_ms(v.sysid, HEARTBEAT_ID);
            (v, age)
        })
        .collect()
}

/// Configured camera profiles, each with its driver snapshot when one runs.
async fn cameras(app: &AppState) -> Vec<(CameraProfile, Option<CameraSnapshot>)> {
    let sysids = app.store.camera_profile_sysids().await.unwrap_or_default();
    let snapshots = app.cameras.snapshot().await;
    let mut out = Vec::with_capacity(sysids.len());
    for sysid in sysids {
        if let Ok(profile) = app.store.camera_profile(sysid).await {
            let snap = snapshots.iter().find(|s| s.sysid == sysid).cloned();
            out.push((profile, snap));
        }
    }
    out
}

/// Gathers every input, one lock at a time, and assembles the topology.
pub async fn collect(app: &AppState) -> NetworkTopology {
    let vehicles = vehicles(app).await;
    let link = app.link_stats.snapshot(app.link_stats.now_ms());
    let cameras = cameras(app).await;
    let video = app
        .video
        .snapshot()
        .await
        .into_iter()
        .map(|e| (e.sysid, e.status))
        .collect();
    assemble(&NetworkInputs {
        config: (*app.network).clone(),
        hostname: app.hostname.clone(),
        uptime_s: app.now_secs(),
        started_unix_ms: app.started_unix_ms(),
        now_unix_ms: crate::app::unix_ms(),
        vehicles,
        link,
        cameras,
        video,
        media: app.media.status(),
        clients: app.sessions.list(),
    })
}

/// Broadcasts the full topology every `period` (first frame after one period); skips the
/// tick while nobody listens.
pub async fn run_status(app: AppState, period: Duration) {
    let start = tokio::time::Instant::now() + period;
    let mut tick = tokio::time::interval_at(start, period);
    tick.set_missed_tick_behavior(MissedTickBehavior::Skip);
    loop {
        tick.tick().await;
        if app.tx.receiver_count() == 0 {
            continue;
        }
        let topology = collect(&app).await;
        let _ = app.tx.send(ServerMessage::NetworkStatus { topology });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rgcs_core::camera::{
        CameraCaps, CameraKind, CameraProfile, CameraSnapshot, CameraState, Firmware, VideoSource,
        VideoSourceMode,
    };
    use rgcs_core::network::{CameraTransport, ComponentKind, MavLinkKind};
    use rgcs_core::operator::Role as UserRole;
    use rgcs_core::vehicle::{LinkStatus, VehicleKind};
    use rgcs_mavlink::ComponentStats;

    fn comp(sysid: u8, compid: u8, kind: ComponentKind, rate: f32) -> ComponentStats {
        ComponentStats {
            sysid,
            compid,
            mav_type: None,
            autopilot: None,
            kind,
            rx_msgs_per_s: rate,
            rx_bytes_per_s: rate * 30.0,
            loss_pct: 0.0,
            last_rx_age_ms: 100,
        }
    }

    fn mt11_profile() -> CameraProfile {
        CameraProfile {
            kind: CameraKind::SiyiMt11,
            ..CameraProfile::default_for(1)
        }
    }

    fn connected_snapshot() -> CameraSnapshot {
        CameraSnapshot {
            sysid: 1,
            caps: CameraCaps::none(),
            state: CameraState {
                connected: true,
                ..CameraState::disconnected(1.0)
            },
        }
    }

    fn client(id: u64) -> ClientSession {
        ClientSession {
            id,
            username: "operator".into(),
            role: UserRole::Operator,
            addr: Some(format!("127.0.0.1:5{id}000")),
            browser: "Chrome".into(),
            connected_since_unix_ms: 1_000,
        }
    }

    fn inputs() -> NetworkInputs {
        let vehicle = VehicleState {
            kind: VehicleKind::Copter,
            link: LinkStatus::Ok,
            ..VehicleState::new(1, "UAV-01")
        };
        NetworkInputs {
            config: NetworkConfig {
                listen: "127.0.0.1:8110".parse().unwrap(),
                mavlink_url: "tcp:127.0.0.1:5760".into(),
                role: Role::Standalone,
            },
            hostname: "rgcs-pi".into(),
            uptime_s: 42,
            started_unix_ms: 1_000,
            now_unix_ms: 43_000,
            vehicles: vec![(vehicle, Some(400))],
            link: LinkStatsSnapshot {
                connected: true,
                connected_since_unix_ms: Some(2_000),
                reconnects: 0,
                last_error: None,
                rx_msgs_per_s: 33.0,
                rx_bytes_per_s: 990.0,
                loss_pct: 0.0,
                last_rx_age_ms: Some(20),
                rx_stale: false,
                components: vec![
                    comp(1, 1, ComponentKind::Autopilot, 30.0),
                    comp(1, 100, ComponentKind::Camera, 2.0),
                    comp(255, 190, ComponentKind::Gcs, 1.0),
                ],
            },
            cameras: vec![(mt11_profile(), Some(connected_snapshot()))],
            video: vec![(
                1,
                VideoSourceStatus {
                    mode: VideoSourceMode::Auto,
                    source: VideoSource::Mt11,
                    scanning: false,
                    probe_ok: true,
                    whep_path: "mt11".into(),
                },
            )],
            media: MediaServer {
                whep_upstream: "http://127.0.0.1:8889/mt11/whep".into(),
                reachable: Some(true),
            },
            clients: vec![client(1), client(2)],
        }
    }

    #[test]
    fn vehicle_gets_its_components_and_camera() {
        let t = assemble(&inputs());
        let v = &t.vehicles[0];
        let compids: Vec<u8> = v.components.iter().map(|c| c.compid).collect();
        assert_eq!(compids, vec![1, 100]);
        let cam = v.camera.clone().expect("camera");
        assert_eq!(cam.kind, CameraKind::SiyiMt11);
        assert_eq!(cam.transport, CameraTransport::TcpUdp);
        assert_eq!(cam.endpoint, "192.168.144.25:37260");
        assert!(cam.connected);
        assert!(v.video.clone().unwrap().probe_ok);
        assert_eq!(v.heartbeat_age_ms, Some(400));
        assert_eq!(v.link_id, "link0");
        assert_eq!(t.clients.len(), 2);
    }

    #[test]
    fn mavlink_camera_is_via_fc() {
        let profile = CameraProfile {
            kind: CameraKind::Mavlink,
            comp_id: 100,
            ..CameraProfile::default_for(1)
        };
        let i = NetworkInputs {
            cameras: vec![(profile, None)],
            ..inputs()
        };
        let cam = assemble(&i).vehicles[0].camera.clone().expect("camera");
        assert_eq!(cam.transport, CameraTransport::ViaFc);
        assert_eq!(cam.endpoint, "FC · compid 100");
        assert!(!cam.connected);
    }

    #[test]
    fn kind_none_has_no_camera() {
        let i = NetworkInputs {
            cameras: vec![(CameraProfile::default_for(1), None)],
            ..inputs()
        };
        assert_eq!(assemble(&i).vehicles[0].camera, None);
    }

    #[test]
    fn firmware_is_the_camera_version_when_known() {
        let mut snap = connected_snapshot();
        snap.state.firmware = Some(Firmware {
            camera: "1.2.3".into(),
            gimbal: String::new(),
            zoom: String::new(),
        });
        let i = NetworkInputs {
            cameras: vec![(mt11_profile(), Some(snap))],
            ..inputs()
        };
        let cam = assemble(&i).vehicles[0].camera.clone().unwrap();
        assert_eq!(cam.firmware.as_deref(), Some("1.2.3"));
    }

    #[test]
    fn non_vehicle_system_only_in_link() {
        let t = assemble(&inputs());
        assert!(t.vehicles.iter().all(|v| v.sysid != 255));
        let gcs = t.links[0]
            .systems
            .iter()
            .find(|s| s.sysid == 255)
            .expect("gcs system");
        assert!(!gcs.vehicle);
        let fc = t.links[0]
            .systems
            .iter()
            .find(|s| s.sysid == 1)
            .expect("fc system");
        assert!(fc.vehicle);
    }

    fn link_kind(url: &str) -> (MavLinkKind, String) {
        let mut i = inputs();
        i.config.mavlink_url = url.into();
        let t = assemble(&i);
        (t.links[0].kind, t.links[0].url.clone())
    }

    #[test]
    fn link_fields_from_config_and_stats() {
        assert_eq!(
            link_kind("tcp:127.0.0.1:5760"),
            (MavLinkKind::Tcp, "tcp:127.0.0.1:5760".to_string())
        );
        assert_eq!(link_kind("udpin:0.0.0.0:14550").0, MavLinkKind::Udpin);
        assert_eq!(link_kind("udpout:10.0.0.2:14550").0, MavLinkKind::Udpout);
        assert_eq!(link_kind("/dev/ttyAMA0,921600").0, MavLinkKind::Serial);
        let t = assemble(&inputs());
        assert_eq!(t.links[0].id, "link0");
        assert!(t.links[0].connected);
        assert_eq!(t.links[0].rx_msgs_per_s, 33.0);
        assert_eq!(t.links[0].connected_since_unix_ms, Some(2_000));
    }

    #[test]
    fn stale_rx_is_carried_to_the_link() {
        assert!(!assemble(&inputs()).links[0].stale);
        let mut i = inputs();
        i.link.rx_stale = true;
        assert!(assemble(&i).links[0].stale);
    }

    #[test]
    fn server_node_fields() {
        let s = assemble(&inputs()).server;
        assert_eq!(s.role, "standalone");
        assert_eq!(s.listen, "127.0.0.1:8110");
        assert_eq!(s.uptime_s, 42);
        assert_eq!(s.hostname, "rgcs-pi");
        assert_eq!(s.version, env!("CARGO_PKG_VERSION"));
        assert_eq!(s.build, crate::BUILD);
    }

    #[test]
    fn unconfigured_is_the_standalone_list() {
        let t = assemble(&inputs());
        assert_eq!(t.unconfigured, UNCONFIGURED_STANDALONE.to_vec());
        assert_eq!(t.at_unix_ms, 43_000);
    }

    #[test]
    fn redact_url_strips_userinfo() {
        assert_eq!(
            redact_url("http://u:p@10.0.0.2:8889/mt11/whep"),
            "http://10.0.0.2:8889/mt11/whep"
        );
        assert_eq!(redact_url("http://u@10.0.0.2/x"), "http://10.0.0.2/x");
        assert_eq!(
            redact_url("http://10.0.0.2:8889/mt11/whep"),
            "http://10.0.0.2:8889/mt11/whep"
        );
        assert_eq!(redact_url("not a url"), "(invalid url)");
    }

    #[test]
    fn redact_url_drops_query_and_fragment_where_tokens_live() {
        assert_eq!(
            redact_url("http://10.0.0.2:8889/mt11/whep?token=s3cret&x=1#frag"),
            "http://10.0.0.2:8889/mt11/whep"
        );
        assert_eq!(
            redact_url("rtsp://u:p@cam:8554/live?auth=abc"),
            "rtsp://cam:8554/live"
        );
    }
}
