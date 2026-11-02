//! One connected MT11 session: heartbeat, the 1 s poll schedule, received frames, the 250 ms
//! overlay expiry, commands, and clock sync.

use std::net::SocketAddr;
use std::time::{Duration, Instant};

use rgcs_core::{CameraCommand, CameraState, GimbalAttitude};
use tokio::io::AsyncReadExt;
use tokio::net::tcp::OwnedReadHalf;
use tokio::net::{TcpStream, UdpSocket};
use tokio::sync::{mpsc, watch};
use tokio::time::{interval, Interval, MissedTickBehavior};

use crate::camera::GpsTime;
use crate::clock_sync::{ClockAction, GpsSample};
use crate::siyi::ai;
use crate::siyi::apply::{apply_frame, clock_view, Media};
use crate::siyi::client::{Link, Op, Reply, Transport, READ_TIMEOUT};
use crate::siyi::encode;
use crate::siyi::exec::{check, exec};
use crate::siyi::expire::expire;
use crate::siyi::frame::Parser;
use crate::siyi::polls::due_polls;
use crate::CameraError;

const HEARTBEAT: Duration = Duration::from_secs(1);
const POLL: Duration = Duration::from_secs(1);
const EXPIRE_TICK: Duration = Duration::from_millis(250);
/// 0x20 is re-read this long after a 0x21 encoding change (`video_routes.py`).
const ENCODING_REREAD: Duration = Duration::from_millis(300);
/// How long an encoding command waits for its 0x21 ACK; without one it is reported as sent.
const ENCODING_ACK_TIMEOUT: Duration = Duration::from_millis(1000);
const ON_CONNECT: [u8; 4] = [0x01, 0x18, 0x10, 0x19];
/// Monotonic µs start here so `received_at = mono − age` never underflows for a sample young
/// enough to matter: anything older comes out ≥ 60 s old, i.e. stale.
const MONO_BASE_US: u64 = 60_000_000;

pub(crate) enum SessionEnd {
    Closed,
    Lost(String),
}

/// What a session borrows from the driver task.
pub(crate) struct Ctx<'a> {
    udp: &'a UdpSocket,
    addr: SocketAddr,
    state: &'a watch::Sender<CameraState>,
    gps: Option<&'a dyn GpsTime>,
    epoch: Instant,
}

impl<'a> Ctx<'a> {
    pub(crate) fn new(
        udp: &'a UdpSocket,
        addr: SocketAddr,
        state: &'a watch::Sender<CameraState>,
        gps: Option<&'a dyn GpsTime>,
    ) -> Self {
        Self {
            udp,
            addr,
            state,
            gps,
            epoch: Instant::now(),
        }
    }

    fn mono_us(&self) -> u64 {
        self.epoch.elapsed().as_micros() as u64 + MONO_BASE_US
    }

    /// Media after the link dropped: overlays and history go, the ACK counter stays and the
    /// clock state machine learns about the disconnect (it re-syncs on the next connect).
    pub(crate) fn after_session(&self, media: &Media) -> Media {
        let (clock, _) = media.clock.tick(self.mono_us(), false, None);
        Media {
            ack_seq: media.ack_seq,
            clock,
            clock_read_at: media.clock_read_at,
            ..Media::default()
        }
    }
}

fn wall_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as u64)
}

/// Replaces the state when `f` returns a new one (computed under the watch lock).
fn replace_if(state: &watch::Sender<CameraState>, f: impl FnOnce(&CameraState) -> Option<CameraState>) {
    state.send_if_modified(|s| match f(s) {
        Some(next) => {
            *s = next;
            true
        }
        None => false,
    });
}

fn ticker(period: Duration) -> Interval {
    let mut t = interval(period);
    t.set_missed_tick_behavior(MissedTickBehavior::Skip);
    t
}

fn lost(e: CameraError) -> SessionEnd {
    SessionEnd::Lost(e.to_string())
}

/// Session-local loop data; `media` is replaced on every change, never mutated in place.
struct Run {
    media: Media,
    tick: u64,
    parser: Parser,
    last_rx: tokio::time::Instant,
    last_attitude: Option<tokio::time::Instant>,
    reread: Option<tokio::time::Instant>,
    /// An encoding command's reply, held until its 0x21 ACK.
    encoding_wait: Option<(Reply, tokio::time::Instant)>,
}

pub(crate) async fn session(
    stream: TcpStream,
    ctx: &Ctx<'_>,
    ops: &mut mpsc::Receiver<Op>,
    seq: &mut u16,
    media: Media,
) -> (SessionEnd, Media) {
    let (mut rd, wr) = stream.into_split();
    let mut link = Link {
        wr,
        udp: ctx.udp,
        addr: ctx.addr,
        seq,
    };
    let mut run = Run {
        media,
        tick: 0,
        parser: Parser::default(),
        last_rx: tokio::time::Instant::now(),
        last_attitude: None,
        reread: None,
        encoding_wait: None,
    };
    let end = serve(&mut rd, &mut link, ctx, ops, &mut run).await;
    (end, run.media)
}

async fn serve(
    rd: &mut OwnedReadHalf,
    link: &mut Link<'_>,
    ctx: &Ctx<'_>,
    ops: &mut mpsc::Receiver<Op>,
    run: &mut Run,
) -> SessionEnd {
    for cmd in ON_CONNECT {
        if let Err(e) = link.tcp(cmd, &[]).await {
            return lost(e);
        }
    }
    let mut buf = [0u8; 4096];
    let (mut heartbeat, mut poll, mut expiry) = (ticker(HEARTBEAT), ticker(POLL), ticker(EXPIRE_TICK));
    loop {
        let watchdog = tokio::time::sleep_until(run.last_rx + READ_TIMEOUT);
        let reread = tokio::time::sleep_until(run.reread.unwrap_or(run.last_rx));
        let ack_wait = tokio::time::sleep_until(run.encoding_wait.as_ref().map_or(run.last_rx, |w| w.1));
        let step = tokio::select! {
            n = rd.read(&mut buf) => match n {
                Ok(0) => Err(SessionEnd::Lost("camera closed the connection".into())),
                Err(e) => Err(SessionEnd::Lost(e.to_string())),
                Ok(n) => { run.on_bytes(ctx, &buf[..n]); Ok(()) }
            },
            _ = watchdog => Err(SessionEnd::Lost("no reply from the camera for 3 s".into())),
            _ = heartbeat.tick() => link.tcp(0x00, &encode::heartbeat()).await.map_err(lost),
            _ = poll.tick() => run.on_poll(link, ctx).await.map_err(lost),
            _ = expiry.tick() => { replace_if(ctx.state, |s| expire(s, &run.media, Instant::now())); Ok(()) },
            _ = reread, if run.reread.is_some() => {
                run.reread = None;
                link.tcp(0x20, &ai::encoding_request()).await.map_err(lost)
            },
            _ = ack_wait, if run.encoding_wait.is_some() => {
                tracing::warn!("no 0x21 ACK for the encoding change; reporting it as sent");
                run.resolve_encoding(Ok(()));
                Ok(())
            },
            op = ops.recv() => match op {
                None => Err(SessionEnd::Closed),
                Some(op) => run.on_op(link, ctx, op).await,
            },
        };
        if let Err(end) = step {
            return end;
        }
    }
}

impl Run {
    fn on_bytes(&mut self, ctx: &Ctx<'_>, bytes: &[u8]) {
        self.last_rx = tokio::time::Instant::now();
        let (now, mono) = (Instant::now(), ctx.mono_us());
        for f in self.parser.push(bytes) {
            if f.cmd == 0x0D {
                self.last_attitude = Some(self.last_rx);
            }
            if let Some(ok) = (f.cmd == 0x21).then(|| ai::encoding_ack(&f.payload)).flatten() {
                self.resolve_encoding(if ok {
                    Ok(())
                } else {
                    Err(CameraError::Refused("encoding_rejected"))
                });
            }
            let mut next = None;
            replace_if(ctx.state, |s| {
                let (state, media) = apply_frame(s, &self.media, &f, now, mono);
                next = Some(media);
                state
            });
            self.media = next.unwrap_or_else(|| self.media.clone());
        }
    }

    /// Answers a held encoding command, if any.
    fn resolve_encoding(&mut self, r: Result<(), CameraError>) {
        if let Some((reply, _)) = self.encoding_wait.take() {
            let _ = reply.send(r);
        }
    }

    async fn on_poll(&mut self, link: &mut Link<'_>, ctx: &Ctx<'_>) -> Result<(), CameraError> {
        if let Some(t) = self.last_attitude {
            let age_ms = t.elapsed().as_millis() as u64;
            replace_if(ctx.state, |s| {
                let gimbal = s.gimbal.clone().map(|g| GimbalAttitude { age_ms, ..g });
                Some(CameraState { gimbal, ..s.clone() })
            });
        }
        self.media = clock_tick(link, ctx, &self.media).await?;
        let (mode, known) = {
            let s = ctx.state.borrow();
            (s.video_mode, s.stream.is_some())
        };
        for (cmd, data) in due_polls(self.tick, mode, known) {
            link.tcp(cmd, &data).await?;
        }
        self.tick += 1;
        Ok(())
    }

    async fn on_op(&mut self, link: &mut Link<'_>, ctx: &Ctx<'_>, op: Op) -> Result<(), SessionEnd> {
        let (cmd, reply) = match op {
            Op::Raw(cmd, data, transport, reply) => {
                let r = match transport {
                    Transport::Tcp => link.tcp(cmd, &data).await,
                    Transport::Udp => link.udp(cmd, &data).await,
                };
                let _ = reply.send(r);
                return Ok(());
            }
            Op::Check(cmd, reply) => {
                let snap = ctx.state.borrow().clone();
                let _ = reply.send(check(&snap, &self.media, &cmd));
                return Ok(());
            }
            Op::Command(cmd, reply) => (cmd, reply),
        };
        let is_encoding = matches!(cmd, CameraCommand::Encoding { .. });
        let r = match (&cmd, ctx.gps) {
            (CameraCommand::SyncClock, None) => Err(CameraError::Refused("clock_sync_off")),
            _ => exec(link, ctx.state, &self.media, cmd).await,
        };
        let r = r.map(|next| {
            self.media = next;
            if is_encoding {
                self.reread = Some(tokio::time::Instant::now() + ENCODING_REREAD);
            }
        });
        if is_encoding && r.is_ok() {
            self.resolve_encoding(Ok(()));
            self.encoding_wait = Some((reply, tokio::time::Instant::now() + ENCODING_ACK_TIMEOUT));
        } else {
            let _ = reply.send(r.clone());
        }
        match r {
            Err(CameraError::Io(e)) => Err(SessionEnd::Lost(format!("io: {e}"))),
            _ => Ok(()),
        }
    }
}

/// Runs the clock state machine (with a GPS source) and refreshes `state.clock`.
async fn clock_tick(link: &mut Link<'_>, ctx: &Ctx<'_>, media: &Media) -> Result<Media, CameraError> {
    let next = match ctx.gps {
        None => media.clone(),
        Some(gps) => {
            let at = ctx.mono_us();
            let sample = gps.sample().await.map(|t| GpsSample {
                unix_us: t.unix_us,
                received_at_us: at.saturating_sub(t.age_us),
            });
            let (clock, actions) = media.clock.tick(ctx.mono_us(), true, sample);
            for a in actions {
                match a {
                    ClockAction::SetUtc(us) => link.tcp(0x30, &encode::utc_time(us)).await?,
                    ClockAction::ReadBack => link.tcp(0x40, &[]).await?,
                }
            }
            Media {
                clock,
                ..media.clone()
            }
        }
    };
    replace_if(ctx.state, |s| {
        clock_view(s, &next, Instant::now(), ctx.mono_us(), wall_ms())
    });
    Ok(next)
}
