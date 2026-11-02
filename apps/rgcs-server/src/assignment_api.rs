//! Plan assignment board: which saved plan each vehicle should fly.

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::Response;
use axum::Json;
use rgcs_core::{ServerMessage, SysId};
use rgcs_store::audit::AuditInput;
use rgcs_store::StoreError;
use serde::Deserialize;
use serde_json::json;

use crate::api::{err, ok};
use crate::app::AppState;
use crate::auth::AuthUser;

#[derive(Debug, Deserialize)]
pub struct AssignBody {
    pub plan_id: Option<i64>,
}

fn store_error(e: StoreError) -> Response {
    match e {
        StoreError::NotFound(what) => err(
            StatusCode::NOT_FOUND,
            "not_found",
            format!("{what} does not exist"),
        ),
        e => err(StatusCode::INTERNAL_SERVER_ERROR, "store", e.to_string()),
    }
}

/// Sends the full assignment list to every WebSocket client.
pub async fn broadcast_assignments(app: &AppState) {
    match app.store.list_assignments().await {
        Ok(rows) => {
            let _ = app.tx.send(ServerMessage::Assignments { rows });
        }
        Err(e) => tracing::error!(error = %e, "assignment list for broadcast failed"),
    }
}

async fn audit(
    app: &AppState,
    op: &str,
    sysid: SysId,
    plan_id: Option<i64>,
    result: &str,
    reason: Option<String>,
) {
    let command = if plan_id.is_some() { "assign" } else { "unassign" };
    let args = json!({ "plan_id": plan_id });
    let entry = AuditInput {
        operator: op,
        sysid: Some(sysid),
        target: "assignment",
        command,
        args: Some(args.to_string()),
        result,
        reason,
    };
    if let Err(e) = app.store.record_audit(entry).await {
        tracing::error!(error = %e, "audit write failed");
    }
}

/// `GET /api/assignments` → every vehicle row, sysid ascending.
pub async fn list_assignments(State(app): State<AppState>, AuthUser(_op): AuthUser) -> Response {
    match app.store.list_assignments().await {
        Ok(rows) => ok(rows),
        Err(e) => store_error(e),
    }
}

/// `PUT /api/assignments/{sysid}` `{plan_id | null}` → the vehicle's row; broadcasts the full list.
pub async fn put_assignment(
    State(app): State<AppState>,
    AuthUser(op): AuthUser,
    Path(sysid): Path<SysId>,
    Json(body): Json<AssignBody>,
) -> Response {
    match app.store.set_assignment(sysid, body.plan_id, &op.username).await {
        Ok(row) => {
            audit(&app, &op.username, sysid, body.plan_id, "ok", None).await;
            broadcast_assignments(&app).await;
            ok(row)
        }
        Err(e) => {
            audit(
                &app,
                &op.username,
                sysid,
                body.plan_id,
                "error",
                Some(e.to_string()),
            )
            .await;
            store_error(e)
        }
    }
}
