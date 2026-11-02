//! `mission_transfer` frames for one mission write: write progress, then read-back progress,
//! then `done` or `failed` — also `failed` when the write is dropped half-way (the HTTP client
//! went away), so no client is left with a bar stuck at "writing".

use std::sync::Mutex as StdMutex;

use rgcs_core::{MissionTransfer, ServerMessage, SysId, TransferPhase};
use rgcs_mavlink::MissionFrame;
use tokio::sync::broadcast;

/// Sends `mission_transfer` frames for one upload; `done` never goes backwards within a phase.
pub(crate) struct Reporter {
    tx: broadcast::Sender<ServerMessage>,
    sysid: SysId,
    total: u16,
    last: StdMutex<(Option<TransferPhase>, u16)>,
}

impl Reporter {
    pub(crate) fn new(tx: broadcast::Sender<ServerMessage>, sysid: SysId, total: u16) -> Self {
        Self {
            tx,
            sysid,
            total,
            last: StdMutex::new((None, 0)),
        }
    }

    pub(crate) fn send(&self, phase: TransferPhase, done: u16) {
        let done = done.min(self.total);
        if let Ok(mut last) = self.last.lock() {
            if last.0 == Some(phase) && done <= last.1 {
                return;
            }
            *last = (Some(phase), done);
        }
        let _ = self.tx.send(ServerMessage::MissionTransfer {
            sysid: self.sysid,
            transfer: MissionTransfer {
                phase,
                done,
                total: self.total,
            },
        });
    }

    /// Write phase: a request for seq `n` means `n` frames were taken; the final ACK, all of them.
    #[allow(deprecated)]
    pub(crate) fn on_write_frame(&self, frame: &MissionFrame) {
        match frame {
            MissionFrame::RequestInt(r) => self.send(TransferPhase::Write, r.seq),
            MissionFrame::Request(r) => self.send(TransferPhase::Write, r.seq),
            MissionFrame::Ack(_) => self.send(TransferPhase::Write, self.total),
            _ => {}
        }
    }

    /// Verify phase: each item read back.
    pub(crate) fn on_read_frame(&self, frame: &MissionFrame) {
        if let MissionFrame::ItemInt(d) = frame {
            self.send(TransferPhase::Verify, d.seq + 1);
        }
    }
}

impl Drop for Reporter {
    fn drop(&mut self) {
        let finished = self
            .last
            .lock()
            .map(|l| matches!(l.0, None | Some(TransferPhase::Done | TransferPhase::Failed)))
            .unwrap_or(true);
        if !finished {
            self.send(TransferPhase::Failed, 0);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_write_dropped_midway_reports_failed() {
        // the HTTP client went away: axum drops the handler and the bar must not stick at "write"
        let (tx, mut rx) = broadcast::channel(8);
        {
            let r = Reporter::new(tx.clone(), 1, 21);
            r.send(TransferPhase::Write, 5);
        }
        let mut last = None;
        while let Ok(ServerMessage::MissionTransfer { transfer, .. }) = rx.try_recv() {
            last = Some(transfer.phase);
        }
        assert_eq!(last, Some(TransferPhase::Failed));
        {
            let r = Reporter::new(tx, 1, 21);
            r.send(TransferPhase::Done, 21);
        }
        let mut phases = Vec::new();
        while let Ok(ServerMessage::MissionTransfer { transfer, .. }) = rx.try_recv() {
            phases.push(transfer.phase);
        }
        assert_eq!(
            phases,
            vec![TransferPhase::Done],
            "a finished write says nothing more"
        );
    }
}
