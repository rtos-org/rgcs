//! Per-system routing: one [`VehicleState`] (+ `watch` channel) per MAVLink system id.
//!
//! The router is a plain state machine driven by `on_message` / `tick`; the async link
//! task in [`crate::connection`] owns it behind a mutex.

use std::collections::HashMap;

use mavlink::dialects::ardupilotmega::MavMessage;
use mavlink::{MavHeader, Message};
use rgcs_core::{LinkStatus, SysId, VehicleMessage, VehicleState};
use tokio::sync::watch;

use crate::decode;
use crate::heartbeat::{is_flight_controller, link_status};
use crate::log_frame::LogFrame;
use crate::mission_frame::MissionFrame;
use crate::statustext::{is_full_chunk, Complete, Joiner};

/// Timestamps supplied by the caller: a monotonic clock for ages, wall time for messages.
#[derive(Debug, Clone, Copy, Default)]
pub struct Clock {
    pub mono_ms: u64,
    pub unix_ms: u64,
}

#[derive(Debug, Clone, PartialEq)]
pub enum RouterEvent {
    Discovered(SysId),
    Updated(SysId),
    Message(VehicleMessage),
    /// Heartbeat-derived link health crossed a threshold (3 s / 10 s) or came back.
    LinkChanged {
        sysid: SysId,
        from: LinkStatus,
        to: LinkStatus,
    },
    /// One PARAM_VALUE frame (answer to a read or part of a full list).
    ParamValue {
        sysid: SysId,
        name: String,
        value: f32,
        index: u16,
        count: u16,
        /// `MAV_PARAM_TYPE` as a number (1 u8 … 9 real32, 0 = unknown); echoed back in PARAM_SET.
        ptype: u8,
    },
    /// A Mission Protocol frame from the flight controller (upload / download / MISSION_CURRENT).
    Mission {
        sysid: SysId,
        frame: MissionFrame,
    },
    /// A DataFlash log transfer frame (LOG_ENTRY / LOG_DATA).
    Log {
        sysid: SysId,
        frame: LogFrame,
    },
    /// Calibration traffic (accelerometer position request, compass progress, RC input).
    Calib {
        sysid: SysId,
        frame: rgcs_core::CalibFrame,
    },
}

struct Slot {
    state: VehicleState,
    tx: watch::Sender<VehicleState>,
    /// Component id of the flight controller; only its frames count as link liveness
    /// (a companion computer or camera on the same sysid must not keep the link "OK").
    fc_component: u8,
    last_rx_ms: u64,
    last_seen: HashMap<u32, u64>,
    system_time: Option<SystemTimeSample>,
}

/// The FC's `SYSTEM_TIME` with a real UTC (`time_unix_usec > 0`) and the wall time it arrived.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SystemTimeSample {
    pub unix_us: u64,
    pub received_unix_ms: u64,
}

/// MAVLink message id of GLOBAL_POSITION_INT (the ROI controller's position source).
pub const GLOBAL_POSITION_INT_ID: u32 = 33;

#[derive(Default)]
pub struct Router {
    slots: HashMap<SysId, Slot>,
    next_message_id: u64,
    joiner: Joiner,
    /// Latest monotonic clock seen by `on_message` / `tick` (never moves backwards).
    now_ms: u64,
}

impl Router {
    /// Route one received frame. Only flight-controller heartbeats create a vehicle; frames
    /// from other components on the same sysid are ignored.
    pub fn on_message(&mut self, header: &MavHeader, msg: &MavMessage, clock: Clock) -> Vec<RouterEvent> {
        let sysid = header.system_id;
        self.now_ms = self.now_ms.max(clock.mono_ms);
        let mut events = Vec::new();
        if !self.slots.contains_key(&sysid) {
            match msg {
                MavMessage::HEARTBEAT(hb) if is_flight_controller(hb.autopilot) => {
                    self.insert(sysid, header.component_id);
                    events.push(RouterEvent::Discovered(sysid));
                }
                _ => return events,
            }
        }
        let slot = self.slots.get_mut(&sysid).expect("slot inserted above");
        if header.component_id != slot.fc_component {
            return events;
        }
        slot.last_rx_ms = clock.mono_ms;
        slot.last_seen.insert(msg.message_id(), clock.mono_ms);
        match msg {
            MavMessage::STATUSTEXT(st) => {
                let raw = String::from_utf8_lossy(&*st.text)
                    .trim_end_matches('\0')
                    .to_string();
                let full = is_full_chunk(&*st.text);
                let (joiner, done) = self.joiner.push(
                    sysid,
                    st.severity as u8,
                    &raw,
                    st.id,
                    st.chunk_seq,
                    full,
                    clock.mono_ms,
                );
                self.joiner = joiner;
                if let Some(c) = done {
                    events.push(self.message_event(c, clock.unix_ms));
                }
            }
            m if MissionFrame::from_message(m).is_some() => {
                if let Some(frame) = MissionFrame::from_message(m) {
                    events.push(RouterEvent::Mission { sysid, frame });
                }
            }
            m if crate::calib_frame(m).is_some() => {
                if let Some(frame) = crate::calib_frame(m) {
                    events.push(RouterEvent::Calib { sysid, frame });
                }
            }
            m if LogFrame::from_message(m).is_some() => {
                if let Some(frame) = LogFrame::from_message(m) {
                    events.push(RouterEvent::Log { sysid, frame });
                }
            }
            MavMessage::PARAM_VALUE(pv) => events.push(RouterEvent::ParamValue {
                sysid,
                name: String::from_utf8_lossy(&*pv.param_id)
                    .trim_end_matches('\0')
                    .to_string(),
                value: pv.param_value,
                index: pv.param_index,
                count: pv.param_count,
                ptype: num_traits::ToPrimitive::to_u8(&pv.param_type).unwrap_or(0),
            }),
            MavMessage::SYSTEM_TIME(t) if t.time_unix_usec > 0 => {
                slot.system_time = Some(SystemTimeSample {
                    unix_us: t.time_unix_usec,
                    received_unix_ms: clock.unix_ms,
                });
            }
            _ => {}
        }
        let slot = self.slots.get_mut(&sysid).expect("slot inserted above");
        if let Some(next) = decode::apply(&slot.state, msg) {
            // A frame from the FC proves the link is alive right now; `tick` ages it again.
            let from = slot.state.link;
            let next = VehicleState {
                last_rx_ms: 0,
                link: link_status(0),
                ..next
            };
            if from != next.link {
                events.push(RouterEvent::LinkChanged {
                    sysid,
                    from,
                    to: next.link,
                });
            }
            slot.state = next.clone();
            slot.tx.send_replace(next);
            events.push(RouterEvent::Updated(sysid));
        }
        events
    }

    fn message_event(&mut self, c: Complete, unix_ms: u64) -> RouterEvent {
        let id = self.next_message_id;
        self.next_message_id += 1;
        RouterEvent::Message(VehicleMessage::new(
            c.sysid,
            id,
            c.severity,
            c.text,
            unix_ms,
            rgcs_core::MessageSource::Vehicle,
        ))
    }

    /// Refresh link health / message ages. Call about once a second.
    pub fn tick(&mut self, clock: Clock) -> Vec<RouterEvent> {
        self.now_ms = self.now_ms.max(clock.mono_ms);
        let mut events = Vec::new();
        for (sysid, slot) in self.slots.iter_mut() {
            let age = clock.mono_ms.saturating_sub(slot.last_rx_ms);
            let link = link_status(age);
            if slot.state.link != link {
                events.push(RouterEvent::LinkChanged {
                    sysid: *sysid,
                    from: slot.state.link,
                    to: link,
                });
            }
            if slot.state.link != link || slot.state.last_rx_ms != age {
                let next = VehicleState {
                    link,
                    last_rx_ms: age,
                    ..slot.state.clone()
                };
                slot.state = next.clone();
                slot.tx.send_replace(next);
                events.push(RouterEvent::Updated(*sysid));
            }
        }
        let (joiner, stale) = self.joiner.flush(clock.mono_ms);
        self.joiner = joiner;
        for c in stale {
            events.push(self.message_event(c, clock.unix_ms));
        }
        events
    }

    pub fn states(&self) -> Vec<VehicleState> {
        let mut v: Vec<VehicleState> = self.slots.values().map(|s| s.state.clone()).collect();
        v.sort_by_key(|s| s.sysid);
        v
    }

    pub fn state(&self, sysid: SysId) -> Option<&VehicleState> {
        self.slots.get(&sysid).map(|s| &s.state)
    }

    /// Component id of the vehicle's flight controller (the target for mission frames).
    pub fn fc_component(&self, sysid: SysId) -> Option<u8> {
        self.slots.get(&sysid).map(|s| s.fc_component)
    }

    pub fn subscribe(&self, sysid: SysId) -> Option<watch::Receiver<VehicleState>> {
        self.slots.get(&sysid).map(|s| s.tx.subscribe())
    }

    /// Monotonic ms of the latest sample per message id (for the interval requester).
    pub fn last_seen(&self, sysid: SysId) -> HashMap<u32, u64> {
        self.slots
            .get(&sysid)
            .map(|s| s.last_seen.clone())
            .unwrap_or_default()
    }

    /// Ms since the flight controller last sent `msg_id`, against the router's latest clock
    /// (exact while frames flow, ≤ 1 s late when the link is silent). `None` until seen.
    pub fn message_age_ms(&self, sysid: SysId, msg_id: u32) -> Option<u64> {
        let seen = *self.slots.get(&sysid)?.last_seen.get(&msg_id)?;
        Some(self.now_ms.saturating_sub(seen))
    }

    /// Newest `SYSTEM_TIME` with a real UTC from the vehicle's flight controller.
    pub fn system_time(&self, sysid: SysId) -> Option<SystemTimeSample> {
        self.slots.get(&sysid)?.system_time
    }

    fn insert(&mut self, sysid: SysId, fc_component: u8) {
        let state = VehicleState::new(sysid, format!("UAV-{sysid:02}"));
        let (tx, _rx) = watch::channel(state.clone());
        let slot = Slot {
            state,
            tx,
            fc_component,
            last_rx_ms: 0,
            last_seen: HashMap::new(),
            system_time: None,
        };
        self.slots.insert(sysid, slot);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use mavlink::dialects::ardupilotmega::{
        MavAutopilot, MavSeverity, MavType, HEARTBEAT_DATA, STATUSTEXT_DATA,
    };
    use rgcs_core::LinkStatus;

    fn header(sysid: u8) -> MavHeader {
        MavHeader {
            system_id: sysid,
            component_id: 1,
            sequence: 0,
        }
    }

    fn fc_heartbeat() -> MavMessage {
        MavMessage::HEARTBEAT(HEARTBEAT_DATA {
            mavtype: MavType::MAV_TYPE_QUADROTOR,
            autopilot: MavAutopilot::MAV_AUTOPILOT_ARDUPILOTMEGA,
            ..HEARTBEAT_DATA::DEFAULT
        })
    }

    fn clock(mono_ms: u64) -> Clock {
        Clock {
            mono_ms,
            unix_ms: 1_700_000_000_000 + mono_ms,
        }
    }

    #[test]
    fn fc_heartbeat_discovers_a_vehicle() {
        let mut r = Router::default();
        let ev = r.on_message(&header(1), &fc_heartbeat(), clock(0));
        assert_eq!(ev, vec![RouterEvent::Discovered(1), RouterEvent::Updated(1)]);
        assert_eq!(r.states()[0].name, "UAV-01");
        assert_eq!(r.states()[0].kind, rgcs_core::VehicleKind::Copter);
    }

    #[test]
    fn gcs_heartbeat_and_unknown_systems_are_ignored() {
        let mut r = Router::default();
        let gcs = MavMessage::HEARTBEAT(HEARTBEAT_DATA {
            autopilot: MavAutopilot::MAV_AUTOPILOT_INVALID,
            ..HEARTBEAT_DATA::DEFAULT
        });
        assert!(r.on_message(&header(255), &gcs, clock(0)).is_empty());
        assert!(r
            .on_message(&header(7), &MavMessage::VFR_HUD(Default::default()), clock(0))
            .is_empty());
        assert!(r.states().is_empty());
    }

    #[test]
    fn param_value_event_carries_the_type() {
        use mavlink::dialects::ardupilotmega::{MavParamType, PARAM_VALUE_DATA};
        let mut r = Router::default();
        r.on_message(&header(1), &fc_heartbeat(), clock(0));
        let pv = MavMessage::PARAM_VALUE(PARAM_VALUE_DATA {
            param_value: 1.0,
            param_count: 1200,
            param_index: 7,
            param_id: "FENCE_ENABLE".into(),
            param_type: MavParamType::MAV_PARAM_TYPE_INT8,
        });
        let ev = r.on_message(&header(1), &pv, clock(10));
        assert!(
            matches!(&ev[0], RouterEvent::ParamValue { name, index: 7, count: 1200, ptype: 2, .. } if name == "FENCE_ENABLE"),
            "{ev:?}"
        );
    }

    #[test]
    fn mission_frames_become_mission_events() {
        use mavlink::dialects::ardupilotmega::{
            MavMissionResult, MavMissionType, MISSION_ACK_DATA, MISSION_CURRENT_DATA,
        };
        let mut r = Router::default();
        r.on_message(&header(1), &fc_heartbeat(), clock(0));
        let current = MavMessage::MISSION_CURRENT(MISSION_CURRENT_DATA {
            seq: 3,
            ..MISSION_CURRENT_DATA::DEFAULT
        });
        let ack = MavMessage::MISSION_ACK(MISSION_ACK_DATA {
            target_system: 255,
            target_component: 190,
            mavtype: MavMissionResult::MAV_MISSION_ACCEPTED,
            mission_type: MavMissionType::MAV_MISSION_TYPE_MISSION,
            opaque_id: 0,
        });
        let a = r.on_message(&header(1), &current, clock(10));
        assert!(
            matches!(&a[0], RouterEvent::Mission { sysid: 1, frame: MissionFrame::Current(c) } if c.seq == 3),
            "{a:?}"
        );
        let b = r.on_message(&header(1), &ack, clock(20));
        assert!(
            matches!(
                &b[0],
                RouterEvent::Mission {
                    sysid: 1,
                    frame: MissionFrame::Ack(_)
                }
            ),
            "{b:?}"
        );
        // another component on the same sysid (a camera) is not the flight controller
        let other = MavHeader {
            system_id: 1,
            component_id: 100,
            sequence: 0,
        };
        assert!(r.on_message(&other, &current, clock(30)).is_empty());
        assert_eq!(r.fc_component(1), Some(1));
        assert_eq!(r.fc_component(9), None);
    }

    #[test]
    fn statustext_becomes_a_vehicle_message() {
        let mut r = Router::default();
        r.on_message(&header(1), &fc_heartbeat(), clock(0));
        let st = MavMessage::STATUSTEXT(STATUSTEXT_DATA {
            severity: MavSeverity::MAV_SEVERITY_WARNING,
            text: "PreArm: Compass not calibrated".into(),
            ..STATUSTEXT_DATA::DEFAULT
        });
        let ev = r.on_message(&header(1), &st, clock(100));
        match &ev[0] {
            RouterEvent::Message(m) => {
                assert_eq!(m.severity, 4);
                assert_eq!(m.text, "PreArm: Compass not calibrated");
                assert_eq!(m.ts, 1_700_000_000_100);
            }
            other => panic!("unexpected {other:?}"),
        }
    }

    #[test]
    fn link_changes_are_reported_as_events() {
        let mut r = Router::default();
        r.on_message(&header(1), &fc_heartbeat(), clock(0));
        let ev = r.tick(clock(3_500));
        assert!(ev.contains(&RouterEvent::LinkChanged {
            sysid: 1,
            from: LinkStatus::Ok,
            to: LinkStatus::Delay
        }));
        let ev = r.tick(clock(12_000));
        assert!(ev.contains(&RouterEvent::LinkChanged {
            sysid: 1,
            from: LinkStatus::Delay,
            to: LinkStatus::Lost
        }));
        assert!(!r
            .tick(clock(13_000))
            .iter()
            .any(|e| matches!(e, RouterEvent::LinkChanged { .. })));
        let ev = r.on_message(&header(1), &fc_heartbeat(), clock(13_100));
        assert!(ev.contains(&RouterEvent::LinkChanged {
            sysid: 1,
            from: LinkStatus::Lost,
            to: LinkStatus::Ok
        }));
    }

    #[test]
    fn chunked_statustext_is_joined_by_id_and_stale_chunks_flush_on_tick() {
        let mut r = Router::default();
        r.on_message(&header(1), &fc_heartbeat(), clock(0));
        let head = "D".repeat(50);
        let st = |t: &str, id: u16, seq: u8| {
            MavMessage::STATUSTEXT(STATUSTEXT_DATA {
                severity: MavSeverity::MAV_SEVERITY_INFO,
                text: t.into(),
                id,
                chunk_seq: seq,
            })
        };
        // A full 50-byte message with id 0 is complete on its own (no 1 s delay).
        let ev = r.on_message(&header(1), &st(&head, 0, 0), clock(50));
        assert!(ev
            .iter()
            .any(|e| matches!(e, RouterEvent::Message(m) if m.text == head)));
        let ev = r.on_message(&header(1), &st(&head, 7, 0), clock(100));
        assert!(!ev.iter().any(|e| matches!(e, RouterEvent::Message(_))));
        let ev = r.on_message(&header(1), &st(" tail", 7, 1), clock(150));
        let joined = ev.iter().find_map(|e| match e {
            RouterEvent::Message(m) => Some(m.text.clone()),
            _ => None,
        });
        assert_eq!(joined.as_deref(), Some(format!("{head} tail").as_str()));
        r.on_message(&header(1), &st(&head, 8, 0), clock(200));
        let ev = r.tick(clock(1_300));
        assert!(ev
            .iter()
            .any(|e| matches!(e, RouterEvent::Message(m) if m.text == head)));
    }

    #[test]
    fn param_value_becomes_an_event() {
        use mavlink::dialects::ardupilotmega::{MavParamType, PARAM_VALUE_DATA};
        let mut r = Router::default();
        r.on_message(&header(1), &fc_heartbeat(), clock(0));
        let pv = MavMessage::PARAM_VALUE(PARAM_VALUE_DATA {
            param_value: 120.0,
            param_count: 900,
            param_index: 7,
            param_id: "FENCE_ALT_MAX".into(),
            param_type: MavParamType::MAV_PARAM_TYPE_REAL32,
        });
        let ev = r.on_message(&header(1), &pv, clock(10));
        assert!(ev.contains(&RouterEvent::ParamValue {
            sysid: 1,
            name: "FENCE_ALT_MAX".into(),
            value: 120.0,
            index: 7,
            count: 900,
            ptype: 9
        }));
    }

    #[test]
    fn tick_degrades_the_link_with_age() {
        let mut r = Router::default();
        r.on_message(&header(1), &fc_heartbeat(), clock(0));
        assert!(r.tick(clock(1_000)).len() == 1);
        assert_eq!(r.state(1).unwrap().link, LinkStatus::Ok);
        r.tick(clock(3_500));
        assert_eq!(r.state(1).unwrap().link, LinkStatus::Delay);
        r.tick(clock(12_000));
        assert_eq!(r.state(1).unwrap().link, LinkStatus::Lost);
        assert_eq!(r.state(1).unwrap().last_rx_ms, 12_000);
        r.on_message(&header(1), &fc_heartbeat(), clock(12_100));
        assert_eq!(r.state(1).unwrap().link, LinkStatus::Ok);
    }

    #[test]
    fn companion_components_do_not_keep_the_link_alive() {
        let mut r = Router::default();
        r.on_message(&header(1), &fc_heartbeat(), clock(0));
        let companion = MavHeader {
            system_id: 1,
            component_id: 191,
            sequence: 0,
        };
        r.tick(clock(12_000));
        assert_eq!(r.state(1).unwrap().link, LinkStatus::Lost);
        let evs = r.on_message(
            &companion,
            &MavMessage::VFR_HUD(Default::default()),
            clock(12_100),
        );
        assert!(evs.is_empty());
        assert_eq!(r.state(1).unwrap().link, LinkStatus::Lost);
    }

    #[test]
    fn watch_subscribers_see_updates_and_last_seen_tracks_ids() {
        let mut r = Router::default();
        r.on_message(&header(1), &fc_heartbeat(), clock(0));
        let rx = r.subscribe(1).unwrap();
        r.on_message(&header(1), &MavMessage::VFR_HUD(Default::default()), clock(50));
        assert_eq!(rx.borrow().sysid, 1);
        assert_eq!(r.last_seen(1).get(&74), Some(&50));
        assert_eq!(r.last_seen(1).get(&0), Some(&0));
    }

    #[test]
    fn a_late_subscriber_sees_the_current_state() {
        // Updates made while nobody watches must still land in the channel (the AI guard
        // subscribes on a vehicle's first guard frame, long after discovery).
        let mut r = Router::default();
        r.on_message(&header(1), &fc_heartbeat(), clock(0));
        r.tick(clock(11_000));
        let rx = r.subscribe(1).unwrap();
        assert_eq!(rx.borrow().link, LinkStatus::Lost);
        assert_eq!(*rx.borrow(), *r.state(1).unwrap());
    }

    #[test]
    fn log_frames_become_log_events() {
        use mavlink::dialects::ardupilotmega::{HEARTBEAT_DATA, LOG_ENTRY_DATA};
        let mut r = Router::default();
        let header = MavHeader {
            system_id: 1,
            component_id: 1,
            sequence: 0,
        };
        let entry = LOG_ENTRY_DATA {
            id: 3,
            num_logs: 1,
            last_log_num: 3,
            time_utc: 0,
            size: 100,
        };
        r.on_message(
            &header,
            &MavMessage::HEARTBEAT(HEARTBEAT_DATA::DEFAULT),
            Clock::default(),
        );
        let events = r.on_message(&header, &MavMessage::LOG_ENTRY(entry.clone()), Clock::default());
        assert!(events.iter().any(
            |e| matches!(e, RouterEvent::Log { sysid: 1, frame: crate::LogFrame::Entry(d) } if d.id == 3)
        ));
    }

    #[test]
    fn calibration_frames_become_calib_events() {
        use mavlink::dialects::ardupilotmega::{HEARTBEAT_DATA, MAG_CAL_PROGRESS_DATA};
        let mut r = Router::default();
        let header = MavHeader {
            system_id: 1,
            component_id: 1,
            sequence: 0,
        };
        r.on_message(
            &header,
            &MavMessage::HEARTBEAT(HEARTBEAT_DATA::DEFAULT),
            Clock::default(),
        );
        let progress = MavMessage::MAG_CAL_PROGRESS(MAG_CAL_PROGRESS_DATA {
            completion_pct: 12,
            ..MAG_CAL_PROGRESS_DATA::DEFAULT
        });
        let events = r.on_message(&header, &progress, Clock::default());
        assert!(events.contains(&RouterEvent::Calib {
            sysid: 1,
            frame: rgcs_core::CalibFrame::MagProgress { id: 0, pct: 12 },
        }));
    }

    fn position() -> MavMessage {
        use mavlink::dialects::ardupilotmega::GLOBAL_POSITION_INT_DATA;
        MavMessage::GLOBAL_POSITION_INT(GLOBAL_POSITION_INT_DATA {
            lat: 356_000_000,
            lon: 1_397_000_000,
            ..GLOBAL_POSITION_INT_DATA::DEFAULT
        })
    }

    fn system_time(usec: u64) -> MavMessage {
        use mavlink::dialects::ardupilotmega::SYSTEM_TIME_DATA;
        MavMessage::SYSTEM_TIME(SYSTEM_TIME_DATA {
            time_unix_usec: usec,
            ..SYSTEM_TIME_DATA::DEFAULT
        })
    }

    #[test]
    fn system_time_sample() {
        let mut r = Router::default();
        r.on_message(&header(1), &fc_heartbeat(), clock(0));
        assert_eq!(r.system_time(1), None);
        r.on_message(
            &header(1),
            &system_time(0),
            Clock {
                mono_ms: 1,
                unix_ms: 4_000,
            },
        );
        assert_eq!(r.system_time(1), None);
        r.on_message(
            &header(1),
            &system_time(1_790_000_000_000_000),
            Clock {
                mono_ms: 2,
                unix_ms: 5_000,
            },
        );
        assert_eq!(
            r.system_time(1),
            Some(SystemTimeSample {
                unix_us: 1_790_000_000_000_000,
                received_unix_ms: 5_000
            })
        );
        let other = MavHeader {
            system_id: 1,
            component_id: 154,
            sequence: 0,
        };
        r.on_message(
            &other,
            &system_time(1_791_000_000_000_000),
            Clock {
                mono_ms: 3,
                unix_ms: 6_000,
            },
        );
        assert_eq!(r.system_time(1).unwrap().received_unix_ms, 5_000);
        assert_eq!(r.system_time(9), None);
    }

    #[test]
    fn message_age_tracks_position_separately() {
        let mut r = Router::default();
        r.on_message(&header(1), &fc_heartbeat(), clock(0));
        assert_eq!(r.message_age_ms(1, GLOBAL_POSITION_INT_ID), None);
        r.on_message(&header(1), &position(), clock(1_000));
        r.on_message(&header(1), &fc_heartbeat(), clock(4_000));
        assert_eq!(r.message_age_ms(1, GLOBAL_POSITION_INT_ID), Some(3_000));
        r.tick(clock(6_000));
        assert_eq!(r.message_age_ms(1, GLOBAL_POSITION_INT_ID), Some(5_000));
        // A late frame with an older clock never moves the latest clock backwards.
        r.tick(clock(5_500));
        assert_eq!(r.message_age_ms(1, GLOBAL_POSITION_INT_ID), Some(5_000));
        assert_eq!(r.message_age_ms(9, GLOBAL_POSITION_INT_ID), None);
    }
}
