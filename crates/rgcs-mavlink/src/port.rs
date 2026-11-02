//! `MavPort`: a payload driver's handle on the FC link (MAVLink camera / gimbal). It taps
//! camera and gimbal frames from any component, sends raw messages and runs single-shot
//! commands that wait for their COMMAND_ACK without ever retrying (a lost ACK must not
//! take a second photo).

use mavlink::dialects::ardupilotmega::{MavCmd, MavMessage};
use mavlink::{MavHeader, Message};
use rgcs_core::SysId;
use tokio::sync::{broadcast, mpsc};

use crate::queue::{classify, wait_ack, Ack, Outcome, Outgoing, ACK_TIMEOUT};

/// HEARTBEAT (link liveness for the driver's requests), CAMERA_INFORMATION, CAMERA_SETTINGS,
/// CAMERA_CAPTURE_STATUS, GIMBAL_MANAGER_INFORMATION, GIMBAL_MANAGER_STATUS,
/// GIMBAL_DEVICE_ATTITUDE_STATUS.
pub const PAYLOAD_IDS: [u32; 7] = [0, 259, 260, 262, 280, 281, 285];
pub const PAYLOAD_CAPACITY: usize = 256;

/// One camera / gimbal frame, with the header of the component that sent it.
#[derive(Debug, Clone)]
pub struct PayloadFrame {
    pub header: MavHeader,
    pub message: MavMessage,
}

/// `Some` only for [`PAYLOAD_IDS`], from any system / component.
pub fn tap(header: &MavHeader, msg: &MavMessage) -> Option<PayloadFrame> {
    PAYLOAD_IDS.contains(&msg.message_id()).then(|| PayloadFrame {
        header: *header,
        message: msg.clone(),
    })
}

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum PortError {
    #[error("link closed")]
    Closed,
    #[error("link queue full")]
    Full,
}

/// Handle on the FC link for a payload driver.
#[derive(Clone)]
pub struct MavPort {
    outgoing: mpsc::Sender<Outgoing>,
    acks: broadcast::Sender<Ack>,
    payload: broadcast::Sender<PayloadFrame>,
}

impl MavPort {
    pub fn new(
        outgoing: mpsc::Sender<Outgoing>,
        acks: broadcast::Sender<Ack>,
        payload: broadcast::Sender<PayloadFrame>,
    ) -> Self {
        Self {
            outgoing,
            acks,
            payload,
        }
    }

    /// No link: `send` → `Err(Closed)`, `command` → `Outcome::LinkClosed`.
    pub fn detached() -> Self {
        let (outgoing, _) = mpsc::channel(1);
        let (acks, _) = broadcast::channel(1);
        let (payload, _) = broadcast::channel(1);
        Self::new(outgoing, acks, payload)
    }

    pub fn subscribe(&self) -> broadcast::Receiver<PayloadFrame> {
        self.payload.subscribe()
    }

    /// Queues one message on the link (no ACK expected).
    pub async fn send(&self, message: MavMessage) -> Result<(), PortError> {
        self.outgoing
            .send(Outgoing { message })
            .await
            .map_err(|_| PortError::Closed)
    }

    /// Queues one message only if there is room right now (fire-and-forget requests that the
    /// next tick repeats anyway; they must never wait on, or fill, a stalled link).
    pub fn try_send(&self, message: MavMessage) -> Result<(), PortError> {
        self.outgoing.try_send(Outgoing { message }).map_err(|e| match e {
            mpsc::error::TrySendError::Full(_) => PortError::Full,
            mpsc::error::TrySendError::Closed(_) => PortError::Closed,
        })
    }

    /// One send, no retry; waits `ACK_TIMEOUT` (IN_PROGRESS extends to `IN_PROGRESS_TIMEOUT`).
    pub async fn command(&self, sysid: SysId, message: MavMessage, ack_for: MavCmd) -> Outcome {
        let mut rx = self.acks.subscribe();
        if self.send(message).await.is_err() {
            return Outcome::LinkClosed;
        }
        match wait_ack(&mut rx, sysid, ack_for, ACK_TIMEOUT).await {
            Some(result) => classify(result),
            None => Outcome::Timeout,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::queue::{Ack, Outcome, Outgoing, ACK_TIMEOUT};
    use mavlink::dialects::ardupilotmega::{
        MavCmd, MavMessage, MavResult, CAMERA_INFORMATION_DATA, COMMAND_ACK_DATA, COMMAND_LONG_DATA,
        GIMBAL_DEVICE_ATTITUDE_STATUS_DATA, HEARTBEAT_DATA,
    };
    use mavlink::MavHeader;
    use tokio::sync::{broadcast, mpsc};

    fn header(component_id: u8) -> MavHeader {
        MavHeader {
            system_id: 1,
            component_id,
            sequence: 0,
        }
    }

    fn photo() -> MavMessage {
        MavMessage::COMMAND_LONG(COMMAND_LONG_DATA {
            command: MavCmd::MAV_CMD_IMAGE_START_CAPTURE,
            target_system: 1,
            ..COMMAND_LONG_DATA::DEFAULT
        })
    }

    fn ack(sysid: u8, result: MavResult) -> Ack {
        Ack {
            sysid,
            command: MavCmd::MAV_CMD_IMAGE_START_CAPTURE,
            result,
        }
    }

    fn port() -> (MavPort, mpsc::Receiver<Outgoing>, broadcast::Sender<Ack>) {
        let (out_tx, out_rx) = mpsc::channel(8);
        let (ack_tx, _) = broadcast::channel(8);
        let (payload_tx, _) = broadcast::channel(PAYLOAD_CAPACITY);
        (MavPort::new(out_tx, ack_tx.clone(), payload_tx), out_rx, ack_tx)
    }

    #[test]
    fn tap_keeps_only_payload_ids() {
        let info = MavMessage::CAMERA_INFORMATION(CAMERA_INFORMATION_DATA::DEFAULT);
        let frame = tap(&header(100), &info).expect("camera information is tapped");
        assert_eq!(frame.header.component_id, 100);
        let attitude = MavMessage::GIMBAL_DEVICE_ATTITUDE_STATUS(GIMBAL_DEVICE_ATTITUDE_STATUS_DATA::DEFAULT);
        assert!(tap(&header(1), &attitude).is_some());
        let ack = MavMessage::COMMAND_ACK(COMMAND_ACK_DATA::DEFAULT);
        assert!(tap(&header(1), &ack).is_none());
    }

    #[tokio::test(start_paused = true)]
    async fn tapped_frames_reach_subscribers() {
        let (p, _out, _acks) = port();
        let mut rx = p.subscribe();
        let info = MavMessage::CAMERA_INFORMATION(CAMERA_INFORMATION_DATA::DEFAULT);
        p.payload.send(tap(&header(100), &info).unwrap()).unwrap();
        assert_eq!(rx.recv().await.unwrap().header.component_id, 100);
    }

    #[tokio::test(start_paused = true)]
    async fn command_returns_on_its_ack() {
        let (p, mut out, acks) = port();
        let task =
            tokio::spawn(async move { p.command(1, photo(), MavCmd::MAV_CMD_IMAGE_START_CAPTURE).await });
        let sent = out.recv().await.unwrap();
        assert!(matches!(sent.message, MavMessage::COMMAND_LONG(ref d)
            if d.command == MavCmd::MAV_CMD_IMAGE_START_CAPTURE));
        acks.send(ack(1, MavResult::MAV_RESULT_ACCEPTED)).unwrap();
        assert_eq!(task.await.unwrap(), Outcome::Accepted);
    }

    #[tokio::test(start_paused = true)]
    async fn command_never_retries() {
        let (p, mut out, _acks) = port();
        let started = tokio::time::Instant::now();
        let outcome = p.command(1, photo(), MavCmd::MAV_CMD_IMAGE_START_CAPTURE).await;
        assert_eq!(outcome, Outcome::Timeout);
        assert_eq!(started.elapsed(), ACK_TIMEOUT);
        drop(p);
        let mut sends = 0;
        while out.recv().await.is_some() {
            sends += 1;
        }
        assert_eq!(sends, 1);
    }

    #[tokio::test(start_paused = true)]
    async fn command_ignores_other_sysid_and_reports_refusal() {
        let (p, mut out, acks) = port();
        let task =
            tokio::spawn(async move { p.command(1, photo(), MavCmd::MAV_CMD_IMAGE_START_CAPTURE).await });
        out.recv().await.unwrap();
        acks.send(ack(2, MavResult::MAV_RESULT_ACCEPTED)).unwrap();
        acks.send(ack(1, MavResult::MAV_RESULT_DENIED)).unwrap();
        assert_eq!(task.await.unwrap(), Outcome::Refused("denied".into()));
    }

    /// Fire-and-forget requests never wait for room on the link.
    #[tokio::test(start_paused = true)]
    async fn try_send_drops_when_the_link_queue_is_full() {
        let (out_tx, mut out_rx) = mpsc::channel(1);
        let (acks, _) = broadcast::channel(1);
        let (payload, _) = broadcast::channel(1);
        let p = MavPort::new(out_tx, acks, payload);
        assert_eq!(p.try_send(photo()), Ok(()));
        assert_eq!(p.try_send(photo()), Err(PortError::Full));
        out_rx.recv().await.unwrap();
        assert_eq!(p.try_send(photo()), Ok(()));
        drop(out_rx);
        assert_eq!(p.try_send(photo()), Err(PortError::Closed));
    }

    #[test]
    fn tap_keeps_heartbeats_for_link_liveness() {
        let hb = MavMessage::HEARTBEAT(HEARTBEAT_DATA::DEFAULT);
        assert!(tap(&header(1), &hb).is_some());
    }

    #[tokio::test(start_paused = true)]
    async fn detached_port_reports_closed() {
        let p = MavPort::detached();
        let hb = MavMessage::HEARTBEAT(HEARTBEAT_DATA::DEFAULT);
        assert_eq!(p.send(hb).await, Err(PortError::Closed));
        assert_eq!(
            p.command(1, photo(), MavCmd::MAV_CMD_IMAGE_START_CAPTURE).await,
            Outcome::LinkClosed
        );
    }
}
