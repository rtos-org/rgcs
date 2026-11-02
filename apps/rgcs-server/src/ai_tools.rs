//! The AI's tools on the live server: read the
//! router, the message log, the video status, the AI 緊急介入 alerts and the external factors,
//! and validate proposals. Nothing here can send: there is no path to the vehicle command
//! channel, the link, the cameras or ROI, and nothing here can cancel, trigger or change a
//! guard alert or its level. Every call is audited with target `ai`.

use std::sync::Mutex as StdMutex;

use async_trait::async_trait;
use rgcs_ai::{ToolCall, ToolError, ToolHost};
use rgcs_core::{
    AiProposal, AiVideoState, CameraKind, LogEntry, SysId, VehicleCommand, VehicleState, VideoSourceStatus,
};
use rgcs_store::audit::AuditInput;
use rgcs_store::messages::SeverityFilter;
use serde_json::{json, Map, Value};

use crate::ai_hub::PROPOSAL_TTL_MS;
use crate::ai_tools_guard::{alerts_json, factors_json};
use crate::ai_validate::validate_proposal;
use crate::app::AppState;
use crate::commands::EXTENDED_SYS_STATE_ID;

/// Proposals one chat reply may carry; later ones get `too_many_proposals`.
pub const MAX_PROPOSALS_PER_REPLY: usize = 3;
pub const MAX_SEARCH_HITS: u32 = 30;
/// Audit `args` (the tool input JSON) are cut to this many characters.
pub const MAX_AUDIT_ARGS_CHARS: usize = 1_000;

/// One chat's tool host: the caller, the conversation and the proposals made so far.
pub struct ServerTools {
    app: AppState,
    user: String,
    conversation: String,
    proposals: StdMutex<Vec<AiProposal>>,
}

#[async_trait]
impl ToolHost for ServerTools {
    async fn run(&self, call: &ToolCall) -> Result<Value, ToolError> {
        let outcome = self.dispatch(call).await;
        let (result, reason) = match &outcome {
            Ok(_) => ("ok", None),
            Err(e) => (audit_result(e.code), Some(e.to_string())),
        };
        let args = capped_args(&call_args(call));
        audit_ai(
            &self.app,
            &self.user,
            call.sysid(),
            call.name(),
            Some(args),
            result,
            reason,
        )
        .await;
        outcome
    }
}

impl ServerTools {
    pub fn new(app: AppState, user: String, conversation: String) -> Self {
        Self {
            app,
            user,
            conversation,
            proposals: StdMutex::new(Vec::new()),
        }
    }

    pub fn conversation(&self) -> &str {
        &self.conversation
    }

    /// The proposals made during this chat, in order (the hub stores them on commit).
    pub fn take_proposals(&self) -> Vec<AiProposal> {
        std::mem::take(&mut *self.lock_proposals())
    }

    fn lock_proposals(&self) -> std::sync::MutexGuard<'_, Vec<AiProposal>> {
        self.proposals.lock().unwrap_or_else(|p| p.into_inner())
    }

    async fn dispatch(&self, call: &ToolCall) -> Result<Value, ToolError> {
        match call {
            ToolCall::GetVehicleStatus { sysid } => self.vehicle_status(*sysid).await,
            ToolCall::ListVehicles => Ok(self.list_vehicles().await),
            ToolCall::ListRecentMessages { sysid, limit } => self.recent_messages(*sysid, *limit).await,
            ToolCall::SearchLog { query, sysid, since } => self.search_log(query, *sysid, *since).await,
            ToolCall::ProposeCommand {
                sysid,
                command,
                reason,
            } => self.propose(*sysid, command, reason).await,
            ToolCall::ListGuardAlerts { sysid } => Ok(alerts_json(
                &self.app.guard.settings(),
                &self.app.guard.active_alerts(),
                *sysid,
            )),
            ToolCall::GetExternalFactors => Ok(factors_json(&self.app.env.summary(), self.app.env.gate())),
        }
    }

    /// The vehicle and whether EXTENDED_SYS_STATE was seen; the router lock is held only here.
    async fn vehicle(&self, sysid: SysId) -> Result<(VehicleState, bool), ToolError> {
        let router = self.app.router.lock().await;
        let seen = router.message_age_ms(sysid, EXTENDED_SYS_STATE_ID).is_some();
        router
            .state(sysid)
            .cloned()
            .map(|v| (v, seen))
            .ok_or_else(|| ToolError::new("not_found", format!("vehicle {sysid} is not connected")))
    }

    async fn vehicle_status(&self, sysid: SysId) -> Result<Value, ToolError> {
        let (v, _) = self.vehicle(sysid).await?;
        let video = self.video_state(sysid).await;
        let last = self
            .app
            .store
            .messages(Some(sysid), None, SeverityFilter::All, 1)
            .await
            .map_err(store_error)?;
        Ok(status_json(&v, video, last.first()))
    }

    async fn video_state(&self, sysid: SysId) -> AiVideoState {
        let configured = self
            .app
            .store
            .camera_profile(sysid)
            .await
            .is_ok_and(|p| p.kind != CameraKind::None);
        if !configured {
            return AiVideoState::None;
        }
        video_state(&self.app.video.status(sysid).await)
    }

    async fn list_vehicles(&self) -> Value {
        let states = self.app.router.lock().await.states();
        let vehicles: Vec<Value> = states.iter().map(summary_json).collect();
        json!({ "vehicles": vehicles })
    }

    async fn recent_messages(&self, sysid: Option<SysId>, limit: u32) -> Result<Value, ToolError> {
        let limit = limit.clamp(1, rgcs_ai::tools::MAX_MESSAGE_LIMIT);
        let rows = self
            .app
            .store
            .messages(sysid, None, SeverityFilter::All, limit)
            .await
            .map_err(store_error)?;
        Ok(json!({ "messages": rows.iter().map(message_json).collect::<Vec<_>>() }))
    }

    async fn search_log(
        &self,
        query: &str,
        sysid: Option<SysId>,
        since: Option<i64>,
    ) -> Result<Value, ToolError> {
        let rows = self
            .app
            .store
            .search_messages(query, sysid, since, MAX_SEARCH_HITS)
            .await
            .map_err(store_error)?;
        Ok(json!({
            "searched": "stored message log (STATUSTEXT, system and command messages); not DataFlash",
            "count": rows.len(),
            "hits": rows.iter().map(message_json).collect::<Vec<_>>(),
        }))
    }

    async fn propose(
        &self,
        sysid: SysId,
        command: &VehicleCommand,
        reason: &str,
    ) -> Result<Value, ToolError> {
        if self.lock_proposals().len() >= MAX_PROPOSALS_PER_REPLY {
            return Err(too_many());
        }
        let (v, vtol_seen) = self.vehicle(sysid).await?;
        let cmd = validate_proposal(command.clone(), &v, vtol_seen)
            .map_err(|(_, code, message)| ToolError::new(code, message))?;
        let now = self.app.ai.now_ms();
        let proposal = AiProposal {
            id: format!("p-{}", uuid::Uuid::new_v4()),
            sysid,
            vehicle_name: v.name,
            requires_confirm: cmd.requires_confirm(),
            command: cmd,
            reason: reason.to_string(),
            created_ms: now,
            expires_ms: now + PROPOSAL_TTL_MS,
        };
        let id = proposal.id.clone();
        let mut proposals = self.lock_proposals();
        if proposals.len() >= MAX_PROPOSALS_PER_REPLY {
            return Err(too_many());
        }
        proposals.push(proposal);
        Ok(json!({ "proposal_id": id, "status": "shown_to_operator" }))
    }
}

fn too_many() -> ToolError {
    ToolError::new(
        "too_many_proposals",
        format!("at most {MAX_PROPOSALS_PER_REPLY} proposals per reply"),
    )
}

fn store_error(e: rgcs_store::StoreError) -> ToolError {
    tracing::error!(error = %e, "AI tool store read failed");
    ToolError::new("store_error", "the message log could not be read")
}

/// `error` for failures of the lookup itself, `rejected` for refused proposals.
fn audit_result(code: &str) -> &'static str {
    match code {
        "not_found" | "store_error" => "error",
        _ => "rejected",
    }
}

/// `live` / `checking` / `down` from the video source monitor.
pub fn video_state(s: &VideoSourceStatus) -> AiVideoState {
    if s.probe_ok {
        AiVideoState::Live
    } else if s.scanning {
        AiVideoState::Checking
    } else {
        AiVideoState::Down
    }
}

fn status_json(v: &VehicleState, video: AiVideoState, last: Option<&LogEntry>) -> Value {
    json!({
        "sysid": v.sysid,
        "name": v.name,
        "kind": v.kind,
        "vtol": v.vtol,
        "mode": v.mode,
        "armed": v.armed,
        "link": v.link,
        "last_rx_age_ms": v.last_rx_ms,
        "battery": v.battery,
        "gps": v.gps,
        "position": { "lat": v.lat, "lon": v.lon, "alt_rel_m": v.alt_rel, "alt_msl_m": v.alt_msl },
        "heading_deg": v.hdg,
        "ground_speed_mps": v.ground_speed,
        "climb_mps": v.climb,
        "home": v.home,
        "warn": v.warn,
        "unread_messages": v.unread,
        "video": video,
        "last_message": last.map(message_json),
    })
}

fn summary_json(v: &VehicleState) -> Value {
    json!({
        "sysid": v.sysid,
        "name": v.name,
        "kind": v.kind,
        "vtol": v.vtol,
        "mode": v.mode,
        "armed": v.armed,
        "link": v.link,
        "last_rx_age_ms": v.last_rx_ms,
        "battery_pct": v.battery.pct,
    })
}

/// A message log row; its text came from a vehicle or a log, so it is data, never instructions.
fn message_json(e: &LogEntry) -> Value {
    json!({
        "id": e.id,
        "ts": e.ts,
        "sysid": e.sysid,
        "source": e.source,
        "severity": e.severity,
        "acked": e.acked_by.is_some(),
        "untrusted_text": e.text,
    })
}

/// The tool input as JSON (absent optional fields left out).
fn call_args(call: &ToolCall) -> Value {
    let mut m = Map::new();
    let mut put = |k: &str, v: Value| {
        if !v.is_null() {
            m.insert(k.to_string(), v);
        }
    };
    match call {
        ToolCall::GetVehicleStatus { sysid } => put("sysid", json!(sysid)),
        ToolCall::ListVehicles => {}
        ToolCall::ListRecentMessages { sysid, limit } => {
            put("sysid", json!(sysid));
            put("limit", json!(limit));
        }
        ToolCall::SearchLog { query, sysid, since } => {
            put("query", json!(query));
            put("sysid", json!(sysid));
            put("since", json!(since));
        }
        ToolCall::ProposeCommand {
            sysid,
            command,
            reason,
        } => {
            put("sysid", json!(sysid));
            put("command", serde_json::to_value(command).unwrap_or(Value::Null));
            put("reason", json!(reason));
        }
        ToolCall::ListGuardAlerts { sysid } => put("sysid", json!(sysid)),
        ToolCall::GetExternalFactors => {}
    }
    Value::Object(m)
}

fn capped_args(args: &Value) -> String {
    args.to_string().chars().take(MAX_AUDIT_ARGS_CHARS).collect()
}

/// One `target = "ai"` audit row; `command` is the tool name or `dismiss_proposal`.
pub async fn audit_ai(
    app: &AppState,
    user: &str,
    sysid: Option<SysId>,
    command: &str,
    args: Option<String>,
    result: &str,
    reason: Option<String>,
) {
    let entry = AuditInput {
        operator: user,
        sysid,
        target: "ai",
        command,
        args,
        result,
        reason,
    };
    if let Err(e) = app.store.record_audit(entry).await {
        tracing::error!(error = %e, "AI audit write failed");
    }
}
