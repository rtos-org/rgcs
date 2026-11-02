//! MT11 simulator for tests and the dev stack: answers the P2 command subset the way the
//! Python app observed the camera doing, and records every frame it receives.

use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, UdpSocket};
use tokio::sync::mpsc;
use tokio::task::JoinHandle;

pub use crate::siyi::client::Transport;
use crate::siyi::frame::{make_packet, Parser};
use crate::siyi::sim_media::{candidate_frame, media_reply, track_frame, SimDetection, SimMedia};

pub const FIRMWARE_REPLY: [u8; 12] = [0x01, 0x00, 0x01, 0x89, 0x0A, 0x01, 0x00, 0x8A, 0, 0, 0, 0];

#[derive(Debug, Clone)]
pub struct SimState {
    pub record_sta: u8,
    pub zoom: (u8, u8),
    pub video_mode: (u8, u8),
    /// 0 lock, 1 follow, 2 fpv (0x19 encoding).
    pub gimbal_mode: u8,
    /// Attitude as reported by 0x0D (+yaw = left), degrees.
    pub yaw_deg: f32,
    pub pitch_deg: f32,
    /// Last 0x07 speed (yaw, pitch), −100..100, +yaw = right; 1 unit = 1 °/s.
    pub rate: (i8, i8),
    /// When `yaw_deg` / `pitch_deg` were last brought up to date.
    pub moved_at: Instant,
    pub media: SimMedia,
}

const PUSH_TICK: std::time::Duration = std::time::Duration::from_millis(100);
const PITCH_RANGE: (f32, f32) = (-90.0, 30.0);
const DEG_PER_S_PER_UNIT: f32 = 1.0;

impl Default for SimState {
    fn default() -> Self {
        Self {
            record_sta: 0,
            zoom: (1, 0),
            video_mode: (0, 2),
            gimbal_mode: 1,
            yaw_deg: 90.5,
            pitch_deg: -30.0,
            rate: (0, 0),
            moved_at: Instant::now(),
            media: SimMedia::default(),
        }
    }
}

fn wrap_deg(v: f32) -> f32 {
    let w = (v + 180.0).rem_euclid(360.0) - 180.0;
    if w == -180.0 {
        180.0
    } else {
        w
    }
}

/// The attitude after turning at `rate` since `moved_at` (0x07 +yaw = right, attitude +yaw = left).
fn moved(s: &SimState, now: Instant) -> SimState {
    let dt = now.saturating_duration_since(s.moved_at).as_secs_f32();
    let yaw = s.yaw_deg - f32::from(s.rate.0) * DEG_PER_S_PER_UNIT * dt;
    let pitch = s.pitch_deg + f32::from(s.rate.1) * DEG_PER_S_PER_UNIT * dt;
    SimState {
        yaw_deg: wrap_deg(yaw),
        pitch_deg: pitch.clamp(PITCH_RANGE.0, PITCH_RANGE.1),
        moved_at: now,
        ..s.clone()
    }
}

fn tenths(payload: &[u8], i: usize) -> Option<f32> {
    let b = payload.get(i * 2..i * 2 + 2)?;
    Some(f32::from(i16::from_le_bytes([b[0], b[1]])) / 10.0)
}

/// 0x07 / 0x0E / 0x0D: the simulated gimbal moves and reports where it points.
fn gimbal_reply(s: &mut SimState, cmd: u8, payload: &[u8]) -> Option<(u8, Vec<u8>)> {
    let now = moved(s, Instant::now());
    match cmd {
        0x07 => {
            let (yaw, pitch) = (*payload.first()? as i8, *payload.get(1)? as i8);
            *s = SimState {
                rate: (yaw, pitch),
                ..now
            };
            None
        }
        0x0E => {
            let (yaw, pitch) = (tenths(payload, 0)?, tenths(payload, 1)?);
            *s = SimState {
                yaw_deg: wrap_deg(yaw),
                pitch_deg: pitch.clamp(PITCH_RANGE.0, PITCH_RANGE.1),
                ..now
            };
            None
        }
        _ => {
            let yaw = (now.yaw_deg * 10.0).round() as i16;
            let pitch = (now.pitch_deg * 10.0).round() as i16;
            *s = now;
            let data = [yaw, pitch, 5, 0, 0, 0]
                .iter()
                .flat_map(|v| v.to_le_bytes())
                .collect();
            Some((0x0D, data))
        }
    }
}

type Received = (Transport, u8, Vec<u8>);

pub struct SimServer {
    pub addr: SocketAddr,
    pub received: mpsc::UnboundedReceiver<Received>,
    state: Arc<Mutex<SimState>>,
    tasks: Arc<Mutex<Vec<JoinHandle<()>>>>,
    /// When set, TCP connections stay open but nothing is answered (a hung / power-cycled camera).
    frozen: Arc<std::sync::atomic::AtomicBool>,
}

/// Reply (cmd, data) for a request, updating the simulated state.
pub fn reply_for(state: &Mutex<SimState>, cmd: u8, payload: &[u8]) -> Option<(u8, Vec<u8>)> {
    let mut s = state.lock().expect("sim state");
    match cmd {
        0x01 => Some((0x01, FIRMWARE_REPLY.to_vec())),
        0x0A => Some((0x0A, vec![0, 0, 0, s.record_sta])),
        0x0C => match payload.first()? {
            2 => {
                s.record_sta = if s.record_sta == 1 { 0 } else { 1 };
                Some((0x0B, vec![if s.record_sta == 1 { 5 } else { 6 }]))
            }
            f @ 3..=5 => {
                s.gimbal_mode = f - 3;
                Some((0x0C, vec![*f]))
            }
            f => Some((0x0C, vec![*f])),
        },
        0x0F => {
            s.zoom = (*payload.first()?, *payload.get(1)?);
            Some((0x0F, vec![s.zoom.0, s.zoom.1]))
        }
        0x18 => Some((0x18, vec![s.zoom.0, s.zoom.1])),
        0x10 => Some((0x10, vec![s.video_mode.0, s.video_mode.1])),
        0x11 => {
            s.video_mode = (*payload.first()?, *payload.get(1)?);
            Some((0x11, vec![s.video_mode.0, s.video_mode.1]))
        }
        0x19 => Some((0x19, vec![s.gimbal_mode])),
        0x07 | 0x0D | 0x0E => gimbal_reply(&mut s, cmd, payload),
        _ => media_reply(&mut s.media, cmd, payload, Instant::now(), unix_now_us()),
    }
}

fn unix_now_us() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_micros() as u64)
}

/// Ephemeral TCP ports tried before giving up on finding one whose UDP side is free too.
const EPHEMERAL_ATTEMPTS: usize = 32;

/// Binds TCP and UDP on the same port, trying each candidate (0 = ephemeral) in turn: the
/// port the kernel hands the TCP listener may already be taken on UDP.
async fn bind_pair(candidates: impl IntoIterator<Item = u16>) -> std::io::Result<(TcpListener, UdpSocket)> {
    let mut last = std::io::Error::new(std::io::ErrorKind::AddrInUse, "no candidate port");
    for port in candidates {
        match bind_one(port).await {
            Ok(pair) => return Ok(pair),
            Err(e) => last = e,
        }
    }
    Err(last)
}

async fn bind_one(port: u16) -> std::io::Result<(TcpListener, UdpSocket)> {
    let listener = TcpListener::bind(("127.0.0.1", port)).await?;
    let udp = UdpSocket::bind(listener.local_addr()?).await?;
    Ok((listener, udp))
}

impl SimServer {
    pub async fn start() -> Self {
        Self::start_on(0).await
    }

    /// TCP and UDP on the same port (0 = ephemeral).
    pub async fn start_on(port: u16) -> Self {
        let attempts = if port == 0 { EPHEMERAL_ATTEMPTS } else { 1 };
        let (listener, udp) = bind_pair(std::iter::repeat_n(port, attempts))
            .await
            .expect("sim tcp + udp bind");
        let addr = listener.local_addr().expect("sim addr");
        let (tx, received) = mpsc::unbounded_channel();
        let state = Arc::new(Mutex::new(SimState::default()));
        let tasks: Arc<Mutex<Vec<JoinHandle<()>>>> = Arc::new(Mutex::new(Vec::new()));
        let frozen = Arc::new(std::sync::atomic::AtomicBool::new(false));

        let accept = {
            let (tx, state, tasks, frozen) = (tx.clone(), state.clone(), tasks.clone(), frozen.clone());
            tokio::spawn(async move {
                loop {
                    let Ok((stream, _)) = listener.accept().await else {
                        return;
                    };
                    let (tx, state, frozen) = (tx.clone(), state.clone(), frozen.clone());
                    let conn = tokio::spawn(serve_tcp(stream, tx, state, frozen));
                    tasks.lock().expect("sim tasks").push(conn);
                }
            })
        };
        let udp_task = {
            let (tx, state) = (tx.clone(), state.clone());
            tokio::spawn(async move {
                let mut buf = [0u8; 2048];
                let mut parser = Parser::default();
                while let Ok((n, _)) = udp.recv_from(&mut buf).await {
                    for f in parser.push(&buf[..n]) {
                        let _ = reply_for(&state, f.cmd, &f.payload);
                        let _ = tx.send((Transport::Udp, f.cmd, f.payload));
                    }
                }
            })
        };
        tasks.lock().expect("sim tasks").extend([accept, udp_task]);
        Self {
            addr,
            received,
            state,
            tasks,
            frozen,
        }
    }

    /// Stop answering (connections stay open) — the client must notice by itself.
    pub fn freeze(&self) {
        self.frozen.store(true, std::sync::atomic::Ordering::Relaxed);
    }

    pub fn thaw(&self) {
        self.frozen.store(false, std::sync::atomic::Ordering::Relaxed);
    }

    pub fn set_zoom(&self, int_part: u8, tenths: u8) {
        self.state.lock().expect("sim state").zoom = (int_part, tenths);
    }

    pub fn set_record(&self, sta: u8) {
        self.state.lock().expect("sim state").record_sta = sta;
    }

    pub fn set_tf_card(&self, status: u8, total_x100: u16, free_x100: u16) {
        let mut s = self.state.lock().expect("sim state");
        s.media.tf = (status, s.media.tf.1, total_x100, free_x100);
    }

    /// The sim clock's offset from the host clock (until the next 0x30 sets it).
    pub fn set_clock_offset_us(&self, offset: i64) {
        let mut s = self.state.lock().expect("sim state");
        s.media = SimMedia {
            clock_offset_us: offset,
            utc_set_at: None,
            ..s.media.clone()
        };
    }

    /// The tracker reports status 2 (lost) on the next pushes.
    pub fn lose_track(&self) {
        self.state.lock().expect("sim state").media.track_status = 2;
    }

    /// The next `n` 0x20 replies after each 0x21 still report the previous size.
    pub fn set_stale_encoding_replies(&self, n: u8) {
        self.state.lock().expect("sim state").media.stale_encoding_replies = n;
    }

    /// Every following 0x21 is refused (`[1, 0]`) and the encoding stays.
    pub fn set_reject_encoding(&self, reject: bool) {
        self.state.lock().expect("sim state").media.reject_encoding = reject;
    }

    pub fn set_detections(&self, d: Vec<SimDetection>) {
        self.state.lock().expect("sim state").media.detections = d;
    }

    /// Drops the listener and every live connection (the client sees EOF).
    pub async fn stop(self) {
        for t in self.tasks.lock().expect("sim tasks").drain(..) {
            t.abort();
        }
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
}

async fn serve_tcp(
    mut stream: tokio::net::TcpStream,
    tx: mpsc::UnboundedSender<Received>,
    state: Arc<Mutex<SimState>>,
    frozen: Arc<std::sync::atomic::AtomicBool>,
) {
    // Like the real client: replies must not wait behind Nagle.
    let _ = stream.set_nodelay(true);
    let mut buf = [0u8; 4096];
    let mut parser = Parser::default();
    let mut seq: u16 = 0;
    let started = Instant::now();
    let mut ticker = tokio::time::interval(PUSH_TICK);
    let mut ticks: u64 = 0;
    loop {
        let mut out: Vec<(u8, Vec<u8>)> = Vec::new();
        tokio::select! {
            read = stream.read(&mut buf) => {
                let n = match read {
                    Ok(0) | Err(_) => return,
                    Ok(n) => n,
                };
                for f in parser.push(&buf[..n]) {
                    let reply = reply_for(&state, f.cmd, &f.payload);
                    let _ = tx.send((Transport::Tcp, f.cmd, f.payload));
                    out.extend(reply);
                }
            }
            _ = ticker.tick() => {
                ticks += 1;
                out.extend(pushes(&state, ticks, started));
            }
        }
        if frozen.load(std::sync::atomic::Ordering::Relaxed) {
            continue;
        }
        for (cmd, data) in out {
            seq = seq.wrapping_add(1);
            if stream.write_all(&make_packet(cmd, &data, 2, seq)).await.is_err() {
                return;
            }
        }
    }
}

/// 0x50 every tick, 0x5F every second tick, while the camera is being asked for them.
fn pushes(state: &Mutex<SimState>, ticks: u64, started: Instant) -> Vec<(u8, Vec<u8>)> {
    let s = state.lock().expect("sim state");
    let track = track_frame(&s.media).map(|d| (0x50, d));
    let pts = started.elapsed().as_micros() as u64;
    let boxes = (ticks % 2 == 0).then(|| candidate_frame(&s.media, pts)).flatten();
    track.into_iter().chain(boxes.map(|d| (0x5F, d))).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::siyi::{encode, parse};
    use std::time::{Duration, Instant};

    fn attitude(state: &Mutex<SimState>) -> (f32, f32) {
        let (cmd, data) = reply_for(state, 0x0D, &[]).expect("0x0D reply");
        assert_eq!(cmd, 0x0D);
        let (yaw, pitch, _) = parse::attitude(&data).expect("attitude decodes");
        (yaw, pitch)
    }

    fn rewind(state: &Mutex<SimState>, by: Duration) {
        let mut s = state.lock().expect("sim state");
        s.moved_at = Instant::now() - by;
    }

    #[tokio::test]
    async fn bind_pair_skips_a_port_whose_udp_side_is_taken() {
        let taken = UdpSocket::bind(("127.0.0.1", 0)).await.expect("udp");
        let port = taken.local_addr().expect("addr").port();
        let (tcp, udp) = bind_pair([port, 0]).await.expect("a free pair");
        let addr = tcp.local_addr().expect("tcp addr");
        assert_ne!(addr.port(), port);
        assert_eq!(udp.local_addr().expect("udp addr"), addr);
    }

    #[test]
    fn sim_starts_at_the_legacy_attitude() {
        let state = Mutex::new(SimState::default());
        assert_eq!(attitude(&state), (90.5, -30.0));
    }

    #[test]
    fn sim_gimbal_turns_with_rate() {
        let state = Mutex::new(SimState::default());
        reply_for(&state, 0x07, &encode::gimbal_rate(10, 0));
        rewind(&state, Duration::from_secs(1));
        let (yaw, pitch) = attitude(&state);
        assert!((yaw - 80.5).abs() <= 1.5, "yaw {yaw}");
        assert!((pitch + 30.0).abs() <= 0.5, "pitch {pitch}");
    }

    #[test]
    fn sim_pitch_rate_is_clamped() {
        let state = Mutex::new(SimState::default());
        reply_for(&state, 0x07, &encode::gimbal_rate(0, 100));
        rewind(&state, Duration::from_secs(2));
        assert_eq!(attitude(&state).1, 30.0);
    }

    #[test]
    fn sim_angle_sets_attitude() {
        let state = Mutex::new(SimState::default());
        reply_for(&state, 0x0E, &encode::gimbal_angle(-30.0, -45.0));
        assert_eq!(attitude(&state), (-30.0, -45.0));
    }
}
