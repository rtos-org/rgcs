//! Registry, pilot, inspection template and inspection run endpoints.
//! Runs are append-only: a correction is a new run with `supersedes`.

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use rgcs_core::jst;
use rgcs_core::{
    InspectionItem, InspectionRunInput, InspectionTemplateInput, PilotInput, SysId, VehicleRegistryInput,
};
use rgcs_store::audit::AuditInput;
use rgcs_store::StoreError;
use serde::Deserialize;
use serde_json::json;

use crate::api::{err, ok};
use crate::app::AppState;
use crate::auth::{AdminUser, AuthUser};

const MAX_TEXT: usize = 120;
const MAX_MINUTES: u32 = 10_000_000;
const MAX_ITEMS: usize = 50;
const MAX_LIMIT: u32 = 1000;
const DEFAULT_LIMIT: u32 = 100;

#[derive(Deserialize)]
pub struct RangeQuery {
    pub from: Option<String>,
    pub to: Option<String>,
    pub limit: Option<u32>,
}

pub fn validation(msg: impl Into<String>) -> Response {
    err(StatusCode::BAD_REQUEST, "validation", msg)
}

fn invalid(msg: impl Into<String>) -> Box<Response> {
    Box::new(validation(msg))
}

pub fn internal(e: impl std::fmt::Display) -> Response {
    err(StatusCode::INTERNAL_SERVER_ERROR, "internal", e.to_string())
}

pub fn created<T: serde::Serialize>(data: T) -> Response {
    (
        StatusCode::CREATED,
        Json(json!({ "success": true, "data": data })),
    )
        .into_response()
}

/// Dates in a query string: `None` passes through, anything else must be `YYYY-MM-DD`.
pub fn check_dates(from: &Option<String>, to: &Option<String>) -> Result<(), Box<Response>> {
    for d in [from, to].into_iter().flatten() {
        if !jst::is_date(d) {
            return Err(invalid(format!("{d:?} is not a date (YYYY-MM-DD)")));
        }
    }
    Ok(())
}

fn too_long(field: &str, value: &str, max: usize) -> Result<(), Box<Response>> {
    if value.chars().count() > max {
        return Err(invalid(format!("{field} exceeds {max} characters")));
    }
    Ok(())
}

pub async fn audit(
    app: &AppState,
    op: &str,
    sysid: Option<SysId>,
    target: &str,
    command: &str,
    args: serde_json::Value,
) {
    let entry = AuditInput {
        operator: op,
        sysid,
        target,
        command,
        args: Some(args.to_string()),
        result: "ok",
        reason: None,
    };
    if let Err(e) = app.store.record_audit(entry).await {
        tracing::warn!(error = %e, "audit write failed");
    }
}

async fn live_name(app: &AppState, sysid: SysId) -> (String, String) {
    match app.router.lock().await.state(sysid) {
        Some(v) => (v.name.clone(), format!("{:?}", v.kind).to_lowercase()),
        None => (format!("UAV-{sysid:02}"), "copter".into()),
    }
}

/// `GET /api/vehicles/{sysid}/registry`
pub async fn get_registry(
    State(app): State<AppState>,
    AuthUser(_op): AuthUser,
    Path(sysid): Path<SysId>,
) -> Response {
    let (name, _) = live_name(&app, sysid).await;
    match app.store.registry(sysid, &name).await {
        Ok(r) => ok(r),
        Err(e) => internal(e),
    }
}

async fn validate_registry(app: &AppState, input: &VehicleRegistryInput) -> Result<(), Box<Response>> {
    for (field, value) in [
        ("name", &input.name),
        ("registration", &input.registration),
        ("uas_type", &input.uas_type),
        ("model", &input.model),
        ("type_cert_no", &input.type_cert_no),
        ("airworthiness_class", &input.airworthiness_class),
        ("airworthiness_no", &input.airworthiness_no),
        ("manufacturer", &input.manufacturer),
        ("serial_no", &input.serial_no),
    ] {
        too_long(field, value, MAX_TEXT)?;
    }
    if input.initial_flight_minutes > MAX_MINUTES {
        return Err(invalid("initial_flight_minutes is out of range"));
    }
    if input.endurance_minutes.is_some_and(|m| m > MAX_MINUTES) {
        return Err(invalid("endurance_minutes is out of range"));
    }
    if let Some(id) = input.inspection_template_id {
        match app.store.template(id).await {
            Ok(Some(_)) => {}
            Ok(None) => return Err(invalid(format!("inspection_template_id {id} is unknown"))),
            Err(e) => return Err(Box::new(internal(e))),
        }
    }
    Ok(())
}

/// `PUT /api/vehicles/{sysid}/registry` (admin)
pub async fn put_registry(
    State(app): State<AppState>,
    AdminUser(op): AdminUser,
    Path(sysid): Path<SysId>,
    Json(input): Json<VehicleRegistryInput>,
) -> Response {
    if let Err(r) = validate_registry(&app, &input).await {
        return *r;
    }
    let (_, kind) = live_name(&app, sysid).await;
    match app.store.put_registry(sysid, &input, &kind).await {
        Ok(r) => {
            audit(
                &app,
                &op.username,
                Some(sysid),
                "settings",
                "registry_put",
                json!({ "registration": r.registration }),
            )
            .await;
            ok(r)
        }
        Err(e) => internal(e),
    }
}

/// `GET /api/users/me/pilot`
pub async fn get_my_pilot(State(app): State<AppState>, AuthUser(op): AuthUser) -> Response {
    match app.store.pilot(&op.username).await {
        Ok(Some(p)) => ok(p),
        Ok(None) => err(StatusCode::NOT_FOUND, "not_found", "user vanished"),
        Err(e) => internal(e),
    }
}

/// `PUT /api/users/me/pilot`
pub async fn put_my_pilot(
    State(app): State<AppState>,
    AuthUser(op): AuthUser,
    Json(input): Json<PilotInput>,
) -> Response {
    if let Err(r) = too_long("full_name", &input.full_name, MAX_TEXT)
        .and_then(|_| too_long("license_no", &input.license_no, MAX_TEXT))
    {
        return *r;
    }
    match app.store.put_pilot(&op.username, &input).await {
        Ok(true) => get_my_pilot(State(app), AuthUser(op)).await,
        Ok(false) => err(StatusCode::NOT_FOUND, "not_found", "user vanished"),
        Err(e) => internal(e),
    }
}

fn validate_template(input: &InspectionTemplateInput) -> Result<(), Box<Response>> {
    let name_len = input.name.chars().count();
    if name_len == 0 || name_len > 60 {
        return Err(invalid("name must be 1..60 characters"));
    }
    if input.items.is_empty() || input.items.len() > MAX_ITEMS {
        return Err(invalid(format!("items must have 1..={MAX_ITEMS} entries")));
    }
    for InspectionItem { label, detail } in &input.items {
        let n = label.chars().count();
        if n == 0 || n > 60 {
            return Err(invalid("item label must be 1..60 characters"));
        }
        too_long("item detail", detail, 200)?;
    }
    Ok(())
}

/// `GET /api/inspection/templates`
pub async fn list_templates(State(app): State<AppState>, AuthUser(_op): AuthUser) -> Response {
    match app.store.list_templates().await {
        Ok(t) => ok(t),
        Err(e) => internal(e),
    }
}

/// `POST /api/inspection/templates` (admin) → 201
pub async fn create_template(
    State(app): State<AppState>,
    AdminUser(op): AdminUser,
    Json(input): Json<InspectionTemplateInput>,
) -> Response {
    if let Err(r) = validate_template(&input) {
        return *r;
    }
    match app.store.create_template(&input, &op.username).await {
        Ok(t) => created(t),
        Err(e) => internal(e),
    }
}

/// `PUT /api/inspection/templates/{id}` (admin)
pub async fn update_template(
    State(app): State<AppState>,
    AdminUser(_op): AdminUser,
    Path(id): Path<i64>,
    Json(input): Json<InspectionTemplateInput>,
) -> Response {
    if let Err(r) = validate_template(&input) {
        return *r;
    }
    match app.store.update_template(id, &input).await {
        Ok(Some(t)) => ok(t),
        Ok(None) => err(
            StatusCode::NOT_FOUND,
            "not_found",
            format!("template {id} is unknown"),
        ),
        Err(e) => internal(e),
    }
}

/// `DELETE /api/inspection/templates/{id}` (admin)
pub async fn delete_template(
    State(app): State<AppState>,
    AdminUser(_op): AdminUser,
    Path(id): Path<i64>,
) -> Response {
    match app.store.delete_template(id).await {
        Ok(true) => ok(json!({ "deleted": true })),
        Ok(false) => err(
            StatusCode::NOT_FOUND,
            "not_found",
            format!("template {id} is unknown"),
        ),
        Err(StoreError::Invalid(_)) => err(
            StatusCode::CONFLICT,
            "last_template",
            "the last template cannot be deleted",
        ),
        Err(e) => internal(e),
    }
}

/// `GET /api/vehicles/{sysid}/inspections/template` — the vehicle's effective template.
pub async fn vehicle_template(
    State(app): State<AppState>,
    AuthUser(_op): AuthUser,
    Path(sysid): Path<SysId>,
) -> Response {
    match app.store.template_for_vehicle(sysid).await {
        Ok(t) => ok(t),
        Err(e) => internal(e),
    }
}

/// `GET /api/vehicles/{sysid}/inspections?from=&to=&limit=`
pub async fn list_inspections(
    State(app): State<AppState>,
    AuthUser(_op): AuthUser,
    Path(sysid): Path<SysId>,
    Query(q): Query<RangeQuery>,
) -> Response {
    if let Err(r) = check_dates(&q.from, &q.to) {
        return *r;
    }
    let limit = q.limit.unwrap_or(DEFAULT_LIMIT).clamp(1, MAX_LIMIT);
    match app
        .store
        .list_inspections(sysid, q.from.as_deref(), q.to.as_deref(), limit)
        .await
    {
        Ok(runs) => ok(runs),
        Err(e) => internal(e),
    }
}

fn validate_run(input: &InspectionRunInput) -> Result<(), Box<Response>> {
    if !jst::is_date(&input.performed_on) {
        return Err(invalid("performed_on must be YYYY-MM-DD"));
    }
    too_long("place", &input.place, 200)?;
    let n = input.inspector.chars().count();
    if n == 0 || n > 60 {
        return Err(invalid("inspector must be 1..60 characters"));
    }
    too_long("notes", &input.notes, 2000)?;
    if input.lat.is_some_and(|v| !(-90.0..=90.0).contains(&v))
        || input.lon.is_some_and(|v| !(-180.0..=180.0).contains(&v))
    {
        return Err(invalid("lat/lon out of range"));
    }
    for r in &input.results {
        too_long("remark", &r.remark, 200)?;
    }
    Ok(())
}

/// `POST /api/vehicles/{sysid}/inspections` → 201
pub async fn create_inspection(
    State(app): State<AppState>,
    AuthUser(op): AuthUser,
    Path(sysid): Path<SysId>,
    Json(input): Json<InspectionRunInput>,
) -> Response {
    if let Err(r) = validate_run(&input) {
        return *r;
    }
    let template = match app.store.template(input.template_id).await {
        Ok(Some(t)) => t,
        Ok(None) => return err(StatusCode::NOT_FOUND, "not_found", "template is unknown"),
        Err(e) => return internal(e),
    };
    if input.results.len() != template.items.len() {
        return validation(format!("results must have {} entries", template.items.len()));
    }
    if let Some(prev) = input.supersedes {
        match app.store.inspection(prev).await {
            Ok(Some(r)) if r.sysid == sysid => {}
            Ok(_) => return validation("supersedes is not a run of this vehicle"),
            Err(e) => return internal(e),
        }
        match app.store.inspection_is_superseded(prev).await {
            Ok(false) => {}
            Ok(true) => return validation("supersedes names a run that was already corrected"),
            Err(e) => return internal(e),
        }
    }
    match app
        .store
        .create_inspection(sysid, &input, &template, &op.username)
        .await
    {
        Ok(run) => {
            audit(
                &app,
                &op.username,
                Some(sysid),
                "inspection",
                "inspection_save",
                json!({ "run_id": run.id, "has_ng": run.has_ng }),
            )
            .await;
            created(run)
        }
        Err(StoreError::Invalid(m)) => validation(m),
        Err(e) => internal(e),
    }
}
