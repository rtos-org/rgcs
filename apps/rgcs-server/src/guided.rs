//! `POST /api/vehicles/{sysid}/guided`: a position-only Guided target.
//!
//! Order of checks: vehicle known → link alive → mode is GUIDED → first-use confirm token →
//! altitude valid → geofence (when both fence params are cached) → send → audit → broadcast.

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::Response;
use axum::Json;
use rgcs_core::{CommandResult, LinkStatus, ServerMessage, SysId};
use rgcs_mavlink::{encode_guided_target, encode_param_request_read, Outgoing};
use rgcs_store::audit::AuditInput;
use serde::{Deserialize, Serialize};

use crate::api::{err, ok};
use crate::app::{unix_ms, AppState};
use crate::auth::AuthUser;
use crate::commands::confirm_failure;

pub const CMD_NAME: &str = "guided";
const FENCE_ENABLE: &str = "FENCE_ENABLE";
const FENCE_ALT_MAX: &str = "FENCE_ALT_MAX";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AltMode {
    Keep,
    Set,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct GuidedBody {
    pub lat: f64,
    pub lon: f64,
    pub alt_mode: AltMode,
    pub alt_rel: Option<f32>,
    pub confirm_token: Option<String>,
}

#[derive(Serialize)]
pub struct GuidedReply {
    pub id: u64,
    pub warning: Option<&'static str>,
}

fn valid_position(lat: f64, lon: f64) -> bool {
    (-90.0..=90.0).contains(&lat) && (-180.0..=180.0).contains(&lon)
}

/// `Ok(None)` = fence allows; `Ok(Some(warning))` = fence unknown; `Err` = above the fence.
fn fence_check(app: &AppState, sysid: SysId, alt: f32) -> Result<Option<&'static str>, String> {
    match (
        app.params.get(sysid, FENCE_ENABLE),
        app.params.get(sysid, FENCE_ALT_MAX),
    ) {
        (Some(enabled), Some(max)) => {
            if enabled >= 1.0 && alt > max {
                Err(format!("altitude {alt} m is above FENCE_ALT_MAX {max} m"))
            } else {
                Ok(None)
            }
        }
        _ => Ok(Some("fence_unknown")),
    }
}

pub async fn guided(
    State(app): State<AppState>,
    AuthUser(op): AuthUser,
    Path(sysid): Path<SysId>,
    Json(body): Json<GuidedBody>,
) -> Response {
    if !valid_position(body.lat, body.lon) {
        return err(StatusCode::BAD_REQUEST, "invalid", "lat/lon out of range");
    }
    let Some(vehicle) = app.router.lock().await.state(sysid).cloned() else {
        return err(
            StatusCode::NOT_FOUND,
            "not_found",
            format!("vehicle {sysid} is not connected"),
        );
    };
    if vehicle.link == LinkStatus::Lost {
        return err(
            StatusCode::SERVICE_UNAVAILABLE,
            "link_lost",
            "no heartbeat for 10 s",
        );
    }
    if vehicle.mode != "GUIDED" {
        return err(StatusCode::CONFLICT, "mode_required", "switch to GUIDED first");
    }
    if !app.guided_confirmed(sysid) {
        let verdict = body
            .confirm_token
            .as_deref()
            .map(|t| app.consume_confirm(t, sysid, CMD_NAME));
        if let Some(reason) = confirm_failure(verdict) {
            audit(&app, &op.username, sysid, &body, "rejected", Some(reason)).await;
            return err(StatusCode::CONFLICT, "confirm_required", reason);
        }
    }
    let alt = match (body.alt_mode, body.alt_rel) {
        (AltMode::Keep, _) => vehicle.alt_rel,
        (AltMode::Set, Some(a)) if a.is_finite() => a,
        (AltMode::Set, _) => {
            return err(
                StatusCode::BAD_REQUEST,
                "invalid",
                "alt_rel is required for alt_mode=set",
            )
        }
    };
    let warning = match fence_check(&app, sysid, alt) {
        Ok(w) => w,
        Err(reason) => {
            audit(&app, &op.username, sysid, &body, "rejected", Some(&reason)).await;
            return err(StatusCode::CONFLICT, "fence_alt", reason);
        }
    };
    if warning.is_some() {
        for name in [FENCE_ENABLE, FENCE_ALT_MAX] {
            let _ = app.outgoing.try_send(Outgoing {
                message: encode_param_request_read(sysid, name),
            });
        }
    }
    let message = encode_guided_target(sysid, body.lat, body.lon, alt);
    if app.outgoing.send(Outgoing { message }).await.is_err() {
        return err(
            StatusCode::SERVICE_UNAVAILABLE,
            "link_lost",
            "link is not running",
        );
    }
    app.mark_guided_confirmed(sysid);
    // A guided target sent by the operator is a takeover for the AI guard.
    app.guard.note_operator_command(sysid);
    let id = app.next_command_id();
    audit(&app, &op.username, sysid, &body, "ok", None).await;
    let _ = app.tx.send(ServerMessage::CommandResult(CommandResult {
        id,
        sysid,
        cmd: CMD_NAME.into(),
        ok: true,
        reason: None,
        ts: unix_ms(),
        mav_cmd: None,
    }));
    ok(GuidedReply { id, warning })
}

async fn audit(
    app: &AppState,
    operator: &str,
    sysid: SysId,
    body: &GuidedBody,
    result: &str,
    reason: Option<&str>,
) {
    let args = serde_json::json!({ "lat": body.lat, "lon": body.lon, "alt_mode": body.alt_mode, "alt_rel": body.alt_rel });
    let entry = AuditInput {
        operator,
        sysid: Some(sysid),
        target: "vehicle",
        command: CMD_NAME,
        args: Some(args.to_string()),
        result,
        reason: reason.map(str::to_string),
    };
    if let Err(e) = app.store.record_audit(entry).await {
        tracing::error!(error = %e, "audit write failed");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn position_range() {
        assert!(valid_position(36.0, 139.0));
        assert!(!valid_position(91.0, 0.0));
        assert!(!valid_position(0.0, -181.0));
    }
}
