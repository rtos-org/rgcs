//! ARM / DISARM auto record: a 2 Hz task watches `armed` per vehicle
//! and starts / stops the camera recording on the edges when the profile's `auto_record` is on.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use rgcs_core::{
    CameraCommand, CameraKind, CameraState, MessageSource, RecordingState, Severity, StorageInfo,
    StorageStatus, SysId, VehicleMessage,
};
use rgcs_store::audit::AuditInput;
use tokio::task::JoinHandle;

use crate::app::AppState;

/// How often `router.states()` is sampled.
pub const POLL_EVERY: Duration = Duration::from_millis(500);
/// Operator name in the audit log.
pub const OPERATOR: &str = "auto_record";
/// Message code the UI translates (like `comms_delay`).
pub const SD_WARNING_TEXT: &str = "sd_card_problem";
/// Message code for an ARM start the camera did not take.
pub const AUTO_RECORD_FAILED_TEXT: &str = "auto_record_failed";
/// MAV_SEVERITY warning.
const WARNING_SEVERITY: u8 = 4;

/// Ids for minted messages; the message log replaces them with its row id.
static NEXT_MESSAGE_ID: AtomicU64 = AtomicU64::new(crate::telemetry::LINK_MESSAGE_ID_BASE + (1 << 39));

/// The command for one observation. The first sight of a vehicle (`prev_armed: None`) is no edge.
pub fn decide(
    prev_armed: Option<bool>,
    armed: bool,
    enabled: bool,
    rec: RecordingState,
) -> Option<CameraCommand> {
    let prev = prev_armed?;
    match (enabled, prev, armed) {
        (true, false, true) if rec != RecordingState::Recording => Some(CameraCommand::RecordStart),
        (true, true, false) if rec == RecordingState::Recording => Some(CameraCommand::RecordStop),
        _ => None,
    }
}

/// True when the SD card cannot take the recording (warn the operator on ARM).
pub fn sd_warning(storage: Option<&StorageInfo>, rec: RecordingState) -> bool {
    let card_bad = storage.is_some_and(|s| s.status != StorageStatus::Ok);
    card_bad || matches!(rec, RecordingState::NoCard | RecordingState::CardError)
}

/// A failed ARM start waiting for its one retry.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Retry {
    /// Nothing to retry.
    Idle,
    /// The camera is (or was last seen) offline.
    Waiting,
    /// Connected on the last tick; the retry goes out on the next one, once 0x0A has
    /// refreshed the recording state after the reconnect.
    Online,
}

/// What the watcher remembers per vehicle between ticks.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Watch {
    pub armed: bool,
    pub retry: Retry,
}

/// The retry step for one tick: the next retry state and whether to send `RecordStart` now.
pub fn retry_step(retry: Retry, armed: bool, connected: bool) -> (Retry, bool) {
    match (retry, armed, connected) {
        (Retry::Idle, _, _) | (_, false, _) => (Retry::Idle, false),
        (_, true, false) => (Retry::Waiting, false),
        (Retry::Waiting, true, true) => (Retry::Online, false),
        (Retry::Online, true, true) => (Retry::Idle, true),
    }
}

/// Spawns the 2 Hz watcher.
pub fn spawn(app: AppState) -> JoinHandle<()> {
    tokio::spawn(async move {
        let mut prev: HashMap<SysId, Watch> = HashMap::new();
        loop {
            prev = tick(&app, &prev).await;
            tokio::time::sleep(POLL_EVERY).await;
        }
    })
}

/// One observation of every vehicle; returns the new per-vehicle map.
async fn tick(app: &AppState, prev: &HashMap<SysId, Watch>) -> HashMap<SysId, Watch> {
    let armed: Vec<(SysId, bool)> = {
        let router = app.router.lock().await;
        router.states().iter().map(|s| (s.sysid, s.armed)).collect()
    };
    let mut next = HashMap::with_capacity(armed.len());
    for (sysid, now) in armed {
        let retry = match prev.get(&sysid) {
            None => Retry::Idle,
            Some(w) if w.armed != now => on_edge(app, sysid, Some(w.armed), now).await,
            Some(w) => retry_tick(app, sysid, w.retry, now).await,
        };
        next.insert(sysid, Watch { armed: now, retry });
    }
    next
}

/// The ARM / DISARM edge; a failed start warns the operator and asks for one retry.
async fn on_edge(app: &AppState, sysid: SysId, prev: Option<bool>, armed: bool) -> Retry {
    let profile = match app.store.camera_profile(sysid).await {
        Ok(p) => p,
        Err(e) => {
            tracing::warn!(sysid, error = %e, "auto record: profile read failed");
            return Retry::Idle;
        }
    };
    let Some(camera) = app.cameras.get(sysid).await else {
        if profile.auto_record && armed && profile.kind != CameraKind::None {
            warn(app, sysid, AUTO_RECORD_FAILED_TEXT);
            return Retry::Waiting;
        }
        return Retry::Idle;
    };
    if !camera.caps().record {
        return Retry::Idle;
    }
    let snap: CameraState = camera.state().borrow().clone();
    let Some(cmd) = decide(prev, armed, profile.auto_record, snap.recording) else {
        return Retry::Idle;
    };
    if cmd == CameraCommand::RecordStart && sd_warning(snap.storage.as_ref(), snap.recording) {
        warn(app, sysid, SD_WARNING_TEXT);
    }
    let started = send(app, sysid, cmd.clone()).await;
    if started || cmd != CameraCommand::RecordStart {
        return Retry::Idle;
    }
    warn(app, sysid, AUTO_RECORD_FAILED_TEXT);
    if snap.connected {
        Retry::Online
    } else {
        Retry::Waiting
    }
}

/// While armed, a failed start is sent once more when the camera is (back) online.
async fn retry_tick(app: &AppState, sysid: SysId, retry: Retry, armed: bool) -> Retry {
    if retry == Retry::Idle {
        return Retry::Idle;
    }
    let camera = app.cameras.get(sysid).await;
    let snap = camera.as_ref().map(|c| c.state().borrow().clone());
    let connected = snap.as_ref().is_some_and(|s| s.connected);
    let (next, send_now) = retry_step(retry, armed, connected);
    let recording = snap.is_some_and(|s| s.recording == RecordingState::Recording);
    let enabled = app.store.camera_profile(sysid).await.is_ok_and(|p| p.auto_record);
    if send_now && enabled && !recording && !send(app, sysid, CameraCommand::RecordStart).await {
        warn(app, sysid, AUTO_RECORD_FAILED_TEXT);
    }
    next
}

/// Sends and audits `cmd`; `true` when the camera took it.
async fn send(app: &AppState, sysid: SysId, cmd: CameraCommand) -> bool {
    let result = app.cameras.send(sysid, cmd.clone()).await;
    if let Err(e) = &result {
        tracing::warn!(sysid, error = %e, cmd = cmd.name(), "auto record command failed");
    }
    let ok = result.is_ok();
    audit(app, sysid, &cmd, result.err().map(|e| e.to_string())).await;
    ok
}

fn warn(app: &AppState, sysid: SysId, text: &str) {
    app.messages.submit(VehicleMessage::with_level(
        sysid,
        NEXT_MESSAGE_ID.fetch_add(1, Ordering::Relaxed),
        WARNING_SEVERITY,
        text.into(),
        crate::app::unix_ms(),
        MessageSource::System,
        Severity::Warn,
    ));
}

async fn audit(app: &AppState, sysid: SysId, cmd: &CameraCommand, error: Option<String>) {
    let entry = AuditInput {
        operator: OPERATOR,
        sysid: Some(sysid),
        target: "camera",
        command: cmd.name(),
        args: serde_json::to_string(cmd).ok(),
        result: if error.is_none() { "ok" } else { "rejected" },
        reason: error,
    };
    if let Err(e) = app.store.record_audit(entry).await {
        tracing::error!(error = %e, "audit write failed");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use RecordingState::*;

    fn storage(status: StorageStatus) -> StorageInfo {
        StorageInfo {
            status,
            fs: "exFAT".into(),
            total_gb: 128.0,
            free_gb: 56.3,
            free_pct: Some(44.0),
        }
    }

    #[test]
    fn decide_acts_on_edges_only() {
        assert_eq!(decide(None, true, true, Idle), None);
        assert_eq!(
            decide(Some(false), true, true, Idle),
            Some(CameraCommand::RecordStart)
        );
        assert_eq!(decide(Some(false), true, true, Recording), None);
        assert_eq!(
            decide(Some(true), false, true, Recording),
            Some(CameraCommand::RecordStop)
        );
        assert_eq!(decide(Some(false), true, false, Idle), None);
        assert_eq!(decide(Some(true), true, true, Idle), None);
        assert_eq!(decide(Some(true), false, true, Idle), None);
    }

    #[test]
    fn retry_waits_for_two_connected_ticks_while_armed() {
        assert_eq!(retry_step(Retry::Idle, true, true), (Retry::Idle, false));
        assert_eq!(retry_step(Retry::Waiting, true, false), (Retry::Waiting, false));
        assert_eq!(retry_step(Retry::Waiting, true, true), (Retry::Online, false));
        assert_eq!(retry_step(Retry::Online, true, true), (Retry::Idle, true));
        assert_eq!(retry_step(Retry::Online, true, false), (Retry::Waiting, false));
        assert_eq!(
            retry_step(Retry::Online, false, true),
            (Retry::Idle, false),
            "DISARM drops it"
        );
    }

    #[test]
    fn sd_warning_cases() {
        assert!(sd_warning(Some(&storage(StorageStatus::NotInserted)), Idle));
        assert!(sd_warning(Some(&storage(StorageStatus::Ok)), NoCard));
        assert!(sd_warning(Some(&storage(StorageStatus::Ok)), CardError));
        assert!(!sd_warning(Some(&storage(StorageStatus::Ok)), Idle));
        assert!(!sd_warning(None, Idle));
    }
}
