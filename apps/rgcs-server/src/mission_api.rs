//! Mission endpoints: vehicle upload / download / progress.

use axum::extract::{Path, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use rgcs_core::{FenceInfo, Finding, LinkStatus, Mission, ServerMessage, SysId, UploadReport, VehicleState};
use rgcs_mavlink::{encode_param_request_read, Outgoing};
use rgcs_store::audit::AuditInput;
use serde::Deserialize;
use serde_json::json;

use crate::api::{err, ok};
use crate::app::{unix_ms, AppState};
use crate::assignment_api::broadcast_assignments;
use crate::auth::AuthUser;
use crate::missions::MissionError;

use crate::telemetry::FENCE_PARAMS;

/// How long an upload waits for fence parameters that were requested but not answered yet.
const FENCE_WAIT: std::time::Duration = std::time::Duration::from_millis(200);
const FENCE_WAIT_ROUNDS: u32 = 5;
/// The longest an upload waits for unanswered fence parameters before it starts.
pub const FENCE_WAIT_MAX: std::time::Duration = FENCE_WAIT.saturating_mul(FENCE_WAIT_ROUNDS);

#[derive(Debug, Deserialize)]
pub struct UploadSavedBody {
    pub mission_id: i64,
}

/// `409 mission_invalid` carries the findings so the UI can show them.
fn invalid_response(findings: &[Finding]) -> Response {
    (
        StatusCode::CONFLICT,
        Json(json!({
            "success": false,
            "error": { "code": "mission_invalid", "message": "the mission has fatal findings" },
            "data": { "findings": findings },
        })),
    )
        .into_response()
}

/// Fence parameters as cached from PARAM_VALUE frames (no I/O).
pub fn fence_from_cache(app: &AppState, sysid: SysId) -> FenceInfo {
    let get = |name: &str| app.params.get(sysid, name);
    FenceInfo {
        enabled: get("FENCE_ENABLE").map(|v| v >= 1.0),
        alt_max: get("FENCE_ALT_MAX"),
        radius: get("FENCE_RADIUS"),
    }
}

/// Asks the vehicle for the fence parameters we do not have yet (answers land in the cache).
pub fn request_missing_fence_params(app: &AppState, sysid: SysId, info: &FenceInfo) {
    if info.enabled.is_some() && info.alt_max.is_some() && info.radius.is_some() {
        return;
    }
    for name in FENCE_PARAMS {
        let _ = app.outgoing.try_send(Outgoing {
            message: encode_param_request_read(sysid, name),
        });
    }
}

/// Asks for the fence parameters once and gives the vehicle up to ~1 s to answer (they are
/// normally cached since discovery; this covers an upload right after the link came up).
pub async fn await_fence(app: &AppState, sysid: SysId) -> FenceInfo {
    let known = |f: &FenceInfo| f.enabled.is_some() && f.alt_max.is_some() && f.radius.is_some();
    let mut fence = fence_from_cache(app, sysid);
    if known(&fence) {
        return fence;
    }
    request_missing_fence_params(app, sysid, &fence);
    for _ in 0..FENCE_WAIT_ROUNDS {
        tokio::time::sleep(FENCE_WAIT).await;
        fence = fence_from_cache(app, sysid);
        if known(&fence) {
            break;
        }
    }
    fence
}

/// `GET /api/vehicles/{sysid}/mission/known` — the mission the server last wrote to / read from the vehicle.
pub async fn get_known(
    State(app): State<AppState>,
    AuthUser(_op): AuthUser,
    Path(sysid): Path<SysId>,
) -> Response {
    ok(app.missions.known(sysid))
}

pub(crate) async fn vehicle_for_write(app: &AppState, sysid: SysId) -> Result<VehicleState, Box<Response>> {
    let Some(vehicle) = app.router.lock().await.state(sysid).cloned() else {
        return Err(Box::new(err(
            StatusCode::NOT_FOUND,
            "not_found",
            format!("vehicle {sysid} is not connected"),
        )));
    };
    if vehicle.link == LinkStatus::Lost {
        return Err(Box::new(err(
            StatusCode::SERVICE_UNAVAILABLE,
            "link_lost",
            "no heartbeat for 10 s",
        )));
    }
    Ok(vehicle)
}

pub(crate) fn mission_error(e: MissionError) -> Response {
    match e {
        MissionError::Busy => err(StatusCode::CONFLICT, "mission_busy", e.to_string()),
        MissionError::Timeout => err(StatusCode::GATEWAY_TIMEOUT, "mission_timeout", e.to_string()),
        MissionError::Rejected(_) => err(StatusCode::CONFLICT, "mission_rejected", e.to_string()),
        MissionError::LinkClosed => err(StatusCode::SERVICE_UNAVAILABLE, "link_lost", e.to_string()),
        MissionError::Invalid(_) => err(StatusCode::BAD_REQUEST, "invalid", e.to_string()),
    }
}

async fn component_of(app: &AppState, sysid: SysId) -> u8 {
    app.router.lock().await.fc_component(sysid).unwrap_or(1)
}

/// Validates, writes and reads back. `Ok` carries the report (verified or a mismatch); `Err` is
/// the error response (refused, rejected, timed out, link lost).
async fn do_upload(
    app: &AppState,
    op: &str,
    sysid: SysId,
    mission: &Mission,
) -> Result<UploadReport, Box<Response>> {
    let sent = mission.for_vehicle();
    let mission = &sent;
    // ArduPilot accepts a mission while armed (a flying vehicle picks up the new one); only the
    // link and the transfer lock gate a write.
    let kind = match vehicle_for_write(app, sysid).await {
        Ok(v) => Some(v.kind),
        Err(r) => return Err(r),
    };
    // Structural problems are refused before anything goes to the link (Review Focus 4); the
    // fence check then waits briefly for parameters that may still be in flight.
    let pre = mission.validate_for(&fence_from_cache(app, sysid), kind);
    if Mission::has_fatal(&pre) {
        audit(
            app,
            op,
            sysid,
            "upload",
            mission,
            "rejected",
            Some("mission_invalid"),
        )
        .await;
        return Err(Box::new(invalid_response(&pre)));
    }
    let fence = await_fence(app, sysid).await;
    let findings = mission.validate_for(&fence, kind);
    if Mission::has_fatal(&findings) {
        audit(
            app,
            op,
            sysid,
            "upload",
            mission,
            "rejected",
            Some("mission_invalid"),
        )
        .await;
        return Err(Box::new(invalid_response(&findings)));
    }
    request_missing_fence_params(app, sysid, &fence);
    let component = component_of(app, sysid).await;
    match app
        .missions
        .upload(sysid, component, mission, kind, &app.outgoing)
        .await
    {
        Ok(report) => {
            let result = if report.verified { "ok" } else { "mismatch" };
            audit(app, op, sysid, "upload", mission, result, None).await;
            let _ = app
                .tx
                .send(ServerMessage::CommandResult(rgcs_core::CommandResult {
                    id: app.next_command_id(),
                    sysid,
                    cmd: "mission_upload".into(),
                    ok: report.verified,
                    reason: (!report.verified).then(|| format!("mismatch at {:?}", report.mismatched)),
                    ts: unix_ms(),
                    mav_cmd: None,
                }));
            Ok(UploadReport { findings, ..report })
        }
        Err(e) => {
            audit(app, op, sysid, "upload", mission, "error", Some(&e.to_string())).await;
            Err(Box::new(mission_error(e)))
        }
    }
}

/// `PUT /api/vehicles/{sysid}/mission` — write the body, read back, compare.
pub async fn put_mission(
    State(app): State<AppState>,
    AuthUser(op): AuthUser,
    Path(sysid): Path<SysId>,
    Json(mission): Json<Mission>,
) -> Response {
    match do_upload(&app, &op.username, sysid, &mission).await {
        Ok(report) => {
            // other content (or, on a read-back mismatch, unknown content) now sits on the
            // vehicle: no saved plan version describes it
            clear_written(&app, sysid).await;
            ok(report)
        }
        Err(r) => *r,
    }
}

/// `POST /api/vehicles/{sysid}/mission/upload {mission_id}` — write a saved mission.
pub async fn upload_saved(
    State(app): State<AppState>,
    AuthUser(op): AuthUser,
    Path(sysid): Path<SysId>,
    Json(body): Json<UploadSavedBody>,
) -> Response {
    match app.store.get_mission_versioned(body.mission_id).await {
        Ok(Some((mission, version))) => match do_upload(&app, &op.username, sysid, &mission).await {
            Ok(report) => {
                if report.verified {
                    record_written(&app, sysid, body.mission_id, version, &op.username).await;
                } else {
                    // the transfer ran but the read-back differs: what the vehicle holds is unknown
                    clear_written(&app, sysid).await;
                }
                ok(report)
            }
            Err(r) => *r,
        },
        Ok(None) => err(
            StatusCode::NOT_FOUND,
            "not_found",
            format!("mission {} does not exist", body.mission_id),
        ),
        Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, "store", e.to_string()),
    }
}

/// Forgets the written plan of a vehicle whose mission changed outside a verified saved-plan
/// write, then broadcasts the board.
async fn clear_written(app: &AppState, sysid: SysId) {
    if let Err(e) = app.store.clear_written(sysid).await {
        tracing::error!(error = %e, "clearing the written plan failed");
    }
    broadcast_assignments(app).await;
}

/// Remembers which saved plan version a verified upload wrote, then broadcasts the board.
async fn record_written(app: &AppState, sysid: SysId, plan_id: i64, version: u64, op: &str) {
    if let Err(e) = app.store.record_written(sysid, plan_id, version, op).await {
        tracing::error!(error = %e, "recording the written plan failed");
    }
    broadcast_assignments(app).await;
}

/// `GET /api/vehicles/{sysid}/mission` — read the vehicle's mission.
pub async fn get_mission(
    State(app): State<AppState>,
    AuthUser(op): AuthUser,
    Path(sysid): Path<SysId>,
) -> Response {
    if let Err(r) = vehicle_for_write(&app, sysid).await {
        return *r;
    }
    let component = component_of(&app, sysid).await;
    match app.missions.download(sysid, component, &app.outgoing).await {
        Ok(mission) => {
            audit(&app, &op.username, sysid, "download", &mission, "ok", None).await;
            ok(mission)
        }
        Err(e) => {
            audit_plain(
                &app,
                &op.username,
                sysid,
                "download",
                "error",
                Some(&e.to_string()),
            )
            .await;
            mission_error(e)
        }
    }
}

/// `GET /api/vehicles/{sysid}/mission/progress` — last `MISSION_CURRENT`, or null.
pub async fn get_progress(
    State(app): State<AppState>,
    AuthUser(_op): AuthUser,
    Path(sysid): Path<SysId>,
) -> Response {
    ok(app.missions.progress(sysid))
}

async fn audit(
    app: &AppState,
    op: &str,
    sysid: SysId,
    action: &str,
    mission: &Mission,
    result: &str,
    reason: Option<&str>,
) {
    let args = json!({ "name": mission.name, "id": mission.id, "items": mission.items.len() });
    let entry = AuditInput {
        operator: op,
        sysid: Some(sysid),
        target: "mission",
        command: action,
        args: Some(args.to_string()),
        result,
        reason: reason.map(str::to_string),
    };
    if let Err(e) = app.store.record_audit(entry).await {
        tracing::error!(error = %e, "audit write failed");
    }
}

async fn audit_plain(
    app: &AppState,
    op: &str,
    sysid: SysId,
    action: &str,
    result: &str,
    reason: Option<&str>,
) {
    let entry = AuditInput {
        operator: op,
        sysid: Some(sysid),
        target: "mission",
        command: action,
        args: None,
        result,
        reason: reason.map(str::to_string),
    };
    if let Err(e) = app.store.record_audit(entry).await {
        tracing::error!(error = %e, "audit write failed");
    }
}

// ---- saved missions, files, validation -------------------------------------------------------

pub const MAX_NAME_CHARS: usize = 64;
/// ArduPilot's practical mission size.
pub const MAX_ITEMS: usize = 700;
pub const MAX_IMPORT_BYTES: usize = 1024 * 1024;

#[derive(Debug, Deserialize)]
pub struct ExportQuery {
    pub format: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct ValidateQuery {
    pub sysid: Option<SysId>,
}

#[derive(serde::Serialize)]
pub struct ValidateReply {
    pub findings: Vec<Finding>,
    pub stats: rgcs_core::MissionStats,
}

/// Name 1..=64 chars (trimmed), at most 700 items. `Err(field)` names the offending field.
pub fn check_mission(m: &Mission) -> Result<Mission, &'static str> {
    let name = m.name.trim();
    if name.is_empty() || name.chars().count() > MAX_NAME_CHARS {
        return Err("name");
    }
    if m.items.len() > MAX_ITEMS {
        return Err("items");
    }
    Ok(Mission {
        name: name.to_string(),
        ..m.clone()
    })
}

fn validation_error(field: &str) -> Response {
    err(
        StatusCode::BAD_REQUEST,
        "validation",
        format!("{field} is out of range"),
    )
}

fn store_error(e: rgcs_store::StoreError) -> Response {
    err(StatusCode::INTERNAL_SERVER_ERROR, "store", e.to_string())
}

/// `GET /api/missions`
pub async fn list_missions(State(app): State<AppState>, AuthUser(_op): AuthUser) -> Response {
    match app.store.list_missions().await {
        Ok(rows) => ok(rows),
        Err(e) => store_error(e),
    }
}

/// `POST /api/missions` → 201 with the new id.
pub async fn create_mission(
    State(app): State<AppState>,
    AuthUser(op): AuthUser,
    Json(mission): Json<Mission>,
) -> Response {
    let mission = match check_mission(&mission) {
        Ok(m) => m,
        Err(field) => return validation_error(field),
    };
    match app.store.create_mission(&mission, &op.username).await {
        Ok(saved) => (
            StatusCode::CREATED,
            Json(json!({ "success": true, "data": saved })),
        )
            .into_response(),
        Err(e) => store_error(e),
    }
}

fn not_found(id: i64) -> Response {
    err(
        StatusCode::NOT_FOUND,
        "not_found",
        format!("mission {id} does not exist"),
    )
}

/// `GET /api/missions/{id}`
pub async fn get_saved_mission(
    State(app): State<AppState>,
    AuthUser(_op): AuthUser,
    Path(id): Path<i64>,
) -> Response {
    match app.store.get_mission(id).await {
        Ok(Some(m)) => ok(m),
        Ok(None) => not_found(id),
        Err(e) => store_error(e),
    }
}

/// `PUT /api/missions/{id}`
pub async fn update_mission(
    State(app): State<AppState>,
    AuthUser(_op): AuthUser,
    Path(id): Path<i64>,
    Json(mission): Json<Mission>,
) -> Response {
    let mission = match check_mission(&mission) {
        Ok(m) => m,
        Err(field) => return validation_error(field),
    };
    match app.store.update_mission(id, &mission).await {
        Ok(Some(m)) => ok(m),
        Ok(None) => not_found(id),
        Err(e) => store_error(e),
    }
}

/// `DELETE /api/missions/{id}` → 204.
pub async fn delete_mission(
    State(app): State<AppState>,
    AuthUser(_op): AuthUser,
    Path(id): Path<i64>,
) -> Response {
    match app.store.delete_mission(id).await {
        Ok(true) => {
            // `plan_assignments.plan_id` is `ON DELETE SET NULL`: the board changed too
            broadcast_assignments(&app).await;
            StatusCode::NO_CONTENT.into_response()
        }
        Ok(false) => not_found(id),
        Err(e) => store_error(e),
    }
}

/// `[A-Za-z0-9_-]` only; empty → "mission".
pub fn file_stem(name: &str) -> String {
    let stem: String = name
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
        .collect();
    if stem.is_empty() {
        "mission".into()
    } else {
        stem
    }
}

/// `GET /api/missions/{id}/export?format=waypoints` → the QGC WPL 110 text as an attachment.
pub async fn export_mission(
    State(app): State<AppState>,
    AuthUser(_op): AuthUser,
    Path(id): Path<i64>,
    axum::extract::Query(q): axum::extract::Query<ExportQuery>,
) -> Response {
    if q.format.as_deref().is_some_and(|f| f != "waypoints") {
        return err(StatusCode::BAD_REQUEST, "invalid", "format must be waypoints");
    }
    let mission = match app.store.get_mission(id).await {
        Ok(Some(m)) => m,
        Ok(None) => return not_found(id),
        Err(e) => return store_error(e),
    };
    let disposition = format!("attachment; filename=\"{}.waypoints\"", file_stem(&mission.name));
    (
        StatusCode::OK,
        [
            (header::CONTENT_TYPE, "text/plain; charset=utf-8".to_string()),
            (header::CONTENT_DISPOSITION, disposition),
            (header::CACHE_CONTROL, "no-store".to_string()),
        ],
        rgcs_mission::to_wpl(&mission),
    )
        .into_response()
}

/// `POST /api/missions/import` (text body) → an unsaved `Mission`.
pub async fn import_mission(
    State(_app): State<AppState>,
    AuthUser(_op): AuthUser,
    headers: HeaderMap,
    body: String,
) -> Response {
    let name = headers
        .get("x-mission-name")
        .and_then(|v| v.to_str().ok())
        .map(str::trim)
        .filter(|n| !n.is_empty())
        .unwrap_or("imported");
    match rgcs_mission::from_wpl(&body) {
        Ok(m) => ok(Mission {
            name: name.chars().take(MAX_NAME_CHARS).collect(),
            ..m
        }),
        Err(e) => err(StatusCode::BAD_REQUEST, "invalid_waypoints", e.to_string()),
    }
}

/// `POST /api/missions/validate?sysid=` → findings + stats (fence from the vehicle's params when given).
pub async fn validate_mission(
    State(app): State<AppState>,
    AuthUser(_op): AuthUser,
    axum::extract::Query(q): axum::extract::Query<ValidateQuery>,
    Json(mission): Json<Mission>,
) -> Response {
    let (fence, kind) = match q.sysid {
        Some(sysid) => {
            let f = fence_from_cache(&app, sysid);
            request_missing_fence_params(&app, sysid, &f);
            let kind = app.router.lock().await.state(sysid).map(|v| v.kind);
            (f, kind)
        }
        None => (FenceInfo::default(), None),
    };
    ok(ValidateReply {
        findings: mission.validate_for(&fence, kind),
        stats: mission.stats(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_stem_keeps_only_safe_characters() {
        assert_eq!(file_stem("demo20"), "demo20");
        assert_eq!(file_stem("前日 ミッション/1"), "1");
        assert_eq!(file_stem("///"), "mission");
    }
}
