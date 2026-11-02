//! `GET/PUT /api/settings/input/gimbal`: the browser-side joystick profile.

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::Response;
use axum::Json;
use rgcs_core::GimbalInputProfile;
use rgcs_store::audit::AuditInput;

use crate::api::{err, ok};
use crate::app::AppState;
use crate::auth::AuthUser;

pub async fn get_gimbal(State(app): State<AppState>, AuthUser(_op): AuthUser) -> Response {
    match app.store.gimbal_input_profile().await {
        Ok(p) => ok(p),
        Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, "internal", e.to_string()),
    }
}

pub async fn put_gimbal(
    State(app): State<AppState>,
    AuthUser(op): AuthUser,
    Json(profile): Json<GimbalInputProfile>,
) -> Response {
    if let Err(e) = profile.validate() {
        return err(StatusCode::BAD_REQUEST, "validation", e.to_string());
    }
    if let Err(e) = app.store.put_gimbal_input_profile(&profile).await {
        return err(StatusCode::INTERNAL_SERVER_ERROR, "internal", e.to_string());
    }
    let entry = AuditInput {
        operator: &op.username,
        sysid: None,
        target: "settings",
        command: "input_profile",
        args: serde_json::to_string(&profile).ok(),
        result: "ok",
        reason: None,
    };
    if let Err(e) = app.store.record_audit(entry).await {
        tracing::error!(error = %e, "audit write failed");
    }
    ok(profile)
}
