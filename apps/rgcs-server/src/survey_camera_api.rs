//! Survey camera endpoints: the shared camera list for survey planning.

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use rgcs_core::{validate_survey_camera, SurveyCamera};
use rgcs_store::audit::AuditInput;
use rgcs_store::survey_cameras::CameraChange;
use rgcs_store::StoreError;
use serde_json::json;

use crate::api::{err, ok};
use crate::app::AppState;
use crate::auth::AuthUser;

fn store_error(e: StoreError) -> Response {
    match e {
        StoreError::Invalid(msg) => err(StatusCode::BAD_REQUEST, "invalid", msg),
        other => err(StatusCode::INTERNAL_SERVER_ERROR, "store", other.to_string()),
    }
}

fn not_found(id: i64) -> Response {
    err(
        StatusCode::NOT_FOUND,
        "not_found",
        format!("survey camera {id} does not exist"),
    )
}

fn builtin(id: i64) -> Response {
    err(
        StatusCode::CONFLICT,
        "builtin",
        format!("survey camera {id} is built in and cannot be changed"),
    )
}

async fn audit(app: &AppState, op: &str, action: &str, id: Option<i64>, c: Option<&SurveyCamera>) {
    let args = json!({ "id": id, "name": c.map(|c| c.name.as_str()) });
    let entry = AuditInput {
        operator: op,
        sysid: None,
        target: "survey_camera",
        command: action,
        args: Some(args.to_string()),
        result: "ok",
        reason: None,
    };
    if let Err(e) = app.store.record_audit(entry).await {
        tracing::error!(error = %e, "audit write failed");
    }
}

/// `GET /api/survey-cameras` (built-ins first, then by name)
pub async fn list_survey_cameras(State(app): State<AppState>, AuthUser(_op): AuthUser) -> Response {
    match app.store.list_survey_cameras().await {
        Ok(rows) => ok(rows),
        Err(e) => store_error(e),
    }
}

/// `POST /api/survey-cameras` → 201 with the created camera.
pub async fn create_survey_camera(
    State(app): State<AppState>,
    AuthUser(op): AuthUser,
    Json(camera): Json<SurveyCamera>,
) -> Response {
    if let Err(msg) = validate_survey_camera(&camera) {
        return err(StatusCode::BAD_REQUEST, "invalid", msg);
    }
    match app.store.create_survey_camera(&camera).await {
        Ok(saved) => {
            audit(&app, &op.username, "create", saved.id, Some(&saved)).await;
            (
                StatusCode::CREATED,
                Json(json!({ "success": true, "data": saved })),
            )
                .into_response()
        }
        Err(e) => store_error(e),
    }
}

/// `PUT /api/survey-cameras/{id}`
pub async fn update_survey_camera(
    State(app): State<AppState>,
    AuthUser(op): AuthUser,
    Path(id): Path<i64>,
    Json(camera): Json<SurveyCamera>,
) -> Response {
    if let Err(msg) = validate_survey_camera(&camera) {
        return err(StatusCode::BAD_REQUEST, "invalid", msg);
    }
    match app.store.update_survey_camera(id, &camera).await {
        Ok(CameraChange::Done(saved)) => {
            audit(&app, &op.username, "update", Some(id), Some(&saved)).await;
            ok(saved)
        }
        Ok(CameraChange::Builtin) => builtin(id),
        Ok(CameraChange::NotFound) => not_found(id),
        Err(e) => store_error(e),
    }
}

/// `DELETE /api/survey-cameras/{id}` → `{deleted: true}`.
pub async fn delete_survey_camera(
    State(app): State<AppState>,
    AuthUser(op): AuthUser,
    Path(id): Path<i64>,
) -> Response {
    match app.store.delete_survey_camera(id).await {
        Ok(CameraChange::Done(())) => {
            audit(&app, &op.username, "delete", Some(id), None).await;
            ok(json!({ "deleted": true }))
        }
        Ok(CameraChange::Builtin) => builtin(id),
        Ok(CameraChange::NotFound) => not_found(id),
        Err(e) => store_error(e),
    }
}
