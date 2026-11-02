//! `/api/guard/*`: settings with the consent rules, the
//! active alerts, 取り消し, and the decision records.

use axum::extract::rejection::JsonRejection;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::Response;
use axum::Json;
use rgcs_core::SysId;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::api::{err, ok};
use crate::app::AppState;
use crate::auth::{AdminUser, AuthUser};
use crate::guard_hub::{audit, CancelError};
use crate::guard_settings::{apply_put, save, GuardSettingsPut};

/// Rows `GET /api/guard/decisions` returns without `limit`.
const DEFAULT_DECISIONS: u32 = 100;

pub async fn get_settings(State(app): State<AppState>, AuthUser(_op): AuthUser) -> Response {
    ok(app.guard.settings())
}

pub async fn put_settings(
    State(app): State<AppState>,
    AdminUser(op): AdminUser,
    body: Result<Json<GuardSettingsPut>, JsonRejection>,
) -> Response {
    let Json(body) = match body {
        Ok(b) => b,
        Err(e) => return err(StatusCode::BAD_REQUEST, "validation", e.body_text()),
    };
    let _serial = app.guard.lock_settings().await;
    let current = app.guard.settings();
    let (next, changes) = match apply_put(&current, body, &op.username, app.guard.now_ms()) {
        Ok(v) => v,
        Err(r) => return err(StatusCode::BAD_REQUEST, r.code, r.message),
    };
    if let Err(e) = save(&app.store, &next).await {
        tracing::error!(error = %e, "guard settings write failed");
        return err(
            StatusCode::INTERNAL_SERVER_ERROR,
            "internal",
            "settings could not be stored",
        );
    }
    app.guard.apply_settings(next.clone());
    for c in changes {
        audit(&app.store, &op.username, None, c.command, c.args, "ok", None).await;
    }
    ok(next)
}

pub async fn alerts(State(app): State<AppState>, AuthUser(_op): AuthUser) -> Response {
    ok(app.guard.active_alerts())
}

pub async fn cancel(State(app): State<AppState>, AuthUser(op): AuthUser, Path(id): Path<String>) -> Response {
    match app.guard.cancel(&id, &op.username) {
        Ok(alert) => {
            let args = json!({ "alert_id": alert.id });
            audit(
                &app.store,
                &op.username,
                Some(alert.sysid),
                "cancel",
                args,
                "ok",
                None,
            )
            .await;
            ok(alert)
        }
        Err(CancelError::NotFound) => err(StatusCode::NOT_FOUND, "not_found", "no such active alert"),
        Err(CancelError::NotCancellable) => err(
            StatusCode::CONFLICT,
            "not_cancellable",
            "only a running countdown or a due switch can be cancelled",
        ),
    }
}

#[derive(Deserialize)]
pub struct DecisionQuery {
    pub sysid: Option<SysId>,
    pub limit: Option<u32>,
}

#[derive(Serialize)]
pub struct DecisionOut {
    pub id: i64,
    pub ts: u64,
    pub sysid: SysId,
    pub alert_id: String,
    pub event: String,
    pub phase: String,
    pub level: String,
    pub flight_id: Option<i64>,
    /// The `rgcs_guard::DecisionRecord` JSON.
    pub record: Value,
}

/// The newest `limit` rows, oldest first (the phases in the order they happened).
pub async fn decisions(
    State(app): State<AppState>,
    AdminUser(_op): AdminUser,
    Query(q): Query<DecisionQuery>,
) -> Response {
    let limit = q.limit.unwrap_or(DEFAULT_DECISIONS);
    match app.store.decisions(q.sysid, limit).await {
        Ok(rows) => ok(rows
            .into_iter()
            .rev()
            .map(|r| DecisionOut {
                record: serde_json::from_str(&r.record).unwrap_or(Value::Null),
                id: r.id,
                ts: r.ts,
                sysid: r.sysid,
                alert_id: r.alert_id,
                event: r.event,
                phase: r.phase,
                level: r.level,
                flight_id: r.flight_id,
            })
            .collect::<Vec<_>>()),
        Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, "internal", e.to_string()),
    }
}
