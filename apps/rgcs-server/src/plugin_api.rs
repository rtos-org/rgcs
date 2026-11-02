//! `/api/plugins`: the plugins found at start and the admin's on/off switch.

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::Response;
use axum::Json;
use serde::Deserialize;

use crate::api::{err, ok};
use crate::app::AppState;
use crate::auth::{AdminUser, AuthUser};

#[derive(Debug, Deserialize)]
pub struct EnabledBody {
    pub enabled: bool,
}

pub async fn list(State(app): State<AppState>, _user: AuthUser) -> Response {
    ok(app.plugins.infos())
}

/// Stores the choice first, so a store failure leaves the running state unchanged.
pub async fn set_enabled(
    State(app): State<AppState>,
    _admin: AdminUser,
    Path(id): Path<String>,
    Json(body): Json<EnabledBody>,
) -> Response {
    if !app.plugins.infos().iter().any(|p| p.id == id) {
        return err(StatusCode::NOT_FOUND, "not_found", format!("no plugin {id}"));
    }
    if let Err(e) = app.store.set_plugin_enabled(&id, body.enabled).await {
        return err(StatusCode::INTERNAL_SERVER_ERROR, "store", e.to_string());
    }
    match app.plugins.set_enabled(&id, body.enabled) {
        Some(info) => ok(info),
        None => err(StatusCode::NOT_FOUND, "not_found", format!("no plugin {id}")),
    }
}
