//! Flight records (様式 1), squawks (記事) and maintenance records (様式 3).
//! Drafts are edited in place; a confirmed flight is corrected by a superseding row.

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::Response;
use axum::Json;
use rgcs_core::jst;
use rgcs_core::{Flight, FlightInput, FlightPatch, FlightSquawkInput, MaintenanceInput, SysId};
use rgcs_store::StoreError;
use serde_json::json;

use crate::api::{err, ok};
use crate::app::AppState;
use crate::auth::AuthUser;
use crate::logbook_api::{audit, check_dates, created, internal, validation, RangeQuery};

const MAX_LONG: usize = 2000;
const MAX_SHORT: usize = 500;
const MAX_NAME: usize = 60;
const MAX_LIST: usize = 20;

fn invalid(msg: impl Into<String>) -> Box<Response> {
    Box::new(validation(msg))
}

fn limit(field: &str, value: &str, max: usize) -> Result<(), Box<Response>> {
    if value.chars().count() > max {
        return Err(invalid(format!("{field} exceeds {max} characters")));
    }
    Ok(())
}

fn limit_list(field: &str, values: &[String]) -> Result<(), Box<Response>> {
    if values.len() > MAX_LIST {
        return Err(invalid(format!("{field} has more than {MAX_LIST} entries")));
    }
    for v in values {
        limit(field, v, MAX_NAME)?;
    }
    Ok(())
}

fn validate_input(i: &FlightInput) -> Result<(), Box<Response>> {
    validate_patch(&FlightPatch {
        pilot: Some(i.pilot.clone()),
        pilot_license: Some(i.pilot_license.clone()),
        takeoff_at: Some(i.takeoff_at),
        landed_at: Some(i.landed_at),
        takeoff_place: Some(i.takeoff_place.clone()),
        landing_place: Some(i.landing_place.clone()),
        purposes: Some(i.purposes.clone()),
        specific_flight: Some(i.specific_flight.clone()),
        summary: Some(i.summary.clone()),
        safety_notes: Some(i.safety_notes.clone()),
        status: None,
    })
}

fn validate_patch(p: &FlightPatch) -> Result<(), Box<Response>> {
    if let (Some(t), Some(l)) = (p.takeoff_at, p.landed_at) {
        if l < t {
            return Err(invalid("landed_at is before takeoff_at"));
        }
    }
    for (field, value) in [("pilot", &p.pilot), ("pilot_license", &p.pilot_license)] {
        if let Some(v) = value {
            limit(field, v, MAX_NAME)?;
        }
    }
    for (field, value) in [
        ("takeoff_place", &p.takeoff_place),
        ("landing_place", &p.landing_place),
        ("summary", &p.summary),
        ("safety_notes", &p.safety_notes),
    ] {
        if let Some(v) = value {
            limit(field, v, MAX_LONG)?;
        }
    }
    for (field, value) in [("purposes", &p.purposes), ("specific_flight", &p.specific_flight)] {
        if let Some(v) = value {
            limit_list(field, v)?;
        }
    }
    Ok(())
}

fn not_found(what: &str) -> Response {
    err(StatusCode::NOT_FOUND, "not_found", format!("{what} is unknown"))
}

/// The flight when it exists, belongs to `sysid` and has not been corrected by a newer row.
async fn own_flight(app: &AppState, sysid: SysId, id: i64) -> Result<Flight, Box<Response>> {
    let flight = match app.store.flight(id).await {
        Ok(Some(f)) if f.sysid == sysid => f,
        Ok(_) => return Err(Box::new(not_found("flight"))),
        Err(e) => return Err(Box::new(internal(e))),
    };
    match app.store.flight_superseded_by(id).await {
        Ok(None) => Ok(flight),
        Ok(Some(newer)) => Err(Box::new(err(
            StatusCode::CONFLICT,
            "superseded",
            format!("flight {id} was corrected by flight {newer}; edit that one"),
        ))),
        Err(e) => Err(Box::new(internal(e))),
    }
}

/// `supersedes` must name a live maintenance record of this vehicle.
async fn check_maintenance_supersedes(
    app: &AppState,
    sysid: SysId,
    prev: Option<i64>,
) -> Result<(), Box<Response>> {
    let Some(prev) = prev else { return Ok(()) };
    match app.store.maintenance(prev).await {
        Ok(Some(r)) if r.sysid == sysid => {}
        Ok(_) => return Err(invalid("supersedes is not a record of this vehicle")),
        Err(e) => return Err(Box::new(internal(e))),
    }
    match app.store.maintenance_is_superseded(prev).await {
        Ok(false) => Ok(()),
        Ok(true) => Err(invalid("supersedes names a record that was already corrected")),
        Err(e) => Err(Box::new(internal(e))),
    }
}

/// `GET /api/vehicles/{sysid}/flights?from=&to=`
pub async fn list_flights(
    State(app): State<AppState>,
    AuthUser(_op): AuthUser,
    Path(sysid): Path<SysId>,
    Query(q): Query<RangeQuery>,
) -> Response {
    if let Err(r) = check_dates(&q.from, &q.to) {
        return *r;
    }
    match app
        .store
        .list_flights(sysid, q.from.as_deref(), q.to.as_deref())
        .await
    {
        Ok(f) => ok(f),
        Err(e) => internal(e),
    }
}

/// `POST /api/vehicles/{sysid}/flights` → 201 (draft)
pub async fn create_flight(
    State(app): State<AppState>,
    AuthUser(op): AuthUser,
    Path(sysid): Path<SysId>,
    Json(input): Json<FlightInput>,
) -> Response {
    if let Err(r) = validate_input(&input) {
        return *r;
    }
    match app.store.create_flight(sysid, &input, &op.username).await {
        Ok(f) => {
            audit(
                &app,
                &op.username,
                Some(sysid),
                "logbook",
                "flight_create",
                json!({ "id": f.id }),
            )
            .await;
            created(f)
        }
        Err(StoreError::Invalid(m)) => validation(m),
        Err(e) => internal(e),
    }
}

/// `PATCH /api/vehicles/{sysid}/flights/{id}` — the superseding row when the flight was confirmed.
pub async fn patch_flight(
    State(app): State<AppState>,
    AuthUser(op): AuthUser,
    Path((sysid, id)): Path<(SysId, i64)>,
    Json(patch): Json<FlightPatch>,
) -> Response {
    if let Err(r) = validate_patch(&patch) {
        return *r;
    }
    if let Err(r) = own_flight(&app, sysid, id).await {
        return *r;
    }
    match app.store.patch_flight(id, &patch, &op.username).await {
        Ok(Some(f)) => {
            audit(
                &app,
                &op.username,
                Some(sysid),
                "logbook",
                "flight_patch",
                json!({ "id": f.id, "supersedes": f.supersedes }),
            )
            .await;
            ok(f)
        }
        Ok(None) => not_found("flight"),
        Err(StoreError::Invalid(m)) => validation(m),
        Err(e) => internal(e),
    }
}

/// `DELETE /api/vehicles/{sysid}/flights/{id}` — drafts only.
pub async fn delete_flight(
    State(app): State<AppState>,
    AuthUser(op): AuthUser,
    Path((sysid, id)): Path<(SysId, i64)>,
) -> Response {
    if let Err(r) = own_flight(&app, sysid, id).await {
        return *r;
    }
    match app.store.delete_draft(id).await {
        Ok(true) => {
            audit(
                &app,
                &op.username,
                Some(sysid),
                "logbook",
                "flight_delete",
                json!({ "id": id }),
            )
            .await;
            ok(json!({ "deleted": true }))
        }
        Ok(false) => err(StatusCode::CONFLICT, "confirmed", "only drafts can be deleted"),
        Err(e) => internal(e),
    }
}

fn validate_squawk(s: &FlightSquawkInput) -> Result<(), Box<Response>> {
    if !jst::is_date(&s.occurred_on) {
        return Err(invalid("occurred_on must be YYYY-MM-DD"));
    }
    if !s.action_on.is_empty() && !jst::is_date(&s.action_on) {
        return Err(invalid("action_on must be YYYY-MM-DD or empty"));
    }
    let n = s.description.chars().count();
    if n == 0 || n > MAX_LONG {
        return Err(invalid(format!("description must be 1..{MAX_LONG} characters")));
    }
    limit("action", &s.action, MAX_LONG)?;
    limit("confirmer", &s.confirmer, MAX_NAME)
}

/// `POST /api/vehicles/{sysid}/flights/{id}/squawks` → 201
pub async fn add_squawk(
    State(app): State<AppState>,
    AuthUser(op): AuthUser,
    Path((sysid, id)): Path<(SysId, i64)>,
    Json(input): Json<FlightSquawkInput>,
) -> Response {
    if let Err(r) = validate_squawk(&input) {
        return *r;
    }
    if let Err(r) = own_flight(&app, sysid, id).await {
        return *r;
    }
    match app.store.add_squawk(id, &input, &op.username).await {
        Ok(Some(s)) => {
            audit(
                &app,
                &op.username,
                Some(sysid),
                "logbook",
                "squawk_add",
                json!({ "id": s.id, "flight_id": id }),
            )
            .await;
            created(s)
        }
        Ok(None) => not_found("flight"),
        Err(e) => internal(e),
    }
}

fn validate_maintenance(m: &MaintenanceInput) -> Result<(), Box<Response>> {
    if !jst::is_date(&m.performed_on) {
        return Err(invalid("performed_on must be YYYY-MM-DD"));
    }
    let n = m.detail.chars().count();
    if n == 0 || n > MAX_LONG {
        return Err(invalid(format!("detail must be 1..{MAX_LONG} characters")));
    }
    for (field, value) in [
        ("reason", &m.reason),
        ("place", &m.place),
        ("engineer", &m.engineer),
        ("notes", &m.notes),
    ] {
        limit(field, value, MAX_SHORT)?;
    }
    Ok(())
}

/// `GET /api/vehicles/{sysid}/maintenance?from=&to=`
pub async fn list_maintenance(
    State(app): State<AppState>,
    AuthUser(_op): AuthUser,
    Path(sysid): Path<SysId>,
    Query(q): Query<RangeQuery>,
) -> Response {
    if let Err(r) = check_dates(&q.from, &q.to) {
        return *r;
    }
    match app
        .store
        .list_maintenance(sysid, q.from.as_deref(), q.to.as_deref())
        .await
    {
        Ok(rows) => ok(rows),
        Err(e) => internal(e),
    }
}

/// `POST /api/vehicles/{sysid}/maintenance` → 201
pub async fn create_maintenance(
    State(app): State<AppState>,
    AuthUser(op): AuthUser,
    Path(sysid): Path<SysId>,
    Json(input): Json<MaintenanceInput>,
) -> Response {
    if let Err(r) = validate_maintenance(&input) {
        return *r;
    }
    if let Err(r) = check_maintenance_supersedes(&app, sysid, input.supersedes).await {
        return *r;
    }
    match app.store.create_maintenance(sysid, &input, &op.username).await {
        Ok(m) => {
            audit(
                &app,
                &op.username,
                Some(sysid),
                "logbook",
                "maintenance_add",
                json!({ "id": m.id }),
            )
            .await;
            created(m)
        }
        Err(StoreError::Invalid(m)) => validation(m),
        Err(e) => internal(e),
    }
}
