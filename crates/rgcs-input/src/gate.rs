//! The gate: one per WebSocket session.

use rgcs_core::{Deadman, ServerMessage, SysId};

/// 25 Hz ceiling: frames closer than this to the previous accepted one are dropped.
pub const MIN_RATE_INTERVAL_MS: u64 = 40;
/// Heartbeat silence after which the gimbal is stopped.
pub const DEADMAN_MS: u64 = 1_500;
const RATE_LIMIT: i16 = 100;

#[derive(Debug, Clone, PartialEq)]
pub enum Action {
    Forward { sysid: SysId, yaw: i8, pitch: i8 },
    Zero { sysid: SysId },
    Reply(Box<ServerMessage>),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Gate {
    target: Option<SysId>,
    last_rate_ms: Option<u64>,
    last_hb_ms: Option<u64>,
    deadman: Deadman,
    /// A non-zero rate went to `target` since its last zero. Close / retarget zero only then:
    /// a no-op zero would cancel FC-side pointing (mission ROI) on ArduPilot.
    moving: bool,
}

impl Default for Gate {
    fn default() -> Self {
        Self {
            target: None,
            last_rate_ms: None,
            last_hb_ms: None,
            deadman: Deadman::Ok,
            moving: false,
        }
    }
}

impl Gate {
    /// Switches the target, zeroing the previous one if it moves; revives the deadman on any
    /// liveness.
    fn retarget(&self, sysid: SysId, now_ms: u64, actions: &mut Vec<Action>) -> Self {
        let switched = self.target.is_some_and(|p| p != sysid);
        if let Some(prev) = self.target.filter(|_| switched && self.moving) {
            actions.push(Action::Zero { sysid: prev });
        }
        if self.deadman == Deadman::Lost {
            actions.push(Action::Reply(Box::new(ServerMessage::InputState {
                deadman: Deadman::Ok,
            })));
        }
        Self {
            target: Some(sysid),
            last_hb_ms: Some(now_ms),
            deadman: Deadman::Ok,
            moving: self.moving && !switched,
            ..self.clone()
        }
    }

    pub fn on_gimbal_rate(&self, sysid: SysId, yaw: i16, pitch: i16, now_ms: u64) -> (Self, Vec<Action>) {
        if yaw.abs() > RATE_LIMIT || pitch.abs() > RATE_LIMIT {
            let reply = ServerMessage::Error {
                code: "validation".into(),
                message: "gimbal_rate values must be within -100..100".into(),
            };
            return (self.clone(), vec![Action::Reply(Box::new(reply))]);
        }
        // A stop (0,0) is a safety frame: it is never rate-limited away.
        let stop = yaw == 0 && pitch == 0;
        if !stop
            && self
                .last_rate_ms
                .is_some_and(|t| now_ms.saturating_sub(t) < MIN_RATE_INTERVAL_MS)
        {
            return (self.clone(), Vec::new());
        }
        let mut actions = Vec::new();
        let next = self.retarget(sysid, now_ms, &mut actions);
        actions.push(Action::Forward {
            sysid,
            yaw: yaw as i8,
            pitch: pitch as i8,
        });
        (
            Self {
                last_rate_ms: Some(now_ms),
                moving: !stop,
                ..next
            },
            actions,
        )
    }

    pub fn on_hb(&self, sysid: SysId, now_ms: u64) -> (Self, Vec<Action>) {
        let mut actions = Vec::new();
        let next = self.retarget(sysid, now_ms, &mut actions);
        (next, actions)
    }

    /// Switches the target without arming the deadman: a selection is not a sign of life
    /// (operators without a gamepad select vehicles all day).
    pub fn on_select(&self, sysid: SysId, now_ms: u64) -> (Self, Vec<Action>) {
        let mut actions = Vec::new();
        let armed = self.last_hb_ms;
        let next = self.retarget(sysid, now_ms, &mut actions);
        (
            Self {
                last_hb_ms: armed,
                ..next
            },
            actions,
        )
    }

    /// Called ~2× per second: a silent heartbeat stops the gimbal once and reports `lost`.
    pub fn tick(&self, now_ms: u64) -> (Self, Vec<Action>) {
        let silent = self
            .last_hb_ms
            .is_some_and(|t| now_ms.saturating_sub(t) >= DEADMAN_MS);
        match (self.deadman, self.target, silent) {
            (Deadman::Ok, Some(sysid), true) => (
                Self {
                    deadman: Deadman::Lost,
                    moving: false,
                    ..self.clone()
                },
                vec![
                    Action::Zero { sysid },
                    Action::Reply(Box::new(ServerMessage::InputState {
                        deadman: Deadman::Lost,
                    })),
                ],
            ),
            _ => (self.clone(), Vec::new()),
        }
    }

    /// The session ended: never leave a gimbal turning (and send nothing when it is not).
    pub fn close(&self) -> Vec<Action> {
        self.target
            .filter(|_| self.moving)
            .map(|sysid| Action::Zero { sysid })
            .into_iter()
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rgcs_core::{Deadman, ServerMessage};

    fn forward(actions: &[Action]) -> Vec<(u8, i8, i8)> {
        actions
            .iter()
            .filter_map(|a| match a {
                Action::Forward { sysid, yaw, pitch } => Some((*sysid, *yaw, *pitch)),
                _ => None,
            })
            .collect()
    }

    fn zeros(actions: &[Action]) -> Vec<u8> {
        actions
            .iter()
            .filter_map(|a| match a {
                Action::Zero { sysid } => Some(*sysid),
                _ => None,
            })
            .collect()
    }

    fn replies(actions: &[Action]) -> Vec<ServerMessage> {
        actions
            .iter()
            .filter_map(|a| match a {
                Action::Reply(m) => Some((**m).clone()),
                _ => None,
            })
            .collect()
    }

    #[test]
    fn out_of_range_is_rejected_with_validation_error() {
        let (g, actions) = Gate::default().on_gimbal_rate(1, 200, 0, 1_000);
        assert!(forward(&actions).is_empty());
        assert!(
            matches!(&replies(&actions)[..], [ServerMessage::Error { code, .. }] if code == "validation")
        );
        assert_eq!(g, Gate::default(), "a rejected frame changes nothing");
    }

    #[test]
    fn frames_faster_than_25hz_are_dropped() {
        let (g, a1) = Gate::default().on_gimbal_rate(1, 10, 0, 1_000);
        assert_eq!(forward(&a1), vec![(1, 10, 0)]);
        let (g, a2) = g.on_gimbal_rate(1, 20, 0, 1_030);
        assert!(forward(&a2).is_empty(), "30 ms later: dropped");
        let (_, a3) = g.on_gimbal_rate(1, 30, 0, 1_040);
        assert_eq!(forward(&a3), vec![(1, 30, 0)], "40 ms later: forwarded");
        assert_eq!(MIN_RATE_INTERVAL_MS, 40);
    }

    #[test]
    fn a_stop_frame_is_never_dropped_by_the_rate_limit() {
        let (g, _) = Gate::default().on_gimbal_rate(1, 40, 40, 1_000);
        let (g, a) = g.on_gimbal_rate(1, 0, 0, 1_010);
        assert_eq!(
            forward(&a),
            vec![(1, 0, 0)],
            "stopping must not wait for the interval"
        );
        let (_, a) = g.on_gimbal_rate(1, 0, 0, 1_020);
        assert_eq!(forward(&a), vec![(1, 0, 0)]);
    }

    #[test]
    fn hb_silence_sends_zero_once_and_reports_lost_then_ok_on_next_hb() {
        let (g, _) = Gate::default().on_hb(1, 0);
        let (g, a) = g.tick(1_499);
        assert!(a.is_empty());
        let (g, a) = g.tick(1_500);
        assert_eq!(zeros(&a), vec![1]);
        assert!(matches!(
            &replies(&a)[..],
            [ServerMessage::InputState {
                deadman: Deadman::Lost
            }]
        ));
        let (g, a) = g.tick(2_000);
        assert!(a.is_empty(), "lost is reported once");
        let (g, a) = g.on_hb(1, 2_100);
        assert!(matches!(
            &replies(&a)[..],
            [ServerMessage::InputState { deadman: Deadman::Ok }]
        ));
        let (_, a) = g.tick(2_200);
        assert!(a.is_empty());
        assert_eq!(DEADMAN_MS, 1_500);
    }

    #[test]
    fn a_rate_frame_counts_as_liveness() {
        let (g, _) = Gate::default().on_gimbal_rate(1, 5, 5, 0);
        let (g, a) = g.tick(1_400);
        assert!(a.is_empty());
        let (_, a) = g.tick(1_500);
        assert_eq!(zeros(&a), vec![1]);
    }

    #[test]
    fn select_sends_zero_to_the_previous_target() {
        let (g, _) = Gate::default().on_gimbal_rate(1, 5, 5, 0);
        let (g, a) = g.on_select(2, 100);
        assert_eq!(zeros(&a), vec![1]);
        let (g, a) = g.on_select(2, 200);
        assert!(a.is_empty(), "same target: nothing to zero");
        let (g, _) = g.on_gimbal_rate(2, 4, 4, 250);
        let (_, a) = g.on_gimbal_rate(3, 1, 1, 300);
        assert_eq!(
            zeros(&a),
            vec![2],
            "a rate for another vehicle also zeroes the old one"
        );
        assert_eq!(forward(&a), vec![(3, 1, 1)]);
    }

    #[test]
    fn retarget_without_a_forwarded_rate_sends_no_zero() {
        let (g, _) = Gate::default().on_select(1, 0);
        let (g, a) = g.on_select(2, 100);
        assert!(zeros(&a).is_empty(), "nothing was ever sent to 1: {a:?}");
        let (g, _) = g.on_gimbal_rate(2, 10, 0, 200);
        let (g, _) = g.on_gimbal_rate(2, 0, 0, 300);
        let (_, a) = g.on_hb(3, 400);
        assert!(zeros(&a).is_empty(), "2 was already stopped: {a:?}");
    }

    #[test]
    fn select_sets_the_target_without_arming_the_deadman() {
        let (g, _) = Gate::default().on_select(1, 0);
        let (g, a) = g.tick(5_000);
        assert!(a.is_empty(), "no heartbeat was ever received: nothing to lose");
        let (g, _) = g.on_hb(1, 5_000);
        let (_, a) = g.tick(6_500);
        assert_eq!(zeros(&a), vec![1]);
    }

    #[test]
    fn close_zeroes_the_current_target_only_while_it_moves() {
        let (g, _) = Gate::default().on_hb(4, 0);
        assert!(
            g.close().is_empty(),
            "a page load without a stick must not send a zero"
        );
        let (g, _) = g.on_gimbal_rate(4, 0, 30, 100);
        assert_eq!(zeros(&g.close()), vec![4]);
        let (g, _) = g.on_gimbal_rate(4, 0, 0, 200);
        assert!(g.close().is_empty(), "already stopped");
        assert!(Gate::default().close().is_empty());
    }

    #[test]
    fn the_deadman_zero_still_goes_out_and_ends_the_movement() {
        let (g, _) = Gate::default().on_hb(1, 0);
        let (g, a) = g.tick(1_500);
        assert_eq!(zeros(&a), vec![1], "the deadman is a safety zero");
        let (g, _) = g.on_gimbal_rate(1, 20, 0, 1_600);
        let (g, a) = g.tick(3_100);
        assert_eq!(zeros(&a), vec![1]);
        assert!(g.close().is_empty(), "the deadman already stopped it");
    }
}
