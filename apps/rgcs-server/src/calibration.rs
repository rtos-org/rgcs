//! One calibration session per vehicle: the API starts it, flight-controller
//! frames move it on, every change is broadcast and a finished run is recorded with its date.

use std::collections::HashMap;
use std::sync::{Arc, Mutex as StdMutex};

use rgcs_core::{CalibFrame, CalibKind, CalibPhase, CalibStatus, ServerMessage, SysId};
use rgcs_store::Store;
use tokio::sync::broadcast;

#[derive(Clone)]
pub struct CalibHub {
    tx: broadcast::Sender<ServerMessage>,
    store: Store,
    /// The session and the operator who started it.
    sessions: Arc<StdMutex<HashMap<SysId, (CalibStatus, String)>>>,
}

impl CalibHub {
    pub fn new(tx: broadcast::Sender<ServerMessage>, store: Store) -> Self {
        Self {
            tx,
            store,
            sessions: Arc::default(),
        }
    }

    pub fn get(&self, sysid: SysId) -> Option<CalibStatus> {
        self.lock().get(&sysid).map(|(s, _)| s.clone())
    }

    /// Starts a session; `None` while another one is still running on this vehicle.
    pub fn begin(&self, sysid: SysId, kind: CalibKind, operator: &str) -> Option<CalibStatus> {
        let status = CalibStatus::start(kind);
        {
            let mut sessions = self.lock();
            if sessions.get(&sysid).is_some_and(|(s, _)| s.is_active()) {
                return None;
            }
            sessions.insert(sysid, (status.clone(), operator.to_string()));
        }
        self.broadcast(sysid, &status);
        Some(status)
    }

    /// Replaces the session's state (a command outcome, the operator's next step).
    pub fn set(&self, sysid: SysId, status: CalibStatus) {
        let operator = {
            let mut sessions = self.lock();
            let Some((_, operator)) = sessions.get(&sysid).cloned() else {
                return;
            };
            sessions.insert(sysid, (status.clone(), operator.clone()));
            operator
        };
        self.broadcast(sysid, &status);
        if matches!(status.phase, CalibPhase::Done | CalibPhase::Failed) {
            let store = self.store.clone();
            tokio::spawn(async move {
                let reason = status.reason.as_deref();
                let ok = status.phase == CalibPhase::Done;
                if let Err(e) = store
                    .record_calibration(sysid, status.kind, ok, &operator, reason)
                    .await
                {
                    tracing::error!(error = %e, "calibration record failed");
                }
            });
        }
    }

    /// Called for every `RouterEvent::Calib`.
    pub fn on_frame(&self, sysid: SysId, frame: &CalibFrame) {
        let next = self.get(sysid).and_then(|s| s.on_frame(frame));
        if let Some(next) = next.filter(|n| Some(n) != self.get(sysid).as_ref()) {
            self.set(sysid, next);
        }
    }

    fn broadcast(&self, sysid: SysId, status: &CalibStatus) {
        let _ = self.tx.send(ServerMessage::Calibration {
            sysid,
            status: status.clone(),
        });
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashMap<SysId, (CalibStatus, String)>> {
        self.sessions.lock().unwrap_or_else(|e| e.into_inner())
    }
}

#[cfg(test)]
#[path = "calibration_tests.rs"]
mod tests;
