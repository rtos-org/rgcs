//! The message log service (2026-10-18): persists every vehicle message, link
//! event and command result, broadcasts it with its row id, and prunes the table.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use rgcs_core::{CommandResult, LogEntry, MessageSource, ServerMessage, Severity, VehicleMessage};
use rgcs_store::messages::NewMessage;
use rgcs_store::Store;
use tokio::sync::{broadcast, mpsc};

/// Rows kept in `messages` (the sheet shows the newest 500; older ones stay for maintenance).
pub const KEEP_ROWS: u32 = 5_000;
/// Prune once every this many inserts (and once at startup).
pub const PRUNE_EVERY: u64 = 1_000;
/// Vehicle messages waiting for their insert; beyond this they are sent unstored.
const QUEUE: usize = 1_024;
/// Ids for messages the database refused, far above any row id and the link-event range (1 << 40).
pub const UNSTORED_ID_BASE: u64 = 1 << 42;

#[derive(Clone)]
pub struct MessageLog {
    store: Store,
    tx: broadcast::Sender<ServerMessage>,
    inserts: Arc<AtomicU64>,
    keep: u32,
    queue: mpsc::Sender<VehicleMessage>,
}

impl MessageLog {
    /// Starts the recorder task (it prunes once, then stores and broadcasts queued messages in order).
    pub fn spawn(store: Store, tx: broadcast::Sender<ServerMessage>) -> Self {
        Self::spawn_with(store, tx, KEEP_ROWS)
    }

    pub fn spawn_with(store: Store, tx: broadcast::Sender<ServerMessage>, keep: u32) -> Self {
        let (queue, rx) = mpsc::channel(QUEUE);
        let log = Self {
            store,
            tx,
            inserts: Arc::new(AtomicU64::new(0)),
            keep,
            queue,
        };
        tokio::spawn(log.clone().run(rx));
        log
    }

    async fn run(self, mut rx: mpsc::Receiver<VehicleMessage>) {
        self.prune().await;
        while let Some(m) = rx.recv().await {
            let m = self.record_vehicle(m).await;
            let _ = self.tx.send(ServerMessage::VehicleMessage(m));
        }
    }

    async fn prune(&self) {
        if let Err(e) = self.store.prune_messages(self.keep).await {
            tracing::warn!(error = %e, "message log prune failed");
        }
    }

    /// Queues a vehicle / link message; never waits (the MAVLink event pump calls it).
    pub fn submit(&self, m: VehicleMessage) {
        if let Err(e) = self.queue.try_send(m) {
            let m = match e {
                mpsc::error::TrySendError::Full(m) | mpsc::error::TrySendError::Closed(m) => m,
            };
            tracing::warn!("message log queue full; sending the message unstored");
            let _ = self.tx.send(ServerMessage::VehicleMessage(unstored(m)));
        }
    }

    /// Inserts one entry; `None` when the database refuses.
    pub async fn record(&self, m: NewMessage) -> Option<LogEntry> {
        let entry = match self.store.record_message(&m).await {
            Ok(e) => e,
            Err(e) => {
                tracing::warn!(error = %e, "message log insert failed");
                return None;
            }
        };
        if self.inserts.fetch_add(1, Ordering::Relaxed) % PRUNE_EVERY == PRUNE_EVERY - 1 {
            self.prune().await;
        }
        Some(entry)
    }

    /// Persists a vehicle / link message and returns it with the row id as its `id`; an unstored
    /// message gets an id that cannot collide with a row and cannot be acknowledged.
    async fn record_vehicle(&self, m: VehicleMessage) -> VehicleMessage {
        let raw = (m.source == MessageSource::Vehicle).then_some(m.severity);
        let new = NewMessage {
            ts: m.ts,
            sysid: Some(m.sysid),
            source: m.source,
            severity: m.level,
            raw_severity: raw,
            text: m.text.clone(),
        };
        match self.record(new).await {
            Some(e) => VehicleMessage { id: e.id as u64, ..m },
            None => unstored(m),
        }
    }

    /// Logs a command result and broadcasts it as a `log_entry`.
    /// The text is "<cmd>[:<mav_cmd>] [reason]"; the UI translates the first word.
    pub async fn record_command(&self, r: &CommandResult) {
        let name = match r.mav_cmd {
            Some(mav_cmd) => format!("{}:{mav_cmd}", r.cmd),
            None => r.cmd.clone(),
        };
        let text = match &r.reason {
            Some(reason) => format!("{name} {reason}"),
            _ => name,
        };
        let new = NewMessage {
            ts: r.ts,
            sysid: Some(r.sysid),
            source: MessageSource::Command,
            severity: if r.ok { Severity::Ok } else { Severity::Error },
            raw_severity: None,
            text,
        };
        if let Some(e) = self.record(new).await {
            let _ = self.tx.send(ServerMessage::LogEntry(e));
        }
    }
}

/// Watches the broadcast for command results (sent from several handlers) and logs them.
pub async fn run_recorder(log: MessageLog, mut rx: broadcast::Receiver<ServerMessage>) {
    loop {
        match rx.recv().await {
            Ok(ServerMessage::CommandResult(r)) => log.record_command(&r).await,
            Ok(_) | Err(broadcast::error::RecvError::Lagged(_)) => {}
            Err(broadcast::error::RecvError::Closed) => return,
        }
    }
}

fn unstored(m: VehicleMessage) -> VehicleMessage {
    VehicleMessage {
        id: UNSTORED_ID_BASE + m.id,
        ackable: false,
        ..m
    }
}
