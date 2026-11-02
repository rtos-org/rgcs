//! When the driver asks for info and streams: `REQUEST_MESSAGE` 259 / 280
//! to every component every 2 s while unbound and once more on each reconnect edge;
//! `SET_MESSAGE_INTERVAL` for 260 / 262 / 285 to the bound components when the message is more
//! than 3 s stale, at most every 5 s per message. This also runs while bound but disconnected:
//! ArduPilot sends the info once and streams nothing until asked (and an FC reboot drops the
//! rates), so the requested streams are what (re)connects the driver.

use std::collections::BTreeMap;

use mavlink::dialects::ardupilotmega::MavMessage;
use rgcs_core::SysId;

use crate::mavlink_cam::apply::Model;
use crate::mavlink_cam::encode::{message_interval, request_message};

pub const INFO_RETRY_MS: u64 = 2_000;
pub const STREAM_RETRY_MS: u64 = 5_000;
/// A stream counts as missing once it has been silent this long (also the grace after a
/// (re)connect before the first request).
pub const STREAM_STALE_MS: u64 = 3_000;
const CAMERA_INFORMATION: u32 = 259;
const GIMBAL_MANAGER_INFORMATION: u32 = 280;
/// (message id, interval µs) for the camera, then for the gimbal manager.
const CAMERA_STREAMS: [(u32, u32); 2] = [(260, 1_000_000), (262, 1_000_000)];
const GIMBAL_STREAMS: [(u32, u32); 1] = [(285, 100_000)];

/// What was requested when, and the connection edges seen so far.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Requests {
    pub info_ms: Option<u64>,
    pub stream_ms: BTreeMap<u32, u64>,
    pub connected: bool,
    /// When the driver last became connected (start of the stream grace).
    pub connected_ms: Option<u64>,
    /// The link was lost since the last connect: the next connect edge re-asks for info.
    pub lost: bool,
}

/// The requests due at `now_ms`, and the schedule after sending them.
pub fn due_requests(m: &Model, last: &Requests, sysid: SysId, now_ms: u64) -> (Requests, Vec<MavMessage>) {
    let connected = m.state.connected;
    let edge = connected && !last.connected;
    let reconnect = edge && last.lost;
    let edges = Requests {
        connected,
        connected_ms: if edge { Some(now_ms) } else { last.connected_ms },
        lost: (last.lost || (last.connected && !connected)) && !reconnect,
        ..last.clone()
    };
    let (after_info, info) = info_requests(m, &edges, sysid, now_ms, reconnect);
    let (next, streams) = stream_requests(m, &after_info, sysid, now_ms);
    (next, info.into_iter().chain(streams).collect())
}

fn info_requests(
    m: &Model,
    r: &Requests,
    sysid: SysId,
    now_ms: u64,
    reconnect: bool,
) -> (Requests, Vec<MavMessage>) {
    let wanted: Vec<u32> = if reconnect {
        vec![CAMERA_INFORMATION, GIMBAL_MANAGER_INFORMATION]
    } else {
        [
            (m.camera.is_none(), CAMERA_INFORMATION),
            (m.gimbal.is_none(), GIMBAL_MANAGER_INFORMATION),
        ]
        .iter()
        .filter_map(|&(missing, id)| missing.then_some(id))
        .collect()
    };
    let due = reconnect
        || r.info_ms
            .is_none_or(|t| now_ms.saturating_sub(t) >= INFO_RETRY_MS);
    if wanted.is_empty() || !due {
        return (r.clone(), Vec::new());
    }
    let msgs = wanted.iter().map(|&id| request_message(sysid, id)).collect();
    let next = Requests {
        info_ms: Some(now_ms),
        ..r.clone()
    };
    (next, msgs)
}

fn stream_requests(m: &Model, r: &Requests, sysid: SysId, now_ms: u64) -> (Requests, Vec<MavMessage>) {
    let camera = m.camera.as_ref().map(|c| c.compid);
    let manager = m.gimbal.as_ref().map(|g| g.manager_compid);
    let wanted = camera
        .into_iter()
        .flat_map(|c| CAMERA_STREAMS.iter().map(move |&(id, us)| (c, id, us)))
        .chain(
            manager
                .into_iter()
                .flat_map(|c| GIMBAL_STREAMS.iter().map(move |&(id, us)| (c, id, us))),
        );
    let due: Vec<(u8, u32, u32)> = wanted
        .filter(|&(_, id, _)| stale(m, r, id, now_ms) && retry_due(r, id, now_ms))
        .collect();
    let mut stream_ms = r.stream_ms.clone();
    stream_ms.extend(due.iter().map(|&(_, id, _)| (id, now_ms)));
    let msgs = due
        .iter()
        .map(|&(compid, id, us)| message_interval(sysid, compid, id, us))
        .collect();
    (
        Requests {
            stream_ms,
            ..r.clone()
        },
        msgs,
    )
}

fn stale(m: &Model, r: &Requests, id: u32, now_ms: u64) -> bool {
    let since = m.seen_ms.get(&id).copied().max(r.connected_ms);
    since.is_none_or(|t| now_ms.saturating_sub(t) > STREAM_STALE_MS)
}

fn retry_due(r: &Requests, id: u32, now_ms: u64) -> bool {
    r.stream_ms
        .get(&id)
        .is_none_or(|&t| now_ms.saturating_sub(t) >= STREAM_RETRY_MS)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mavlink_cam::apply::{apply, liveness, Model};
    use crate::mavlink_cam::binding::tests::{cam_info, header, manager_info};
    use mavlink::dialects::ardupilotmega::{MavCmd, MavMessage};
    use rgcs_mavlink::PayloadFrame;

    fn frame(message: MavMessage) -> PayloadFrame {
        PayloadFrame {
            header: header(1),
            message,
        }
    }

    /// Camera + gimbal bound and connected at `t`.
    fn bound(t: u64) -> Model {
        let m = apply(
            &Model::new(),
            &frame(MavMessage::CAMERA_INFORMATION(cam_info(1, 0xC3, 1))),
            100,
            t,
        );
        let m = apply(
            &m,
            &frame(MavMessage::GIMBAL_MANAGER_INFORMATION(manager_info(1, 32 | 256))),
            100,
            t,
        );
        liveness(&m, t)
    }

    fn fresh(m: &Model, now: u64) -> Model {
        let seen_ms = [260, 262, 285].iter().map(|&id| (id, now)).collect();
        liveness(
            &Model {
                seen_ms,
                last_rx_ms: Some(now),
                ..m.clone()
            },
            now,
        )
    }

    fn params(msgs: &[MavMessage]) -> Vec<(MavCmd, f32, u8)> {
        msgs.iter()
            .filter_map(|m| match m {
                MavMessage::COMMAND_LONG(d) => Some((d.command, d.param1, d.target_component)),
                _ => None,
            })
            .collect()
    }

    const REQ: MavCmd = MavCmd::MAV_CMD_REQUEST_MESSAGE;
    const INTERVAL: MavCmd = MavCmd::MAV_CMD_SET_MESSAGE_INTERVAL;

    #[test]
    fn info_every_2s_until_bound() {
        let m = Model::new();
        let (r, msgs) = due_requests(&m, &Requests::default(), 1, 0);
        assert_eq!(params(&msgs), vec![(REQ, 259.0, 0), (REQ, 280.0, 0)]);
        let (r, msgs) = due_requests(&m, &r, 1, 1_999);
        assert!(msgs.is_empty());
        let (_, msgs) = due_requests(&m, &r, 1, 2_000);
        assert_eq!(msgs.len(), 2);
        let (_, msgs) = due_requests(&bound(0), &r, 1, 4_000);
        assert!(params(&msgs).iter().all(|(c, ..)| *c != REQ));
    }

    #[test]
    fn info_asks_only_for_what_is_missing() {
        // As in the actor: liveness runs before the requests, so the stream grace applies.
        let m = liveness(
            &apply(
                &Model::new(),
                &frame(MavMessage::CAMERA_INFORMATION(cam_info(1, 0xC3, 1))),
                100,
                0,
            ),
            0,
        );
        let (_, msgs) = due_requests(&m, &Requests::default(), 1, 0);
        assert_eq!(params(&msgs), vec![(REQ, 280.0, 0)]);
    }

    #[test]
    fn streams_after_3s_stale_and_retry_every_5s() {
        let m = bound(0);
        let (r, msgs) = due_requests(&m, &Requests::default(), 1, 0);
        assert!(msgs.is_empty(), "grace after connecting");
        let m = liveness(
            &Model {
                last_rx_ms: Some(3_001),
                ..m
            },
            3_001,
        );
        let (r, msgs) = due_requests(&m, &r, 1, 3_001);
        assert_eq!(
            params(&msgs),
            vec![(INTERVAL, 260.0, 1), (INTERVAL, 262.0, 1), (INTERVAL, 285.0, 1)]
        );
        let p2: Vec<f32> = msgs
            .iter()
            .filter_map(|m| match m {
                MavMessage::COMMAND_LONG(d) => Some(d.param2),
                _ => None,
            })
            .collect();
        assert_eq!(p2, vec![1_000_000.0, 1_000_000.0, 100_000.0]);
        let m = liveness(
            &Model {
                last_rx_ms: Some(8_000),
                ..m
            },
            8_000,
        );
        let (r, msgs) = due_requests(&m, &r, 1, 8_000);
        assert!(msgs.is_empty());
        let (_, msgs) = due_requests(&m, &r, 1, 8_001);
        assert_eq!(msgs.len(), 3);
    }

    #[test]
    fn nothing_while_fresh() {
        let r = Requests::default();
        let (r, _) = due_requests(&bound(0), &r, 1, 0);
        let m = fresh(&bound(0), 20_000);
        let (_, msgs) = due_requests(&m, &r, 1, 20_000);
        assert!(msgs.is_empty());
    }

    /// ArduPilot answers REQUEST_MESSAGE once and streams nothing until asked: the info frames
    /// age out after 3 s, so the streams must still be requested while bound but silent, or
    /// the driver never connects (live SITL, 2026-10-23). An FC reboot also drops the rates.
    #[test]
    fn streams_requested_while_bound_but_silent() {
        let (r, _) = due_requests(&bound(0), &Requests::default(), 1, 0);
        let m = liveness(&bound(0), 3_250);
        assert!(!m.state.connected);
        let (r, msgs) = due_requests(&m, &r, 1, 3_250);
        assert_eq!(
            params(&msgs),
            vec![(INTERVAL, 260.0, 1), (INTERVAL, 262.0, 1), (INTERVAL, 285.0, 1)]
        );
        let (_, msgs) = due_requests(&m, &r, 1, 8_250);
        assert_eq!(msgs.len(), 3, "retried every 5 s while still silent");
    }

    #[test]
    fn no_streams_while_unbound() {
        let (r, _) = due_requests(&Model::new(), &Requests::default(), 1, 0);
        let (_, msgs) = due_requests(&Model::new(), &r, 1, 10_000);
        assert!(params(&msgs).iter().all(|(c, ..)| *c == REQ));
    }

    #[test]
    fn reconnect_edge_asks_info_once() {
        let (r, _) = due_requests(&bound(0), &Requests::default(), 1, 0);
        let lost = liveness(&bound(0), 10_000);
        let (r, _) = due_requests(&lost, &r, 1, 10_000);
        let back = fresh(&bound(0), 12_000);
        let (r, msgs) = due_requests(&back, &r, 1, 12_000);
        assert_eq!(params(&msgs), vec![(REQ, 259.0, 0), (REQ, 280.0, 0)]);
        let (_, msgs) = due_requests(&back, &r, 1, 12_250);
        assert!(msgs.is_empty());
    }
}
