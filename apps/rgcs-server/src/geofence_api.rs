//! Geofence and rally endpoints (user request 2026-10-19): `GET / PUT /api/vehicles/{sysid}/fence`
//! and `.../rally`. Written like the mission (validate → write → read back → compare) but as
//! `MAV_MISSION_TYPE_FENCE` / `_RALLY` lists without a home slot.

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use mavlink::dialects::ardupilotmega::MavMissionType;
use rgcs_core::geofence::{
    fence_from_items, fence_to_items, rally_from_items, rally_to_items, validate_fence, validate_rally,
};
use rgcs_core::{FenceZone, Finding, Mission, MissionItem, RallyPoint, SysId, UploadReport};
use rgcs_store::audit::AuditInput;
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::api::{err, ok};
use crate::app::AppState;
use crate::auth::AuthUser;
use crate::mission_api::{mission_error, vehicle_for_write};
use crate::telemetry::FENCE_PARAMS;

const FENCE: MavMissionType = MavMissionType::MAV_MISSION_TYPE_FENCE;
const RALLY: MavMissionType = MavMissionType::MAV_MISSION_TYPE_RALLY;

#[derive(Debug, Deserialize, Serialize)]
pub struct FenceBody {
    pub zones: Vec<FenceZone>,
}

#[derive(Debug, Deserialize, Serialize)]
pub struct RallyBody {
    pub points: Vec<RallyPoint>,
}

/// One fence / rally operation: who asked, for which vehicle, on which list (`fence` / `rally`).
struct Op<'a> {
    app: &'a AppState,
    operator: &'a str,
    sysid: SysId,
    target: &'static str,
    mission_type: MavMissionType,
}

impl Op<'_> {
    async fn audit(&self, command: &str, items: usize, result: &str, reason: Option<String>) {
        let entry = AuditInput {
            operator: self.operator,
            sysid: Some(self.sysid),
            target: self.target,
            command,
            args: Some(json!({ "items": items }).to_string()),
            result,
            reason,
        };
        if let Err(e) = self.app.store.record_audit(entry).await {
            tracing::error!(error = %e, "audit write failed");
        }
    }

    async fn component(&self) -> u8 {
        self.app.router.lock().await.fc_component(self.sysid).unwrap_or(1)
    }

    /// Writes `items` and reports what the read-back matched.
    async fn write(&self, items: Vec<MissionItem>, findings: Vec<Finding>) -> Response {
        let n = items.len();
        let component = self.component().await;
        let written = self
            .app
            .missions
            .write_list(
                self.sysid,
                component,
                items,
                self.mission_type,
                &self.app.outgoing,
            )
            .await;
        match written {
            Ok((_, mismatched)) => {
                let verified = mismatched.is_empty();
                let result = if verified { "ok" } else { "mismatch" };
                self.audit("upload", n, result, None).await;
                ok(UploadReport {
                    items: n as u32,
                    verified,
                    mismatched,
                    findings,
                })
            }
            Err(e) => {
                self.audit("upload", n, "error", Some(e.to_string())).await;
                mission_error(e)
            }
        }
    }

    async fn read(&self) -> Result<Vec<MissionItem>, Box<Response>> {
        let component = self.component().await;
        let got = self
            .app
            .missions
            .read_list(self.sysid, component, self.mission_type, &self.app.outgoing)
            .await;
        match got {
            Ok(items) => {
                self.audit("download", items.len(), "ok", None).await;
                Ok(items)
            }
            Err(e) => {
                self.audit("download", 0, "error", Some(e.to_string())).await;
                Err(Box::new(mission_error(e)))
            }
        }
    }
}

fn refused(code: &str, findings: &[Finding]) -> Response {
    (
        StatusCode::CONFLICT,
        Json(json!({
            "success": false,
            "error": { "code": code, "message": "the list has fatal findings" },
            "data": { "findings": findings },
        })),
    )
        .into_response()
}

/// What the planner shows next to the zones: the altitude ceiling and whether ArduPilot enforces
/// it and the zones (`FENCE_TYPE` bit 0 = max altitude, bit 2 = polygons / circles). `None` while
/// the vehicle has not reported the parameter.
#[derive(Debug, Serialize, ts_rs::TS)]
#[ts(export)]
pub struct FenceParams {
    pub enabled: Option<bool>,
    pub alt_max: Option<f32>,
    pub alt_max_on: Option<bool>,
    pub zones_on: Option<bool>,
}

const FENCE_TYPE_ALT_MAX: u32 = 1;
const FENCE_TYPE_ZONES: u32 = 4;
const PARAM_WAIT: std::time::Duration = std::time::Duration::from_millis(200);
const PARAM_WAIT_ROUNDS: u32 = 5;

fn fence_params(app: &AppState, sysid: SysId) -> FenceParams {
    let get = |name: &str| app.params.get(sysid, name);
    let mask = get("FENCE_TYPE").map(|v| v as u32);
    FenceParams {
        enabled: get("FENCE_ENABLE").map(|v| v >= 1.0),
        alt_max: get("FENCE_ALT_MAX"),
        alt_max_on: mask.map(|m| m & FENCE_TYPE_ALT_MAX != 0),
        zones_on: mask.map(|m| m & FENCE_TYPE_ZONES != 0),
    }
}

/// `GET /api/vehicles/{sysid}/fence/params` — from the parameter cache; asks the vehicle for
/// what is missing and waits up to ~1 s for the answers.
pub async fn get_fence_params(
    State(app): State<AppState>,
    AuthUser(_user): AuthUser,
    Path(sysid): Path<SysId>,
) -> Response {
    let known = |p: &FenceParams| p.enabled.is_some() && p.alt_max.is_some() && p.alt_max_on.is_some();
    let mut p = fence_params(&app, sysid);
    if !known(&p) {
        for name in FENCE_PARAMS {
            let _ = app.outgoing.try_send(rgcs_mavlink::Outgoing {
                message: rgcs_mavlink::encode_param_request_read(sysid, name),
            });
        }
        for _ in 0..PARAM_WAIT_ROUNDS {
            tokio::time::sleep(PARAM_WAIT).await;
            p = fence_params(&app, sysid);
            if known(&p) {
                break;
            }
        }
    }
    ok(p)
}

/// `PUT /api/vehicles/{sysid}/fence {zones}`.
pub async fn put_fence(
    State(app): State<AppState>,
    AuthUser(user): AuthUser,
    Path(sysid): Path<SysId>,
    Json(body): Json<FenceBody>,
) -> Response {
    if let Err(r) = vehicle_for_write(&app, sysid).await {
        return *r;
    }
    let op = Op {
        app: &app,
        operator: &user.username,
        sysid,
        target: "fence",
        mission_type: FENCE,
    };
    let findings = validate_fence(&body.zones);
    if Mission::has_fatal(&findings) {
        op.audit(
            "upload",
            body.zones.len(),
            "rejected",
            Some("fence_invalid".into()),
        )
        .await;
        return refused("fence_invalid", &findings);
    }
    op.write(fence_to_items(&body.zones), findings).await
}

/// `GET /api/vehicles/{sysid}/fence` → `{zones}`.
pub async fn get_fence(
    State(app): State<AppState>,
    AuthUser(user): AuthUser,
    Path(sysid): Path<SysId>,
) -> Response {
    if let Err(r) = vehicle_for_write(&app, sysid).await {
        return *r;
    }
    let op = Op {
        app: &app,
        operator: &user.username,
        sysid,
        target: "fence",
        mission_type: FENCE,
    };
    match op.read().await {
        Ok(items) => match fence_from_items(&items) {
            Ok(zones) => ok(FenceBody { zones }),
            Err(e) => err(StatusCode::BAD_GATEWAY, "fence_unreadable", e),
        },
        Err(r) => *r,
    }
}

/// `PUT /api/vehicles/{sysid}/rally {points}`; altitudes go out as whole metres (ArduPilot int16).
pub async fn put_rally(
    State(app): State<AppState>,
    AuthUser(user): AuthUser,
    Path(sysid): Path<SysId>,
    Json(body): Json<RallyBody>,
) -> Response {
    if let Err(r) = vehicle_for_write(&app, sysid).await {
        return *r;
    }
    let op = Op {
        app: &app,
        operator: &user.username,
        sysid,
        target: "rally",
        mission_type: RALLY,
    };
    let points: Vec<RallyPoint> = body
        .points
        .iter()
        .map(|p| RallyPoint {
            alt: p.alt.round(),
            ..*p
        })
        .collect();
    let findings = validate_rally(&points);
    if Mission::has_fatal(&findings) {
        op.audit("upload", points.len(), "rejected", Some("rally_invalid".into()))
            .await;
        return refused("rally_invalid", &findings);
    }
    op.write(rally_to_items(&points), findings).await
}

/// `GET /api/vehicles/{sysid}/rally` → `{points}`.
pub async fn get_rally(
    State(app): State<AppState>,
    AuthUser(user): AuthUser,
    Path(sysid): Path<SysId>,
) -> Response {
    if let Err(r) = vehicle_for_write(&app, sysid).await {
        return *r;
    }
    let op = Op {
        app: &app,
        operator: &user.username,
        sysid,
        target: "rally",
        mission_type: RALLY,
    };
    match op.read().await {
        Ok(items) => ok(RallyBody {
            points: rally_from_items(&items),
        }),
        Err(r) => *r,
    }
}
