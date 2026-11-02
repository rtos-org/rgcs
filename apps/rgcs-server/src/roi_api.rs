//! `/api/vehicles/{sysid}/roi/*`: GPS ROI presets, control parameters,
//! start / stop. Start and stop exist only here (ROI is not a `CameraCommand`).

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::Response;
use axum::Json;
use rgcs_core::{validate_roi_targets, RoiControl, RoiTarget, SysId};
use rgcs_store::audit::AuditInput;
use serde::{Deserialize, Serialize};

use crate::api::{err, ok};
use crate::app::AppState;
use crate::auth::AuthUser;
use crate::roi::{RoiError, StopReason};

/// One ROI audit row (target `roi`).
pub struct RoiAudit<'a> {
    pub operator: &'a str,
    pub sysid: SysId,
    pub command: &'a str,
    pub args: Option<String>,
    pub result: &'a str,
    pub reason: Option<&'a str>,
}

pub async fn audit_roi(app: &AppState, a: RoiAudit<'_>) {
    let entry = AuditInput {
        operator: a.operator,
        sysid: Some(a.sysid),
        target: "roi",
        command: a.command,
        args: a.args,
        result: a.result,
        reason: a.reason.map(str::to_string),
    };
    if let Err(e) = app.store.record_audit(entry).await {
        tracing::error!(error = %e, "audit write failed");
    }
}

/// Audits a stop the operator did not ask for directly (`manual_input` / `manual_command` /
/// `profile_reload`).
pub async fn audit_manual_stop(app: &AppState, operator: &str, sysid: SysId, reason: &str) {
    let a = RoiAudit {
        operator,
        sysid,
        command: "stop",
        args: None,
        result: "ok",
        reason: Some(reason),
    };
    audit_roi(app, a).await;
}

fn internal(e: impl std::fmt::Display) -> Response {
    err(StatusCode::INTERNAL_SERVER_ERROR, "internal", e.to_string())
}

pub async fn get_targets(
    State(app): State<AppState>,
    AuthUser(_op): AuthUser,
    Path(sysid): Path<SysId>,
) -> Response {
    match app.store.roi_targets(sysid).await {
        Ok(t) => ok(t),
        Err(e) => internal(e),
    }
}

pub async fn put_targets(
    State(app): State<AppState>,
    AuthUser(op): AuthUser,
    Path(sysid): Path<SysId>,
    Json(targets): Json<Vec<RoiTarget>>,
) -> Response {
    if let Err(e) = validate_roi_targets(&targets) {
        return err(StatusCode::BAD_REQUEST, "validation", e.to_string());
    }
    if let Err(e) = app.store.put_roi_targets(sysid, &targets).await {
        return internal(e);
    }
    app.roi.set_targets(sysid, targets.clone()).await;
    let a = RoiAudit {
        operator: &op.username,
        sysid,
        command: "targets",
        args: serde_json::to_string(&targets).ok(),
        result: "ok",
        reason: None,
    };
    audit_roi(&app, a).await;
    ok(targets)
}

pub async fn get_control(
    State(app): State<AppState>,
    AuthUser(_op): AuthUser,
    Path(sysid): Path<SysId>,
) -> Response {
    match app.store.roi_control(sysid).await {
        Ok(c) => ok(c),
        Err(e) => internal(e),
    }
}

pub async fn put_control(
    State(app): State<AppState>,
    AuthUser(op): AuthUser,
    Path(sysid): Path<SysId>,
    Json(control): Json<RoiControl>,
) -> Response {
    if let Err(e) = control.validate() {
        return err(StatusCode::BAD_REQUEST, "validation", e.to_string());
    }
    if let Err(e) = app.store.put_roi_control(sysid, &control).await {
        return internal(e);
    }
    app.roi.configure(sysid, control.clone()).await;
    let a = RoiAudit {
        operator: &op.username,
        sysid,
        command: "control",
        args: serde_json::to_string(&control).ok(),
        result: "ok",
        reason: None,
    };
    audit_roi(&app, a).await;
    ok(control)
}

#[derive(Deserialize, Serialize)]
pub struct StartBody {
    pub id: String,
}

fn start_error(e: &RoiError) -> (StatusCode, &'static str, String) {
    match e {
        RoiError::NotFound => (StatusCode::NOT_FOUND, "not_found", "no such ROI preset".into()),
        RoiError::Unset => (
            StatusCode::CONFLICT,
            "roi_target_unset",
            "the ROI preset has no name or position".into(),
        ),
        RoiError::Unsupported => (
            StatusCode::CONFLICT,
            "unsupported_capability",
            "the camera cannot point at a GPS target".into(),
        ),
        RoiError::CameraOffline => (
            StatusCode::SERVICE_UNAVAILABLE,
            "camera_offline",
            "camera is not connected".into(),
        ),
        RoiError::Internal(m) => (StatusCode::INTERNAL_SERVER_ERROR, "internal", m.clone()),
    }
}

pub async fn start(
    State(app): State<AppState>,
    AuthUser(op): AuthUser,
    Path(sysid): Path<SysId>,
    Json(body): Json<StartBody>,
) -> Response {
    let result = app.roi.start(sysid, &body.id).await;
    let code = result.as_ref().err().map(|e| start_error(e).1);
    let a = RoiAudit {
        operator: &op.username,
        sysid,
        command: "start",
        args: serde_json::to_string(&body).ok(),
        result: if result.is_ok() { "ok" } else { "rejected" },
        reason: code,
    };
    audit_roi(&app, a).await;
    match result {
        Ok(target) => ok(target),
        Err(e) => {
            let (status, code, message) = start_error(&e);
            err(status, code, message)
        }
    }
}

#[derive(Serialize)]
pub struct StopReply {
    pub stopped: bool,
}

pub async fn stop(State(app): State<AppState>, AuthUser(op): AuthUser, Path(sysid): Path<SysId>) -> Response {
    let stopped = app.roi.stop(sysid, StopReason::Operator).await;
    let reply = StopReply { stopped };
    let a = RoiAudit {
        operator: &op.username,
        sysid,
        command: "stop",
        args: serde_json::to_string(&reply).ok(),
        result: "ok",
        reason: None,
    };
    audit_roi(&app, a).await;
    ok(reply)
}
