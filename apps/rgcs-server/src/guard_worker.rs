//! The guard hub's SQLite side: decision records, message rows and the audit
//! rows of the guard's own `SetMode`, written in step order by one task. The `SetMode` itself
//! never waits here — `GuardHub` sends it on its own execution task — so L3 latency is not disk
//! latency. An action's audit row is queued after its `Executing` record, so it still carries the
//! record's `decision_id`.

use std::collections::HashMap;
use std::sync::Arc;

use rgcs_core::{GuardLevel, MessageSource, ServerMessage, Severity, SysId};
use rgcs_guard::{DecisionRecord, BY_GUARD};
use rgcs_mavlink::{QueuedCommand, Router};
use rgcs_store::audit::AuditInput;
use rgcs_store::guard::NewDecision;
use rgcs_store::messages::NewMessage;
use rgcs_store::Store;
use serde_json::{json, Value};
use tokio::sync::{broadcast, mpsc, oneshot, Mutex};

use crate::guard_vehicle::{level_str, Out, EVENT};

/// `guard_decisions` keeps this many rows, pruned every `PRUNE_EVERY` inserts.
pub const KEEP_DECISIONS: u32 = 5_000;
const PRUNE_EVERY: u64 = 100;
pub const AUDIT_TARGET: &str = "ai_intervention";
/// Alert id → decision id entries kept for the audit rows.
const MAX_DECISION_IDS: usize = 1_000;

/// What the hub's tasks need from `AppState` (no `GuardHub` inside, so no cycle).
#[derive(Clone)]
pub(crate) struct GuardIo {
    pub store: Store,
    pub messages: crate::message_log::MessageLog,
    pub flights: crate::flights::FlightTracker,
    pub queue: mpsc::Sender<QueuedCommand>,
    pub router: Arc<Mutex<Router>>,
    pub params: crate::params::ParamCache,
}

/// The audit row of one guard `SetMode` (rejected, ok, failed or timeout).
pub(crate) struct ActionAudit {
    pub sysid: SysId,
    pub alert_id: String,
    pub mode: &'static str,
    pub result: &'static str,
    pub reason: Option<String>,
}

pub(crate) enum Job {
    Record {
        sysid: SysId,
        alert_id: String,
        phase: &'static str,
        level: GuardLevel,
        record: Box<DecisionRecord>,
    },
    Message {
        sysid: SysId,
        severity: Severity,
        text: String,
        ts: u64,
    },
    Audit(ActionAudit),
    Flush(oneshot::Sender<()>),
}

impl Job {
    /// A record or a message row for the writer (`None` for an alert or an action).
    pub(crate) fn of(o: Out) -> Option<Self> {
        match o {
            Out::Record {
                sysid,
                alert_id,
                phase,
                level,
                record,
            } => Some(Self::Record {
                sysid,
                alert_id,
                phase,
                level,
                record,
            }),
            Out::Message {
                sysid,
                severity,
                text,
                ts,
            } => Some(Self::Message {
                sysid,
                severity,
                text,
                ts,
            }),
            Out::Alert(_) | Out::Execute { .. } => None,
        }
    }
}

/// The writer task: one job at a time, in the order the hub dispatched them.
pub(crate) async fn work(
    tx: broadcast::Sender<ServerMessage>,
    io: GuardIo,
    mut rx: mpsc::UnboundedReceiver<Job>,
) {
    prune(&io.store).await;
    let mut decision_ids: HashMap<String, i64> = HashMap::new();
    let mut inserts = 0_u64;
    while let Some(job) = rx.recv().await {
        match job {
            Job::Flush(done) => {
                let _ = done.send(());
            }
            Job::Record {
                sysid,
                alert_id,
                phase,
                level,
                record,
            } => {
                let Some(id) = write_record(&io, sysid, &alert_id, phase, level, &record).await else {
                    continue;
                };
                if decision_ids.len() > MAX_DECISION_IDS {
                    decision_ids.clear();
                }
                decision_ids.insert(alert_id, id);
                inserts += 1;
                if inserts % PRUNE_EVERY == 0 {
                    prune(&io.store).await;
                }
            }
            Job::Message {
                sysid,
                severity,
                text,
                ts,
            } => message(&tx, &io, sysid, severity, text, ts).await,
            Job::Audit(a) => {
                let decision = decision_ids.get(&a.alert_id).copied();
                let args = json!({ "mode": a.mode, "alert_id": a.alert_id, "decision_id": decision });
                audit(
                    &io.store,
                    BY_GUARD,
                    Some(a.sysid),
                    "set_mode",
                    args,
                    a.result,
                    a.reason,
                )
                .await;
            }
        }
    }
}

async fn message(
    tx: &broadcast::Sender<ServerMessage>,
    io: &GuardIo,
    sysid: SysId,
    severity: Severity,
    text: String,
    ts: u64,
) {
    let new = NewMessage {
        ts,
        sysid: Some(sysid),
        source: MessageSource::System,
        severity,
        raw_severity: None,
        text,
    };
    if let Some(entry) = io.messages.record(new).await {
        let _ = tx.send(ServerMessage::LogEntry(entry));
    }
}

async fn write_record(
    io: &GuardIo,
    sysid: SysId,
    alert_id: &str,
    phase: &str,
    level: GuardLevel,
    record: &DecisionRecord,
) -> Option<i64> {
    let json = serde_json::to_string(record).ok()?;
    let row = NewDecision {
        ts: record.ts_ms,
        sysid,
        alert_id,
        event: EVENT,
        phase,
        level: level_str(level),
        flight_id: io.flights.open_flight(sysid),
        record: &json,
    };
    match io.store.record_decision(row).await {
        Ok(id) => Some(id),
        Err(e) => {
            tracing::error!(error = %e, "guard decision write failed");
            None
        }
    }
}

async fn prune(store: &Store) {
    if let Err(e) = store.prune_decisions(KEEP_DECISIONS).await {
        tracing::warn!(error = %e, "guard decision prune failed");
    }
}

/// An `audit_log` row with `target = "ai_intervention"`.
pub async fn audit(
    store: &Store,
    operator: &str,
    sysid: Option<SysId>,
    command: &str,
    args: Value,
    result: &str,
    reason: Option<String>,
) {
    let entry = AuditInput {
        operator,
        sysid,
        target: AUDIT_TARGET,
        command,
        args: Some(args.to_string()),
        result,
        reason,
    };
    if let Err(e) = store.record_audit(entry).await {
        tracing::error!(error = %e, "guard audit write failed");
    }
}
