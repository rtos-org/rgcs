//! `GET /api/ai/status`, `POST /api/ai/chat`, `POST /api/ai/proposals/{id}/dismiss`
//!. The chat only reads and proposes; a proposal is
//! executed by the operator through `POST /api/vehicles/{sysid}/command` with `ai_proposal_id`.

use std::sync::Arc;

use axum::extract::{Path, State};
use axum::http::{header, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use rgcs_ai::{run_turn, AiConfig, AiError, LlmClient, ProviderKind, ToolRunRecord, TurnInput, TurnOutput};
use rgcs_core::{
    AiChatReply, AiChatRequest, AiProposal, AiProviderKind, AiStatus, AiStatusCard, AiToolRun, AiVideoState,
    SysId,
};
use serde_json::json;

use crate::ai_hub::{AiHub, HubRefusal, ProposalCheck};
use crate::ai_tools::{audit_ai, ServerTools};
use crate::api::{err, ok};
use crate::app::AppState;
use crate::auth::AuthUser;

/// Longest operator message, in characters.
pub const MAX_MESSAGE_CHARS: usize = 2_000;
/// Proposal ids are cut to this many characters before they reach the audit log.
const MAX_ID_CHARS: usize = 64;

/// The hub for `config.toml [ai]`, the key taken from the process environment.
pub fn build_ai(config: &AiConfig) -> AiHub {
    build_ai_with(config, &|k| std::env::var(k).ok())
}

/// [`build_ai`] with an injectable environment (tests never read the real one). Logs the
/// provider, model and the base URL's scheme + host + port only, never the key.
pub fn build_ai_with(config: &AiConfig, env: &dyn Fn(&str) -> Option<String>) -> AiHub {
    let resolved = match config.resolve_with(env) {
        Ok(r) => r,
        Err(reason) => {
            tracing::info!(reason = reason.reason(), "AI chat is not configured");
            return AiHub::disabled(reason);
        }
    };
    tracing::info!(
        provider = ?resolved.kind,
        model = %resolved.model,
        base_url = %rgcs_ai::ResolvedAi::loggable_url(&resolved.base_url),
        "AI chat enabled"
    );
    let provider = match resolved.kind {
        ProviderKind::Anthropic => AiProviderKind::Anthropic,
        ProviderKind::OpenaiCompat | ProviderKind::None => AiProviderKind::OpenaiCompat,
    };
    let status = AiStatus {
        configured: true,
        provider: Some(provider),
        model: Some(resolved.model.clone()),
        reason: None,
        budget_left: None,
    };
    let client: Arc<dyn LlmClient> = Arc::from(rgcs_ai::client_for(&resolved));
    AiHub::new(client, status, resolved.limits.clone(), config.daily_token_budget)
}

pub async fn status(State(app): State<AppState>, AuthUser(_): AuthUser) -> Response {
    ok(app.ai.status(app.ai.now_ms()))
}

pub async fn chat(
    State(app): State<AppState>,
    AuthUser(op): AuthUser,
    Json(body): Json<AiChatRequest>,
) -> Response {
    let hub = app.ai.clone();
    let Some(client) = hub.client() else {
        return err(
            StatusCode::SERVICE_UNAVAILABLE,
            "ai_unconfigured",
            "AI is not configured ([ai] in config.toml)",
        );
    };
    if let Some(reason) = message_invalid(&body.message) {
        return err(StatusCode::BAD_REQUEST, "invalid", reason);
    }
    let now = hub.now_ms();
    let _in_flight = match hub.begin(&op.username, now) {
        Ok(guard) => guard,
        Err(r) => return refusal(r),
    };
    let (conversation, history) = match hub.history(&op.username, body.conversation_id.as_deref(), now) {
        Ok(found) => found,
        Err(r) => return refusal(r),
    };
    let Some(name) = vehicle_name(&app, body.sysid).await else {
        return err(
            StatusCode::NOT_FOUND,
            "not_found",
            format!("vehicle {} is not connected", body.sysid),
        );
    };
    let tools = ServerTools::new(app.clone(), op.username.clone(), conversation.clone());
    let input = TurnInput {
        history: &history,
        user_text: format!(
            "[Target vehicle: {name} (sysid {})]\n{}",
            body.sysid, body.message
        ),
        limits: hub.limits(),
    };
    // every answered call is charged as it answers (success, failure, timeout or a dropped request)
    let metered = crate::ai_meter::Metered::new(client.as_ref(), &hub);
    let turn = tokio::time::timeout(hub.limits().chat_timeout, run_turn(&metered, &tools, input)).await;
    match turn {
        Err(_) => provider_failure(&AiError::Timeout),
        Ok(Err(e)) => provider_failure(&e),
        Ok(Ok(out)) => ok(finish(
            &hub,
            &op.username,
            conversation,
            out,
            tools.take_proposals(),
        )),
    }
}

pub async fn dismiss(
    State(app): State<AppState>,
    AuthUser(op): AuthUser,
    Path(id): Path<String>,
) -> Response {
    let verdict = app.ai.dismiss(&id, &op.username, app.ai.now_ms());
    let args = Some(json!({ "proposal_id": cut_id(&id) }).to_string());
    let user = op.username.as_str();
    match proposal_refusal(verdict) {
        None => {
            audit_ai(&app, user, None, "dismiss_proposal", args, "ok", None).await;
            ok(json!({ "id": id, "status": "dismissed" }))
        }
        Some((status, code, reason)) => {
            let why = Some(format!("{code}: {reason}"));
            audit_ai(&app, user, None, "dismiss_proposal", args, "rejected", why).await;
            err(status, code, reason)
        }
    }
}

/// Why a proposal cannot be executed or dismissed (`None` = it can).
pub fn proposal_refusal(verdict: ProposalCheck) -> Option<(StatusCode, &'static str, &'static str)> {
    match verdict {
        ProposalCheck::Ok => None,
        ProposalCheck::NotFound => Some((StatusCode::NOT_FOUND, "proposal_not_found", "unknown AI proposal")),
        ProposalCheck::Forbidden => Some((
            StatusCode::FORBIDDEN,
            "forbidden",
            "the proposal belongs to another user",
        )),
        ProposalCheck::Mismatch => Some((
            StatusCode::CONFLICT,
            "proposal_mismatch",
            "the proposal is for another vehicle or command",
        )),
        ProposalCheck::Expired => Some((
            StatusCode::CONFLICT,
            "proposal_expired",
            "the proposal has expired",
        )),
        ProposalCheck::Used => Some((
            StatusCode::CONFLICT,
            "proposal_used",
            "the proposal was already executed or dismissed",
        )),
    }
}

/// A client-supplied proposal id, cut for the audit log.
pub fn cut_id(id: &str) -> String {
    id.chars().take(MAX_ID_CHARS).collect()
}

fn message_invalid(message: &str) -> Option<String> {
    if message.trim().is_empty() {
        return Some("message is empty".into());
    }
    let chars = message.chars().count();
    (chars > MAX_MESSAGE_CHARS).then(|| format!("message is {chars} characters (max {MAX_MESSAGE_CHARS})"))
}

async fn vehicle_name(app: &AppState, sysid: SysId) -> Option<String> {
    app.router.lock().await.state(sysid).map(|v| v.name.clone())
}

fn refusal(r: HubRefusal) -> Response {
    match r {
        HubRefusal::RateLimited { retry_after_s } => rate_limited(retry_after_s),
        HubRefusal::Busy => err(
            StatusCode::CONFLICT,
            "ai_busy",
            "another chat of yours is running",
        ),
        HubRefusal::Budget => err(
            StatusCode::TOO_MANY_REQUESTS,
            "ai_budget",
            "the daily AI token budget is used up",
        ),
        HubRefusal::NotFound => err(
            StatusCode::NOT_FOUND,
            "conversation_not_found",
            "unknown conversation; start a new one",
        ),
        HubRefusal::Forbidden => err(
            StatusCode::FORBIDDEN,
            "forbidden",
            "the conversation belongs to another user",
        ),
        HubRefusal::Full => err(
            StatusCode::CONFLICT,
            "conversation_full",
            "the conversation is too long; start a new one",
        ),
    }
}

/// `429 rate_limited` with `error.retry_after_s` and a `Retry-After` header.
fn rate_limited(retry_after_s: u64) -> Response {
    let body = json!({
        "success": false,
        "error": {
            "code": "rate_limited",
            "message": format!("too many AI chats; retry in {retry_after_s} s"),
            "retry_after_s": retry_after_s,
        },
    });
    let mut res = (StatusCode::TOO_MANY_REQUESTS, Json(body)).into_response();
    res.headers_mut()
        .insert(header::RETRY_AFTER, HeaderValue::from(retry_after_s));
    res
}

fn provider_failure(e: &AiError) -> Response {
    let (status, code, message) = crate::ai_meter::provider_error(e);
    tracing::warn!(code, %message, "AI chat failed");
    err(status, code, message)
}

/// Commits the finished turn, stores its proposals and builds the reply.
fn finish(
    hub: &AiHub,
    user: &str,
    conversation: String,
    out: TurnOutput,
    proposals: Vec<AiProposal>,
) -> AiChatReply {
    let now = hub.now_ms();
    let status_card = status_card(&out.runs);
    let tool_runs = out.runs.iter().map(tool_run).collect();
    // the tokens were charged call by call by `Metered`
    hub.commit(user, &conversation, out.new_turns, 0, out.context, now);
    proposals.iter().for_each(|p| hub.add_proposal(p.clone(), user));
    AiChatReply {
        conversation_id: conversation,
        reply: out.reply,
        tool_runs,
        status_card,
        proposals,
        truncated: out.truncated,
        ts: now,
    }
}

fn tool_run(r: &ToolRunRecord) -> AiToolRun {
    AiToolRun {
        tool: r.name.clone(),
        sysid: r.sysid,
        ok: r.ok,
        error: r.error.clone(),
        ts: r.ts,
    }
}

/// The tool card from the last successful `get_vehicle_status` of the reply.
fn status_card(runs: &[ToolRunRecord]) -> Option<AiStatusCard> {
    let v = runs
        .iter()
        .rev()
        .filter(|r| r.ok && r.name == "get_vehicle_status")
        .find_map(|r| r.result.as_ref())?;
    Some(AiStatusCard {
        sysid: v["sysid"].as_u64().and_then(|s| SysId::try_from(s).ok())?,
        name: v["name"].as_str().unwrap_or_default().to_string(),
        last_rx_age_ms: v["last_rx_age_ms"].as_u64(),
        video: serde_json::from_value(v["video"].clone()).unwrap_or(AiVideoState::None),
    })
}
