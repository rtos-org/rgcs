//! Command queue: every outgoing vehicle command is serialised here,
//! sent through the link, and completed by the matching COMMAND_ACK. ACK-less commands are
//! retried 3 times with a 1.5 s timeout.

use std::time::Duration;

use mavlink::dialects::ardupilotmega::{MavCmd, MavMessage, MavResult};
use rgcs_core::{SysId, VehicleCommand, VehicleKind};
use tokio::sync::{broadcast, mpsc, oneshot};
use tracing::{debug, warn};

use crate::command::{encode_steps, EncodeError, Encoded, Frame};

pub const ACK_TIMEOUT: Duration = Duration::from_millis(1500);
pub const ATTEMPTS: u32 = 3;
/// How long an `IN_PROGRESS` command may run before we give up.
pub const IN_PROGRESS_TIMEOUT: Duration = Duration::from_secs(10);

/// A COMMAND_ACK seen on the link.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Ack {
    pub sysid: SysId,
    pub command: MavCmd,
    pub result: MavResult,
}

/// Message to transmit on the link (the link task adds the GCS header).
#[derive(Debug, Clone)]
pub struct Outgoing {
    pub message: MavMessage,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Outcome {
    Accepted,
    /// The vehicle answered with a non-accepted MAV_RESULT.
    Refused(String),
    Timeout,
    Encode(String),
    LinkClosed,
}

impl Outcome {
    pub fn ok(&self) -> bool {
        matches!(self, Outcome::Accepted)
    }

    pub fn reason(&self) -> Option<String> {
        match self {
            Outcome::Accepted => None,
            Outcome::Refused(r) | Outcome::Encode(r) => Some(r.clone()),
            Outcome::Timeout => Some("timeout".into()),
            Outcome::LinkClosed => Some("link_closed".into()),
        }
    }
}

pub struct QueuedCommand {
    pub sysid: SysId,
    pub kind: VehicleKind,
    /// A plane that hovers (QuadPlane); with `mode` it picks how a takeoff is sent.
    pub vtol: bool,
    /// The vehicle's flight mode when the command was queued.
    pub mode: String,
    pub cmd: VehicleCommand,
    pub done: oneshot::Sender<Outcome>,
}

/// Runs until the queue sender is dropped.
pub async fn run_queue(
    mut queue: mpsc::Receiver<QueuedCommand>,
    link: mpsc::Sender<Outgoing>,
    acks: broadcast::Sender<Ack>,
) {
    while let Some(job) = queue.recv().await {
        let outcome = execute(&job, &link, &acks).await;
        let _ = job.done.send(outcome);
    }
}

async fn execute(
    job: &QueuedCommand,
    link: &mpsc::Sender<Outgoing>,
    acks: &broadcast::Sender<Ack>,
) -> Outcome {
    let frame = Frame {
        kind: job.kind,
        vtol: job.vtol,
        mode: &job.mode,
    };
    let steps = match encode_steps(&job.cmd, &frame, job.sysid) {
        Ok(e) => e,
        Err(EncodeError::UnknownMode(m)) => return Outcome::Encode(format!("unknown mode {m}")),
        Err(e) => return Outcome::Encode(e.to_string()),
    };
    // Each step must be accepted before the next one goes out (e.g. GUIDED, then NAV_TAKEOFF).
    for step in &steps {
        let outcome = send_step(job, step, link, acks).await;
        if !outcome.ok() {
            return outcome;
        }
    }
    Outcome::Accepted
}

/// Sends one message, retrying until its ACK arrives or the attempts run out.
async fn send_step(
    job: &QueuedCommand,
    step: &Encoded,
    link: &mpsc::Sender<Outgoing>,
    acks: &broadcast::Sender<Ack>,
) -> Outcome {
    for attempt in 1..=ATTEMPTS {
        let mut rx = acks.subscribe();
        if link
            .send(Outgoing {
                message: step.message.clone(),
            })
            .await
            .is_err()
        {
            return Outcome::LinkClosed;
        }
        match wait_ack(&mut rx, job.sysid, step.ack_for, ACK_TIMEOUT).await {
            Some(result) => return classify(result),
            None => debug!(
                attempt,
                sysid = job.sysid,
                cmd = job.cmd.name(),
                "no COMMAND_ACK, retrying"
            ),
        }
    }
    warn!(sysid = job.sysid, cmd = job.cmd.name(), "command timed out");
    Outcome::Timeout
}

/// Waits `timeout` for the matching ACK; `IN_PROGRESS` extends the wait up to
/// `IN_PROGRESS_TIMEOUT`.
pub(crate) async fn wait_ack(
    rx: &mut broadcast::Receiver<Ack>,
    sysid: SysId,
    command: MavCmd,
    timeout: Duration,
) -> Option<MavResult> {
    let deadline = tokio::time::Instant::now() + timeout;
    let hard = tokio::time::Instant::now() + IN_PROGRESS_TIMEOUT;
    let mut until = deadline;
    loop {
        match tokio::time::timeout_at(until, rx.recv()).await {
            Ok(Ok(ack)) if ack.sysid == sysid && ack.command == command => {
                if ack.result == MavResult::MAV_RESULT_IN_PROGRESS {
                    until = hard;
                    continue;
                }
                return Some(ack.result);
            }
            Ok(Ok(_)) => continue,
            Ok(Err(broadcast::error::RecvError::Lagged(_))) => continue,
            Ok(Err(broadcast::error::RecvError::Closed)) | Err(_) => return None,
        }
    }
}

pub(crate) fn classify(result: MavResult) -> Outcome {
    match result {
        MavResult::MAV_RESULT_ACCEPTED => Outcome::Accepted,
        other => Outcome::Refused(
            format!("{other:?}")
                .trim_start_matches("MAV_RESULT_")
                .to_lowercase(),
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn job(cmd: VehicleCommand) -> (QueuedCommand, oneshot::Receiver<Outcome>) {
        let (tx, rx) = oneshot::channel();
        (
            QueuedCommand {
                sysid: 1,
                kind: VehicleKind::Copter,
                vtol: false,
                mode: "STABILIZE".into(),
                cmd,
                done: tx,
            },
            rx,
        )
    }

    fn sent_command(o: &Outgoing) -> MavCmd {
        match &o.message {
            MavMessage::COMMAND_LONG(d) => d.command,
            other => panic!("{other:?}"),
        }
    }

    #[tokio::test(start_paused = true)]
    async fn accepted_ack_completes_the_command() {
        let (link_tx, mut link_rx) = mpsc::channel(8);
        let (ack_tx, _) = broadcast::channel(8);
        let (j, done) = job(VehicleCommand::Arm);
        let acks = ack_tx.clone();
        let task = tokio::spawn(async move { execute(&j, &link_tx, &acks).await });
        let sent = link_rx.recv().await.unwrap();
        assert_eq!(sent_command(&sent), MavCmd::MAV_CMD_COMPONENT_ARM_DISARM);
        ack_tx
            .send(Ack {
                sysid: 1,
                command: MavCmd::MAV_CMD_COMPONENT_ARM_DISARM,
                result: MavResult::MAV_RESULT_ACCEPTED,
            })
            .unwrap();
        assert_eq!(task.await.unwrap(), Outcome::Accepted);
        drop(done);
    }

    #[tokio::test(start_paused = true)]
    async fn refused_ack_reports_the_mav_result() {
        let (link_tx, mut link_rx) = mpsc::channel(8);
        let (ack_tx, _) = broadcast::channel(8);
        let (j, _done) = job(VehicleCommand::Arm);
        let acks = ack_tx.clone();
        let task = tokio::spawn(async move { execute(&j, &link_tx, &acks).await });
        link_rx.recv().await.unwrap();
        // an ACK for another vehicle is ignored, then the real one refuses
        ack_tx
            .send(Ack {
                sysid: 2,
                command: MavCmd::MAV_CMD_COMPONENT_ARM_DISARM,
                result: MavResult::MAV_RESULT_ACCEPTED,
            })
            .unwrap();
        ack_tx
            .send(Ack {
                sysid: 1,
                command: MavCmd::MAV_CMD_COMPONENT_ARM_DISARM,
                result: MavResult::MAV_RESULT_FAILED,
            })
            .unwrap();
        assert_eq!(task.await.unwrap(), Outcome::Refused("failed".into()));
    }

    #[tokio::test(start_paused = true)]
    async fn no_ack_retries_three_times_then_times_out() {
        let (link_tx, mut link_rx) = mpsc::channel(8);
        let (ack_tx, _) = broadcast::channel(8);
        let (j, _done) = job(VehicleCommand::Rtl);
        let task = tokio::spawn(async move { execute(&j, &link_tx, &ack_tx).await });
        let mut sends = 0;
        while let Some(o) = link_rx.recv().await {
            sends += 1;
            assert_eq!(sent_command(&o), MavCmd::MAV_CMD_DO_SET_MODE);
        }
        assert_eq!(sends, ATTEMPTS);
        assert_eq!(task.await.unwrap(), Outcome::Timeout);
    }

    #[tokio::test(start_paused = true)]
    async fn in_progress_extends_the_wait() {
        let (link_tx, mut link_rx) = mpsc::channel(8);
        let (ack_tx, _) = broadcast::channel(8);
        let (j, _done) = job(VehicleCommand::MissionStart);
        let acks = ack_tx.clone();
        let task = tokio::spawn(async move { execute(&j, &link_tx, &acks).await });
        link_rx.recv().await.unwrap();
        let c = MavCmd::MAV_CMD_MISSION_START;
        ack_tx
            .send(Ack {
                sysid: 1,
                command: c,
                result: MavResult::MAV_RESULT_IN_PROGRESS,
            })
            .unwrap();
        tokio::time::sleep(Duration::from_secs(3)).await;
        assert!(link_rx.try_recv().is_err(), "no retry while in progress");
        ack_tx
            .send(Ack {
                sysid: 1,
                command: c,
                result: MavResult::MAV_RESULT_ACCEPTED,
            })
            .unwrap();
        assert_eq!(task.await.unwrap(), Outcome::Accepted);
    }

    #[tokio::test]
    async fn encode_errors_and_closed_link_are_reported() {
        let (link_tx, _link_rx) = mpsc::channel(8);
        let (ack_tx, _) = broadcast::channel(8);
        let (j, _d) = job(VehicleCommand::SetMode { mode: "WARP".into() });
        assert_eq!(
            execute(&j, &link_tx, &ack_tx).await,
            Outcome::Encode("unknown mode WARP".into())
        );
        drop(_link_rx);
        let (j, _d) = job(VehicleCommand::Arm);
        assert_eq!(execute(&j, &link_tx, &ack_tx).await, Outcome::LinkClosed);
    }

    fn ack(tx: &broadcast::Sender<Ack>, command: MavCmd, result: MavResult) {
        tx.send(Ack {
            sysid: 1,
            command,
            result,
        })
        .unwrap();
    }

    #[tokio::test(start_paused = true)]
    async fn takeoff_switches_to_guided_then_sends_nav_takeoff() {
        let (link_tx, mut link_rx) = mpsc::channel(8);
        let (ack_tx, _) = broadcast::channel(8);
        let (j, _done) = job(VehicleCommand::Takeoff { alt_rel: 20.0 });
        let acks = ack_tx.clone();
        let task = tokio::spawn(async move { execute(&j, &link_tx, &acks).await });
        let first = link_rx.recv().await.unwrap();
        assert_eq!(sent_command(&first), MavCmd::MAV_CMD_DO_SET_MODE);
        ack(
            &ack_tx,
            MavCmd::MAV_CMD_DO_SET_MODE,
            MavResult::MAV_RESULT_ACCEPTED,
        );
        let second = link_rx.recv().await.unwrap();
        let MavMessage::COMMAND_LONG(d) = &second.message else {
            panic!("{second:?}")
        };
        assert_eq!((d.command, d.param7), (MavCmd::MAV_CMD_NAV_TAKEOFF, 20.0));
        ack(
            &ack_tx,
            MavCmd::MAV_CMD_NAV_TAKEOFF,
            MavResult::MAV_RESULT_ACCEPTED,
        );
        assert_eq!(task.await.unwrap(), Outcome::Accepted);
    }

    #[tokio::test(start_paused = true)]
    async fn takeoff_stops_when_the_mode_change_is_refused() {
        let (link_tx, mut link_rx) = mpsc::channel(8);
        let (ack_tx, _) = broadcast::channel(8);
        let (j, _done) = job(VehicleCommand::Takeoff { alt_rel: 20.0 });
        let acks = ack_tx.clone();
        let task = tokio::spawn(async move { execute(&j, &link_tx, &acks).await });
        link_rx.recv().await.unwrap();
        ack(&ack_tx, MavCmd::MAV_CMD_DO_SET_MODE, MavResult::MAV_RESULT_DENIED);
        assert_eq!(task.await.unwrap(), Outcome::Refused("denied".into()));
        assert!(
            link_rx.recv().await.is_none(),
            "no NAV_TAKEOFF after a refused mode change"
        );
    }

    #[tokio::test(start_paused = true)]
    async fn takeoff_reports_a_refused_nav_takeoff() {
        let (link_tx, mut link_rx) = mpsc::channel(8);
        let (ack_tx, _) = broadcast::channel(8);
        let (mut j, _done) = job(VehicleCommand::Takeoff { alt_rel: 20.0 });
        j.mode = "GUIDED".into();
        let acks = ack_tx.clone();
        let task = tokio::spawn(async move { execute(&j, &link_tx, &acks).await });
        assert_eq!(
            sent_command(&link_rx.recv().await.unwrap()),
            MavCmd::MAV_CMD_NAV_TAKEOFF
        );
        ack(&ack_tx, MavCmd::MAV_CMD_NAV_TAKEOFF, MavResult::MAV_RESULT_FAILED);
        assert_eq!(task.await.unwrap(), Outcome::Refused("failed".into()));
    }

    #[tokio::test]
    async fn rover_takeoff_is_an_encode_error() {
        let (link_tx, _link_rx) = mpsc::channel(8);
        let (ack_tx, _) = broadcast::channel(8);
        let (mut j, _d) = job(VehicleCommand::Takeoff { alt_rel: 20.0 });
        j.kind = VehicleKind::Rover;
        assert_eq!(
            execute(&j, &link_tx, &ack_tx).await,
            Outcome::Encode("this vehicle cannot take off".into())
        );
    }
}
