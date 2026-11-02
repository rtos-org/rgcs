//! Received MT11 frames → the next `CameraState` plus the actor-local `Media` data.

use std::time::{Duration, Instant};

use rgcs_core::{AiAck, CameraClock, CameraState, GimbalAttitude, ThermalPoint, ThermalState, TrackState};

use crate::clock_sync::{ClockStatus, ClockSync};
use crate::siyi::ai::{self, DetectionFrame, DETECTION_HISTORY, DETECTION_HISTORY_MAX};
use crate::siyi::frame::Frame;
use crate::siyi::{parse, tf_card, thermal};

/// Actor-local media bookkeeping: receive times for overlay expiry, the detection history,
/// the ACK counter and the clock-sync state machine. Replaced, never mutated.
#[derive(Debug, Clone, Default)]
pub struct Media {
    pub track_at: Option<Instant>,
    pub point_at: Option<Instant>,
    pub frame_at: Option<Instant>,
    pub candidates_at: Option<Instant>,
    pub history: Vec<(Instant, DetectionFrame)>,
    pub ack_seq: u32,
    pub clock: ClockSync,
    pub clock_read_at: Option<Instant>,
    /// The size a 0x21 asked for; until a 0x20 reports it (or [`ENCODING_SETTLE`] passes) the
    /// stream stays unknown and clicks are refused.
    pub pending_encoding: Option<PendingEncoding>,
}

/// An encoding change waiting for its 0x20 confirmation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PendingEncoding {
    pub size: (u16, u16),
    pub since: Instant,
}

/// How long a 0x21 change may take before any reported size is believed again.
pub const ENCODING_SETTLE: Duration = Duration::from_secs(3);

type Applied = (Option<CameraState>, Media);

/// `Some(state)` only when the frame changed something.
pub fn apply_frame(
    state: &CameraState,
    media: &Media,
    f: &Frame,
    now: Instant,
    mono_us: u64,
) -> (Option<CameraState>, Media) {
    let p = f.payload.as_slice();
    let same = |next: Option<CameraState>| (next, media.clone());
    let (next, media) = match f.cmd {
        0x12 | 0x14 | 0x37 | 0x38 => apply_thermal(state, media, f.cmd, p, now),
        0x20 => apply_encoding(state, media, p, now),
        0x21 => (None, apply_encoding_ack(media, p)),
        0x50 => apply_track(state, media, p, now),
        0x5F => apply_candidates(state, media, p, now),
        0x55 | 0x56 => apply_ack(state, media, f.cmd, p),
        0x49 => same(tf_card::parse_tf_card(p).map(|s| CameraState {
            storage: Some(s),
            ..state.clone()
        })),
        0x40 => apply_camera_time(state, media, p, now, mono_us),
        0x30 => apply_utc_ack(state, media, p),
        cmd => same(apply_basic(state, cmd, p)),
    };
    (next.filter(|n| n != state), media)
}

fn with(state: &CameraState, f: impl FnOnce(CameraState) -> CameraState) -> Option<CameraState> {
    Some(f(state.clone()))
}

/// Firmware, attitude, zoom, video mode, recording and gimbal mode replies.
fn apply_basic(state: &CameraState, cmd: u8, p: &[u8]) -> Option<CameraState> {
    let s = state.clone();
    match cmd {
        0x01 => parse::firmware(p).map(|fw| CameraState {
            firmware: Some(fw),
            ..s
        }),
        0x0D => parse::attitude(p).map(|(yaw, pitch, roll)| CameraState {
            gimbal: Some(GimbalAttitude {
                yaw,
                pitch,
                roll,
                age_ms: 0,
            }),
            ..s
        }),
        0x18 => parse::zoom(p).map(|zoom| CameraState { zoom, ..s }),
        0x10 | 0x11 => parse::video_mode(p).map(|reply| CameraState {
            video_mode: match reply {
                parse::VideoModeReply::Known(m) => Some(m),
                parse::VideoModeReply::Custom(..) => None,
            },
            ..s
        }),
        0x0A => parse::record_status(p).map(|recording| CameraState { recording, ..s }),
        0x0B => parse::record_feedback(p).map(|recording| CameraState { recording, ..s }),
        0x19 => parse::gimbal_mode(p).map(|m| CameraState {
            gimbal_mode: Some(m),
            ..s
        }),
        _ => None,
    }
}

/// 0x20: only the main stream (`stream_type == 1`) with a real size sets the resolution; a
/// 0 / 1-pixel reply (encoder restarting) is ignored, as in Python.
/// While a 0x21 change is pending, only the requested size (or any size after
/// [`ENCODING_SETTLE`]) is taken; an older reply is dropped.
fn apply_encoding(state: &CameraState, media: &Media, p: &[u8], now: Instant) -> Applied {
    let unchanged = (None, media.clone());
    let Some((1, info)) = ai::parse_encoding(p) else {
        return unchanged;
    };
    if !ai::usable_stream(info.width, info.height) {
        return unchanged;
    }
    let size = (info.width, info.height);
    if let Some(pending) = media.pending_encoding {
        let settled = now.saturating_duration_since(pending.since) >= ENCODING_SETTLE;
        if size != pending.size && !settled {
            return unchanged;
        }
        if size != pending.size {
            tracing::warn!(?size, wanted = ?pending.size, "encoding change not confirmed; using the reported size");
        }
    }
    let next = with(state, |s| CameraState {
        stream: Some(size),
        encoding: Some(info),
        ..s
    });
    (
        next,
        Media {
            pending_encoding: None,
            ..media.clone()
        },
    )
}

/// 0x21: a refused change ends the wait for its size, so the next 0x20 (the old size the
/// camera kept) is taken at once. The command reply is resolved by the session.
fn apply_encoding_ack(media: &Media, p: &[u8]) -> Media {
    match ai::encoding_ack(p) {
        Some(false) => Media {
            pending_encoding: None,
            ..media.clone()
        },
        _ => media.clone(),
    }
}

fn apply_thermal(state: &CameraState, media: &Media, cmd: u8, p: &[u8], now: Instant) -> Applied {
    let t = state.thermal.clone().unwrap_or(ThermalState {
        gain: None,
        range_c: None,
        frame: None,
        point: None,
    });
    let set = |t: ThermalState| {
        with(state, |s| CameraState {
            thermal: Some(t),
            ..s
        })
    };
    let unchanged = (None, media.clone());
    match cmd {
        0x14 => thermal::parse_full_frame(p).map_or(unchanged, |frame| {
            let next = set(ThermalState {
                frame: Some(frame),
                ..t
            });
            (
                next,
                Media {
                    frame_at: Some(now),
                    ..media.clone()
                },
            )
        }),
        0x12 => thermal::parse_point(p).map_or(unchanged, |(temp_c, xy)| {
            let point = ThermalPoint {
                temp_c,
                xy,
                age_ms: 0,
            };
            let next = set(ThermalState {
                point: Some(point),
                ..t
            });
            (
                next,
                Media {
                    point_at: Some(now),
                    ..media.clone()
                },
            )
        }),
        _ => thermal::parse_gain(p).map_or(unchanged, |g| {
            let next = set(ThermalState {
                gain: Some(g),
                range_c: Some(g.range_c()),
                ..t
            });
            (next, media.clone())
        }),
    }
}

/// 0x50: status 3 (cancelled) clears the track.
fn apply_track(state: &CameraState, media: &Media, p: &[u8], now: Instant) -> Applied {
    let Some((status, rect, target)) = ai::parse_track(p) else {
        return (None, media.clone());
    };
    let track = status.map(|status| TrackState {
        status,
        rect,
        target,
        age_ms: 0,
    });
    let track_at = track.as_ref().map(|_| now);
    let next = with(state, |s| CameraState { track, ..s });
    (
        next,
        Media {
            track_at,
            ..media.clone()
        },
    )
}

/// 0x5F push: newest boxes to the state, the frame into the 1.5 s / 60-frame history.
/// The enable ACK (`[5, 0]`) does not parse and is ignored.
fn apply_candidates(state: &CameraState, media: &Media, p: &[u8], now: Instant) -> Applied {
    let Some(frame) = ai::parse_candidates(p) else {
        return (None, media.clone());
    };
    let fresh: Vec<(Instant, DetectionFrame)> = media
        .history
        .iter()
        .cloned()
        .chain([(now, frame.clone())])
        .filter(|(t, _)| now.saturating_duration_since(*t) <= DETECTION_HISTORY)
        .collect();
    let history = fresh[fresh.len().saturating_sub(DETECTION_HISTORY_MAX)..].to_vec();
    let next = with(state, |s| CameraState {
        candidates: frame.detections,
        ..s
    });
    let media = Media {
        history,
        candidates_at: Some(now),
        ..media.clone()
    };
    (next, media)
}

/// 0x55 / 0x56 ACKs as fixed codes; `seq` counts every ACK so repeats are visible.
fn apply_ack(state: &CameraState, media: &Media, cmd: u8, p: &[u8]) -> Applied {
    let code = if cmd == 0x56 {
        ai::ai_select_ack(p)
    } else {
        ai::ai_mode_ack(p)
    };
    let Some(code) = code else {
        return (None, media.clone());
    };
    let seq = media.ack_seq.wrapping_add(1);
    let ai_ack = Some(AiAck {
        code: code.into(),
        seq,
    });
    (
        with(state, |s| CameraState { ai_ack, ..s }),
        Media {
            ack_seq: seq,
            ..media.clone()
        },
    )
}

/// 0x40: the camera clock reading; completes an in-flight sync read-back.
fn apply_camera_time(state: &CameraState, media: &Media, p: &[u8], now: Instant, mono_us: u64) -> Applied {
    let Some(camera_us) = parse::camera_time(p) else {
        return (None, media.clone());
    };
    let media = Media {
        clock: media.clock.on_camera_time(camera_us, mono_us),
        clock_read_at: Some(now),
        ..media.clone()
    };
    let synced_at = state.clock.as_ref().and_then(|c| c.synced_at_unix_ms);
    let clock = clock_fields(media.clock.status(), Some(camera_us), Some(0), synced_at);
    (
        with(state, |s| CameraState {
            clock: Some(clock),
            ..s
        }),
        media,
    )
}

/// 0x30: a rejected time fails the sync; an accepted one changes nothing.
fn apply_utc_ack(state: &CameraState, media: &Media, p: &[u8]) -> Applied {
    let clock = match parse::utc_ack(p) {
        Some(accepted) => media.clock.on_utc_ack(accepted),
        None => return (None, media.clone()),
    };
    if clock == media.clock {
        return (None, media.clone());
    }
    let old = state.clock.as_ref();
    let fields = clock_fields(
        clock.status(),
        old.and_then(|c| c.camera_unix_us),
        old.and_then(|c| c.reading_age_ms),
        old.and_then(|c| c.synced_at_unix_ms),
    );
    let next = with(state, |s| CameraState {
        clock: Some(fields),
        ..s
    });
    (
        next,
        Media {
            clock,
            ..media.clone()
        },
    )
}

fn clock_fields(
    st: &ClockStatus,
    camera_unix_us: Option<u64>,
    reading_age_ms: Option<u64>,
    synced_at_unix_ms: Option<u64>,
) -> CameraClock {
    CameraClock {
        camera_unix_us,
        reading_age_ms,
        offset_ms: st.offset_ms,
        rtt_ms: st.rtt_ms,
        synced_at_unix_ms,
        error: st.error.map(String::from),
    }
}

/// `state.clock` from the clock state machine plus the last 0x40 reading.
/// `synced_at_unix_ms` maps the sync's monotonic time onto the wall clock.
pub fn clock_view(
    state: &CameraState,
    media: &Media,
    now: Instant,
    mono_us: u64,
    wall_ms: u64,
) -> Option<CameraState> {
    let st = media.clock.status();
    if state.clock.is_none() && media.clock_read_at.is_none() && *st == ClockStatus::default() {
        return None;
    }
    let camera_us = state.clock.as_ref().and_then(|c| c.camera_unix_us);
    let age_ms = media
        .clock_read_at
        .map(|t| now.saturating_duration_since(t).as_millis() as u64);
    let synced_at = st
        .last_sync_at_us
        .map(|t| wall_ms.saturating_sub(mono_us.saturating_sub(t) / 1000));
    let clock = Some(clock_fields(st, camera_us, age_ms, synced_at));
    (state.clock != clock).then(|| CameraState {
        clock,
        ..state.clone()
    })
}

#[cfg(test)]
#[path = "apply_tests.rs"]
mod tests;
