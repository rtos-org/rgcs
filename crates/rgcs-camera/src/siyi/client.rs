//! MT11 client: one actor task owning the TCP control link (heartbeat, polls, replies) and
//! the UDP socket for gimbal motion; `Camera` on top.

use std::net::{Ipv4Addr, SocketAddr};
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use rgcs_core::{CameraCaps, CameraCommand, CameraState};
use tokio::io::AsyncWriteExt;
use tokio::net::tcp::OwnedWriteHalf;
use tokio::net::{TcpStream, UdpSocket};
use tokio::sync::{mpsc, oneshot, watch, Mutex};
use tokio::task::JoinHandle;

use crate::camera::GpsTime;
use crate::siyi::apply::Media;
use crate::siyi::expire::offline;
use crate::siyi::frame::{check_allowed, make_packet};
use crate::siyi::session::{session, Ctx, SessionEnd};
use crate::{Camera, CameraError};

pub const DEFAULT_PORT: u16 = 37260;
pub const RECONNECT_AFTER: Duration = Duration::from_secs(1);
/// The camera answers 0x0A / 0x0D every second; silence longer than this means it is gone.
pub const READ_TIMEOUT: Duration = Duration::from_secs(3);
pub const CONNECT_TIMEOUT: Duration = Duration::from_secs(3);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Transport {
    Tcp,
    Udp,
}

pub(crate) type Reply = oneshot::Sender<Result<(), CameraError>>;

pub(crate) enum Op {
    Command(CameraCommand, Reply),
    Check(CameraCommand, Reply),
    Raw(u8, Vec<u8>, Transport, Reply),
}

pub struct SiyiMt11 {
    addr: SocketAddr,
    caps: CameraCaps,
    state: watch::Sender<CameraState>,
    gps: Option<Arc<dyn GpsTime>>,
    ops: Mutex<Option<mpsc::Sender<Op>>>,
    task: Mutex<Option<JoinHandle<()>>>,
}

impl SiyiMt11 {
    pub fn new(host: Ipv4Addr, port: u16) -> Self {
        let caps = CameraCaps::siyi_mt11();
        let zoom_max = caps.zoom.as_ref().map_or(1.0, |z| z.max);
        let (state, _) = watch::channel(CameraState::disconnected(zoom_max));
        Self {
            addr: SocketAddr::from((host, port)),
            caps,
            state,
            gps: None,
            ops: Mutex::new(None),
            task: Mutex::new(None),
        }
    }

    /// GPS time for clock sync; without one, sync is off and `SyncClock` is refused.
    pub fn with_gps_time(self, src: Arc<dyn GpsTime>) -> Self {
        Self {
            gps: Some(src),
            ..self
        }
    }

    async fn submit(&self, make: impl FnOnce(Reply) -> Op) -> Result<(), CameraError> {
        if !self.state.borrow().connected {
            return Err(CameraError::NotConnected);
        }
        let sender = self.ops.lock().await.clone().ok_or(CameraError::NotConnected)?;
        let (tx, rx) = oneshot::channel();
        sender
            .send(make(tx))
            .await
            .map_err(|_| CameraError::NotConnected)?;
        rx.await.unwrap_or(Err(CameraError::NotConnected))
    }

    /// Escape hatch for probes; `0x48` is refused before anything else happens.
    pub async fn raw_send(&self, cmd: u8, data: &[u8], transport: Transport) -> Result<(), CameraError> {
        check_allowed(cmd)?;
        let data = data.to_vec();
        self.submit(|reply| Op::Raw(cmd, data, transport, reply)).await
    }
}

#[async_trait]
impl Camera for SiyiMt11 {
    fn caps(&self) -> CameraCaps {
        self.caps.clone()
    }

    async fn send(&self, cmd: CameraCommand) -> Result<(), CameraError> {
        self.submit(|reply| Op::Command(cmd, reply)).await
    }

    async fn check(&self, cmd: &CameraCommand) -> Result<(), CameraError> {
        let cmd = cmd.clone();
        self.submit(|reply| Op::Check(cmd, reply)).await
    }

    fn state(&self) -> watch::Receiver<CameraState> {
        self.state.subscribe()
    }

    async fn connect(&self) -> Result<(), CameraError> {
        let mut ops = self.ops.lock().await;
        if ops.is_some() {
            return Ok(());
        }
        let (tx, rx) = mpsc::channel(32);
        *ops = Some(tx);
        let handle = tokio::spawn(run(self.addr, self.state.clone(), rx, self.gps.clone()));
        *self.task.lock().await = Some(handle);
        Ok(())
    }

    async fn disconnect(&self) {
        self.ops.lock().await.take();
        if let Some(h) = self.task.lock().await.take() {
            h.abort();
        }
        self.state.send_modify(|s| *s = offline(s));
    }

    async fn request_attitude(&self) -> Result<(), CameraError> {
        self.raw_send(0x0D, &[], Transport::Tcp).await
    }
}

/// TCP connect with [`CONNECT_TIMEOUT`] and Nagle off: a 0x0D attitude request must not wait
/// behind an un-ACKed heartbeat (ROI rate-mode latency).
pub(crate) async fn open_tcp(addr: SocketAddr) -> std::io::Result<TcpStream> {
    let stream = tokio::time::timeout(CONNECT_TIMEOUT, TcpStream::connect(addr))
        .await
        .map_err(|_| std::io::Error::new(std::io::ErrorKind::TimedOut, "connect timed out"))??;
    stream.set_nodelay(true)?;
    Ok(stream)
}

/// Connect → serve → (on loss) wait 1 s → connect again, until the op channel is dropped.
/// `Media` outlives a session so the clock state machine sees the reconnect.
async fn run(
    addr: SocketAddr,
    state: watch::Sender<CameraState>,
    mut ops: mpsc::Receiver<Op>,
    gps: Option<Arc<dyn GpsTime>>,
) {
    let udp = match UdpSocket::bind("0.0.0.0:0").await {
        Ok(u) => u,
        Err(e) => {
            state.send_modify(|s| s.last_error = Some(format!("udp bind: {e}")));
            return;
        }
    };
    let ctx = Ctx::new(&udp, addr, &state, gps.as_deref());
    let mut seq: u16 = 0;
    let mut media = Media::default();
    loop {
        match open_tcp(addr).await {
            Ok(stream) => {
                state.send_modify(|s| {
                    s.connected = true;
                    s.last_error = None;
                });
                let (end, next) = session(stream, &ctx, &mut ops, &mut seq, media).await;
                media = ctx.after_session(&next);
                state.send_modify(|s| {
                    let last_error = match &end {
                        SessionEnd::Lost(reason) => Some(reason.clone()),
                        SessionEnd::Closed => s.last_error.clone(),
                    };
                    *s = CameraState {
                        last_error,
                        ..offline(s)
                    }
                });
                if matches!(end, SessionEnd::Closed) {
                    return;
                }
            }
            Err(e) => state.send_modify(|s| s.last_error = Some(format!("connect: {e}"))),
        }
        if !wait_offline(&mut ops).await {
            return;
        }
    }
}

/// Offline: refuse commands immediately rather than queueing them (Review Focus 1).
/// `false` when the op channel closed.
async fn wait_offline(ops: &mut mpsc::Receiver<Op>) -> bool {
    let wait = tokio::time::sleep(RECONNECT_AFTER);
    tokio::pin!(wait);
    loop {
        tokio::select! {
            _ = &mut wait => return true,
            op = ops.recv() => match op {
                None => return false,
                Some(Op::Command(_, reply)) | Some(Op::Check(_, reply)) | Some(Op::Raw(_, _, _, reply)) => {
                    let _ = reply.send(Err(CameraError::NotConnected));
                }
            },
        }
    }
}

pub(crate) struct Link<'a> {
    pub(crate) wr: OwnedWriteHalf,
    pub(crate) udp: &'a UdpSocket,
    pub(crate) addr: SocketAddr,
    pub(crate) seq: &'a mut u16,
}

impl Link<'_> {
    pub(crate) async fn tcp(&mut self, cmd: u8, data: &[u8]) -> Result<(), CameraError> {
        check_allowed(cmd)?;
        *self.seq = self.seq.wrapping_add(1);
        self.wr
            .write_all(&make_packet(cmd, data, 1, *self.seq))
            .await
            .map_err(|e| CameraError::Io(e.to_string()))
    }

    pub(crate) async fn udp(&mut self, cmd: u8, data: &[u8]) -> Result<(), CameraError> {
        check_allowed(cmd)?;
        *self.seq = self.seq.wrapping_add(1);
        self.udp
            .send_to(&make_packet(cmd, data, 1, *self.seq), self.addr)
            .await
            .map(|_| ())
            .map_err(|e| CameraError::Io(e.to_string()))
    }
}

#[cfg(test)]
#[path = "client_tests.rs"]
mod tests;
