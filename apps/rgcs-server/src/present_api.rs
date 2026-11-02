//! Audience page endpoints: `/present/*` guarded by a presentation token
//! (`?t=`), never by a session; plus the admin token management under `/api/settings`.

use axum::body::Bytes;
use axum::extract::{Path, Query, Request, State};
use axum::http::StatusCode;
use axum::middleware::Next;
use axum::response::Response;
use axum::Json;
use rgcs_core::{LinkStatus, SysId};
use rgcs_store::audit::AuditInput;
use serde::{Deserialize, Serialize};

use crate::api::{err, ok};
use crate::app::AppState;
use crate::auth::{AdminUser, AuthUser};
use crate::branding;
use crate::video_api;

#[derive(Deserialize)]
pub struct TokenQuery {
    t: Option<String>,
}

/// Rejects every `/present/*` request whose `t` is missing, unknown or revoked.
pub async fn require_token(
    State(app): State<AppState>,
    Query(q): Query<TokenQuery>,
    req: Request,
    next: Next,
) -> Response {
    let valid = match q.t.as_deref() {
        Some(t) => app.store.presentation_token_valid(t).await.unwrap_or(false),
        None => false,
    };
    if !valid {
        return err(
            StatusCode::UNAUTHORIZED,
            "invalid_token",
            "presentation token is missing, unknown or revoked",
        );
    }
    next.run(req).await
}

#[derive(Serialize)]
pub struct PresentConfig {
    pub sysid: Option<SysId>,
    pub vehicle_name: Option<String>,
    pub logo: bool,
    pub map_tile_url: String,
    pub map_attribution: String,
    pub whep_path: String,
}

#[derive(Serialize)]
pub struct PresentVehicle {
    pub sysid: SysId,
    pub name: String,
    pub lat: f64,
    pub lon: f64,
    pub hdg: Option<f32>,
    pub alt_rel: f32,
    pub mode: String,
    pub armed: bool,
    pub link: LinkStatus,
}

async fn first_vehicle(app: &AppState) -> Option<PresentVehicle> {
    app.router
        .lock()
        .await
        .states()
        .into_iter()
        .next()
        .map(|v| PresentVehicle {
            sysid: v.sysid,
            name: v.name,
            lat: v.lat,
            lon: v.lon,
            hdg: v.hdg,
            alt_rel: v.alt_rel,
            mode: v.mode,
            armed: v.armed,
            link: v.link,
        })
}

pub async fn config(State(app): State<AppState>) -> Response {
    let vehicle = first_vehicle(&app).await;
    ok(PresentConfig {
        sysid: vehicle.as_ref().map(|v| v.sysid),
        vehicle_name: vehicle.map(|v| v.name),
        logo: branding::find_logo(&app.data_dir).is_some(),
        map_tile_url: app.map_tile_url.clone(),
        map_attribution: app.map_attribution.clone(),
        whep_path: rgcs_video::WHEP_PATH.into(),
    })
}

pub async fn vehicle(State(app): State<AppState>) -> Response {
    ok(first_vehicle(&app).await)
}

pub async fn logo(State(app): State<AppState>) -> Response {
    branding::logo_response(&app.data_dir)
}

/// A separate upstream WHEP session per audience page.
pub async fn whep(State(app): State<AppState>, body: Bytes) -> Response {
    video_api::relay(&app, &body).await
}

// ---- admin management -------------------------------------------------------------------

#[derive(Deserialize)]
pub struct CreateBody {
    pub label: String,
}

#[derive(Serialize)]
pub struct Created {
    pub token: String,
    pub url: String,
}

pub async fn list_tokens(State(app): State<AppState>, AuthUser(_op): AuthUser) -> Response {
    match app.store.list_presentation_tokens().await {
        Ok(list) => ok(list),
        Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, "internal", e.to_string()),
    }
}

pub async fn create_token(
    State(app): State<AppState>,
    AdminUser(op): AdminUser,
    Json(body): Json<CreateBody>,
) -> Response {
    let label = body.label.trim();
    if label.is_empty() || label.chars().count() > 64 {
        return err(
            StatusCode::BAD_REQUEST,
            "validation",
            "label must be 1-64 characters",
        );
    }
    match app.store.create_presentation_token(label, &op.username).await {
        Ok(token) => {
            audit(&app, &op.username, "token_create", Some(label.to_string())).await;
            ok(Created {
                url: format!("/present?t={token}"),
                token,
            })
        }
        Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, "internal", e.to_string()),
    }
}

pub async fn revoke_token(
    State(app): State<AppState>,
    AdminUser(op): AdminUser,
    Path(prefix): Path<String>,
) -> Response {
    match app.store.revoke_presentation_token(&prefix).await {
        Ok(true) => {
            audit(&app, &op.username, "token_revoke", Some(prefix)).await;
            ok(())
        }
        Ok(false) => err(
            StatusCode::NOT_FOUND,
            "not_found",
            "no live token with that prefix",
        ),
        Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, "internal", e.to_string()),
    }
}

async fn audit(app: &AppState, operator: &str, command: &str, args: Option<String>) {
    let entry = AuditInput {
        operator,
        sysid: None,
        target: "presentation",
        command,
        args,
        result: "ok",
        reason: None,
    };
    if let Err(e) = app.store.record_audit(entry).await {
        tracing::error!(error = %e, "audit write failed");
    }
}
