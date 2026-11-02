//! Message log endpoints: per-vehicle and global lists, acknowledgement of
//! warnings / errors (audited, broadcast as `message_ack`).

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::Response;
use rgcs_core::{ServerMessage, SysId};
use rgcs_store::audit::AuditInput;
use rgcs_store::messages::{AckOutcome, SeverityFilter};
use serde::Deserialize;
use serde_json::json;

use crate::api::{err, ok};
use crate::app::AppState;
use crate::auth::AuthUser;
use crate::logbook_api::{internal, validation};

pub const MAX_LIMIT: u32 = 500;

#[derive(Deserialize)]
pub struct ListQuery {
    pub since: Option<i64>,
    pub severity: Option<String>,
    pub sysid: Option<SysId>,
    pub limit: Option<u32>,
}

fn filter_of(s: Option<&str>) -> Result<SeverityFilter, Box<Response>> {
    match s {
        None | Some("all") => Ok(SeverityFilter::All),
        Some("alerts") => Ok(SeverityFilter::Alerts),
        Some(other) => Err(Box::new(validation(format!(
            "severity must be all or alerts, not {other:?}"
        )))),
    }
}

async fn list(app: &AppState, sysid: Option<SysId>, q: &ListQuery) -> Response {
    let filter = match filter_of(q.severity.as_deref()) {
        Ok(f) => f,
        Err(r) => return *r,
    };
    let limit = q.limit.unwrap_or(MAX_LIMIT).clamp(1, MAX_LIMIT);
    match app.store.messages(sysid, q.since, filter, limit).await {
        Ok(rows) => ok(rows),
        Err(e) => internal(e),
    }
}

/// `GET /api/messages?since=&severity=all|alerts&sysid=&limit=` — newest first.
pub async fn list_all(
    State(app): State<AppState>,
    AuthUser(_op): AuthUser,
    Query(q): Query<ListQuery>,
) -> Response {
    let sysid = q.sysid;
    list(&app, sysid, &q).await
}

/// `GET /api/vehicles/{sysid}/messages?since=`
pub async fn list_vehicle(
    State(app): State<AppState>,
    AuthUser(_op): AuthUser,
    Path(sysid): Path<SysId>,
    Query(q): Query<ListQuery>,
) -> Response {
    list(&app, Some(sysid), &q).await
}

/// `POST /api/vehicles/{sysid}/messages/{id}/ack` — warnings / errors only; idempotent.
pub async fn ack(
    State(app): State<AppState>,
    AuthUser(op): AuthUser,
    Path((sysid, id)): Path<(SysId, i64)>,
) -> Response {
    match app
        .store
        .ack_message(sysid, id, &op.username, crate::app::unix_ms())
        .await
    {
        Ok(AckOutcome::Acked(e)) => {
            let entry = AuditInput {
                operator: &op.username,
                sysid: Some(sysid),
                target: "vehicle",
                command: "message_ack",
                args: Some(json!({ "id": id }).to_string()),
                result: "ok",
                reason: None,
            };
            if let Err(err) = app.store.record_audit(entry).await {
                tracing::warn!(error = %err, "audit write failed");
            }
            let _ = app.tx.send(ServerMessage::MessageAck {
                sysid,
                id,
                by: op.username.clone(),
                ts: e.acked_at.unwrap_or_default(),
            });
            ok(e)
        }
        Ok(AckOutcome::Already(e)) => ok(e),
        Ok(AckOutcome::NotAckable) => err(
            StatusCode::BAD_REQUEST,
            "not_ackable",
            "only warnings and errors from the vehicle are acknowledged",
        ),
        Ok(AckOutcome::NotFound) => err(
            StatusCode::NOT_FOUND,
            "not_found",
            format!("message {id} of vehicle {sysid} is unknown"),
        ),
        Err(e) => internal(e),
    }
}
