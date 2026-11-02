//! Parameter endpoints (`/params`): list, refresh, progress,
//! verified write (confirm token `param_write`, refused while armed) and history.

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use rgcs_core::{LinkStatus, ParamChange, ParamEntry, ParamProgress, ParamWriteResult, SysId};
use rgcs_store::audit::AuditInput;
use rgcs_store::param_history::ParamHistoryInput;
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::api::{err, ok};
use crate::app::AppState;
use crate::auth::AuthUser;
use crate::commands::confirm_failure;
use crate::params::{download, unverified, write_one};

pub const CMD_NAME: &str = "param_write";
pub const MAX_CHANGES: usize = 50;
pub const MAX_NAME_LEN: usize = 16;

#[derive(Serialize)]
pub struct ParamsReply {
    pub entries: Vec<ParamEntry>,
    pub progress: ParamProgress,
}

#[derive(Deserialize)]
pub struct WriteBody {
    pub changes: Vec<ParamChange>,
    pub confirm_token: Option<String>,
}

#[derive(Deserialize)]
pub struct HistoryQuery {
    pub sysid: Option<SysId>,
    pub limit: Option<u32>,
}

async fn vehicle_link_ok(app: &AppState, sysid: SysId) -> Result<bool, Box<Response>> {
    let Some(v) = app.router.lock().await.state(sysid).cloned() else {
        return Err(Box::new(err(
            StatusCode::NOT_FOUND,
            "not_found",
            format!("vehicle {sysid} is not connected"),
        )));
    };
    if v.link == LinkStatus::Lost {
        return Err(Box::new(err(
            StatusCode::SERVICE_UNAVAILABLE,
            "link_lost",
            "no heartbeat for 10 s",
        )));
    }
    Ok(v.armed)
}

/// `GET /api/vehicles/{sysid}/params`
pub async fn list(
    State(app): State<AppState>,
    AuthUser(_op): AuthUser,
    Path(sysid): Path<SysId>,
) -> Response {
    ok(ParamsReply {
        entries: app.params.entries(sysid),
        progress: app.params.progress(sysid),
    })
}

/// `GET /api/vehicles/{sysid}/params/progress`
pub async fn progress(
    State(app): State<AppState>,
    AuthUser(_op): AuthUser,
    Path(sysid): Path<SysId>,
) -> Response {
    ok(app.params.progress(sysid))
}

/// `POST /api/vehicles/{sysid}/params/refresh` → 202; a download already running is reported, not restarted.
pub async fn refresh(
    State(app): State<AppState>,
    AuthUser(_op): AuthUser,
    Path(sysid): Path<SysId>,
) -> Response {
    if let Err(r) = vehicle_link_ok(&app, sysid).await {
        return *r;
    }
    if app.params.begin_download(sysid) {
        tokio::spawn(download(app.params.clone(), sysid, app.outgoing.clone()));
    }
    (
        StatusCode::ACCEPTED,
        Json(json!({ "success": true, "data": app.params.progress(sysid) })),
    )
        .into_response()
}

/// Why writing must stop right now: armed, link lost or vehicle gone.
async fn interlock(app: &AppState, sysid: SysId) -> Option<&'static str> {
    match app.router.lock().await.state(sysid) {
        None => Some("not_found"),
        Some(v) if v.armed => Some("vehicle_armed"),
        Some(v) if v.link == LinkStatus::Lost => Some("link_lost"),
        Some(_) => None,
    }
}

fn validate(changes: &[ParamChange]) -> Option<String> {
    if changes.is_empty() || changes.len() > MAX_CHANGES {
        return Some(format!("changes must have 1..={MAX_CHANGES} entries"));
    }
    for c in changes {
        if c.name.is_empty()
            || c.name.len() > MAX_NAME_LEN
            || !c.name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
        {
            return Some(format!("name {:?} is not a parameter name", c.name));
        }
        if !c.value.is_finite() {
            return Some(format!("{}: value must be finite", c.name));
        }
    }
    None
}

/// `PUT /api/vehicles/{sysid}/params` — confirmed, refused while armed, each change verified by its echo.
pub async fn write(
    State(app): State<AppState>,
    AuthUser(op): AuthUser,
    Path(sysid): Path<SysId>,
    Json(body): Json<WriteBody>,
) -> Response {
    if let Some(reason) = validate(&body.changes) {
        return err(StatusCode::BAD_REQUEST, "validation", reason);
    }
    let armed = match vehicle_link_ok(&app, sysid).await {
        Ok(armed) => armed,
        Err(r) => return *r,
    };
    if app.params.progress(sysid).downloading {
        return err(
            StatusCode::CONFLICT,
            "download_in_progress",
            "wait for the parameter download to finish",
        );
    }
    if armed {
        audit(
            &app,
            &op.username,
            sysid,
            &body.changes,
            "rejected",
            Some("vehicle_armed"),
        )
        .await;
        return err(
            StatusCode::CONFLICT,
            "vehicle_armed",
            "disarm before writing parameters",
        );
    }
    let verdict = body
        .confirm_token
        .as_deref()
        .map(|t| app.consume_confirm(t, sysid, CMD_NAME));
    if let Some(reason) = confirm_failure(verdict) {
        audit(&app, &op.username, sysid, &body.changes, "rejected", Some(reason)).await;
        return err(StatusCode::CONFLICT, "confirm_required", reason);
    }
    let mut results: Vec<ParamWriteResult> = Vec::with_capacity(body.changes.len());
    let mut attempted = 0usize;
    for (i, change) in body.changes.iter().enumerate() {
        // A batch can take minutes; the interlock is re-checked before every PARAM_SET.
        if let Some(reason) = interlock(&app, sysid).await {
            let rest = &body.changes[i..];
            audit(&app, &op.username, sysid, rest, "rejected", Some(reason)).await;
            results.extend(rest.iter().map(|c| unverified(c, reason)));
            break;
        }
        attempted += 1;
        let old_value = app.params.get(sysid, &change.name);
        let result = write_one(&app.params, sysid, change, &app.outgoing).await;
        let row = ParamHistoryInput {
            operator: &op.username,
            sysid,
            name: &change.name,
            old_value,
            new_value: change.value,
            verified: result.verified,
        };
        if let Err(e) = app.store.record_param(row).await {
            tracing::error!(error = %e, "param_history write failed");
        }
        results.push(result);
    }
    if attempted > 0 {
        let all_ok = results.iter().take(attempted).all(|r| r.verified);
        let sent = &body.changes[..attempted];
        audit(
            &app,
            &op.username,
            sysid,
            sent,
            if all_ok { "ok" } else { "failed" },
            (!all_ok).then_some("unverified"),
        )
        .await;
    }
    ok(results)
}

/// `GET /api/history/params?sysid=&limit=`
pub async fn history(
    State(app): State<AppState>,
    AuthUser(_op): AuthUser,
    Query(q): Query<HistoryQuery>,
) -> Response {
    match app
        .store
        .recent_params(q.sysid, q.limit.unwrap_or(100).min(1000))
        .await
    {
        Ok(rows) => ok(rows),
        Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, "store", e.to_string()),
    }
}

async fn audit(
    app: &AppState,
    op: &str,
    sysid: SysId,
    changes: &[ParamChange],
    result: &str,
    reason: Option<&str>,
) {
    let args = json!(changes
        .iter()
        .map(|c| json!({ "name": c.name, "value": c.value }))
        .collect::<Vec<_>>());
    let entry = AuditInput {
        operator: op,
        sysid: Some(sysid),
        target: "settings",
        command: CMD_NAME,
        args: Some(args.to_string()),
        result,
        reason: reason.map(str::to_string),
    };
    if let Err(e) = app.store.record_audit(entry).await {
        tracing::error!(error = %e, "audit write failed");
    }
}
