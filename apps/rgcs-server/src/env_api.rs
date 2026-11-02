//! `/api/env/*`: the fused factors, source status and
//! settings. Every change is audited (`target = "ai_intervention"`). Bodies carry
//! `key_configured` / `key_hint` only, never a key.

use axum::extract::rejection::JsonRejection;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::Response;
use axum::Json;
use rgcs_env::SourceId;
use serde_json::json;

use crate::api::{err, ok};
use crate::app::AppState;
use crate::auth::{AdminUser, AuthUser};
use crate::env_hub::EnvHub;
use crate::env_view::{apply_settings_put, apply_source_put, SettingsPut, SourcePut};
use crate::guard_hub::audit;

fn external(id: &str) -> Option<SourceId> {
    SourceId::parse(id).filter(|s| s.is_external())
}

fn no_source() -> Response {
    err(StatusCode::NOT_FOUND, "not_found", "no such source")
}

fn stored_failed(e: rgcs_store::StoreError) -> Response {
    tracing::error!(error = %e, "env settings write failed");
    err(
        StatusCode::INTERNAL_SERVER_ERROR,
        "internal",
        "settings could not be stored",
    )
}

pub async fn factors(State(app): State<AppState>, AuthUser(_op): AuthUser) -> Response {
    ok(app.env.summary())
}

pub async fn sources(State(app): State<AppState>, AuthUser(_op): AuthUser) -> Response {
    ok(app.env.sources())
}

pub async fn put_source(
    State(app): State<AppState>,
    AdminUser(op): AdminUser,
    Path(id): Path<String>,
    body: Result<Json<SourcePut>, JsonRejection>,
) -> Response {
    let Some(id) = external(&id) else {
        return no_source();
    };
    let Json(put) = match body {
        Ok(b) => b,
        Err(e) => return err(StatusCode::BAD_REQUEST, "validation", e.body_text()),
    };
    let next = match apply_source_put(app.env.source_cfg(id), &put) {
        Ok(c) => c,
        Err(m) => return err(StatusCode::BAD_REQUEST, "validation", m),
    };
    if let Err(e) = EnvHub::save_source(&app.store, id, next).await {
        return stored_failed(e);
    }
    app.env.set_source(id, next);
    let args = json!({
        "id": id.as_str(),
        "enabled": next.enabled,
        "interval_s": next.interval_s,
        "timeout_ms": next.timeout_ms,
    });
    audit(&app.store, &op.username, None, "env_source_put", args, "ok", None).await;
    ok(app.env.source(id))
}

pub async fn fetch(
    State(app): State<AppState>,
    AdminUser(_op): AdminUser,
    Path(id): Path<String>,
) -> Response {
    let Some(id) = external(&id) else {
        return no_source();
    };
    if let Err(code) = app.env.gate() {
        let message = match code {
            "consent_required" => "consent 2 (external data) is off",
            _ => "the AI guard is disabled",
        };
        return err(StatusCode::CONFLICT, code, message);
    }
    ok(app.env.fetch_now(id).await)
}

pub async fn get_settings(State(app): State<AppState>, AuthUser(_op): AuthUser) -> Response {
    ok(app.env.settings())
}

pub async fn put_settings(
    State(app): State<AppState>,
    AdminUser(op): AdminUser,
    body: Result<Json<SettingsPut>, JsonRejection>,
) -> Response {
    let Json(put) = match body {
        Ok(b) => b,
        Err(e) => return err(StatusCode::BAD_REQUEST, "validation", e.body_text()),
    };
    let next = match apply_settings_put(&app.env.settings(), put) {
        Ok(s) => s,
        Err(m) => return err(StatusCode::BAD_REQUEST, "validation", m),
    };
    if let Err(e) = EnvHub::save_settings(&app.store, &next).await {
        return stored_failed(e);
    }
    app.env.apply_settings(next.clone());
    let args = serde_json::to_value(&next).unwrap_or_default();
    audit(
        &app.store,
        &op.username,
        None,
        "env_settings_put",
        args,
        "ok",
        None,
    )
    .await;
    app.env.refresh().await;
    ok(next)
}
