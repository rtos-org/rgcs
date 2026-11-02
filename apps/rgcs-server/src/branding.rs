//! Audience-page logo: one file under `data_dir/branding/` (PNG or SVG, ≤ 1 MB).

use std::path::{Path, PathBuf};

use axum::body::Bytes;
use axum::extract::State;
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use rgcs_store::audit::AuditInput;

use crate::api::{err, ok};
use crate::app::AppState;
use crate::auth::AdminUser;

pub const MAX_LOGO_BYTES: usize = 1024 * 1024;
const KINDS: &[(&str, &str)] = &[("image/png", "png"), ("image/svg+xml", "svg")];

fn dir(data_dir: &Path) -> PathBuf {
    data_dir.join("branding")
}

/// (path, content-type) of the stored logo, if any.
pub fn find_logo(data_dir: &Path) -> Option<(PathBuf, &'static str)> {
    KINDS
        .iter()
        .map(|(ct, ext)| (dir(data_dir).join(format!("logo.{ext}")), *ct))
        .find(|(p, _)| p.is_file())
}

fn remove_all(data_dir: &Path) {
    for (_, ext) in KINDS {
        let _ = std::fs::remove_file(dir(data_dir).join(format!("logo.{ext}")));
    }
}

pub async fn put_logo(
    State(app): State<AppState>,
    AdminUser(op): AdminUser,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let ct = headers
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let Some((_, ext)) = KINDS.iter().find(|(k, _)| ct.starts_with(k)) else {
        return err(
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            "unsupported_type",
            "logo must be image/png or image/svg+xml",
        );
    };
    if body.len() > MAX_LOGO_BYTES {
        return err(
            StatusCode::PAYLOAD_TOO_LARGE,
            "too_large",
            "logo must be 1 MB or smaller",
        );
    }
    let target = dir(&app.data_dir).join(format!("logo.{ext}"));
    let write = tokio::task::spawn_blocking({
        let data_dir = app.data_dir.clone();
        let body = body.clone();
        move || {
            std::fs::create_dir_all(dir(&data_dir))?;
            remove_all(&data_dir);
            std::fs::write(&target, &body)
        }
    })
    .await;
    match write {
        Ok(Ok(())) => {}
        Ok(Err(e)) => return err(StatusCode::INTERNAL_SERVER_ERROR, "internal", e.to_string()),
        Err(e) => return err(StatusCode::INTERNAL_SERVER_ERROR, "internal", e.to_string()),
    }
    audit(
        &app,
        &op.username,
        "logo_upload",
        Some(format!("{ct}, {} bytes", body.len())),
    )
    .await;
    ok(())
}

pub async fn delete_logo(State(app): State<AppState>, AdminUser(op): AdminUser) -> Response {
    remove_all(&app.data_dir);
    audit(&app, &op.username, "logo_delete", None).await;
    ok(())
}

/// Served to the audience page; `no-store` so a replaced logo shows immediately.
pub fn logo_response(data_dir: &Path) -> Response {
    match find_logo(data_dir).and_then(|(p, ct)| std::fs::read(p).ok().map(|b| (b, ct))) {
        Some((bytes, ct)) => {
            let ext = if ct == "image/svg+xml" { "svg" } else { "png" };
            // A logo is an <img> on the audience page; opened directly it must not be able to
            // run script in this origin (SVG can carry <script>), hence CSP + sandbox + nosniff.
            (
                StatusCode::OK,
                [
                    (header::CONTENT_TYPE, ct.to_string()),
                    (header::CACHE_CONTROL, "no-store".to_string()),
                    (header::X_CONTENT_TYPE_OPTIONS, "nosniff".to_string()),
                    (
                        header::CONTENT_SECURITY_POLICY,
                        "default-src 'none'; style-src 'unsafe-inline'; sandbox".to_string(),
                    ),
                    (
                        header::CONTENT_DISPOSITION,
                        format!("inline; filename=logo.{ext}"),
                    ),
                ],
                bytes,
            )
                .into_response()
        }
        None => err(StatusCode::NOT_FOUND, "not_found", "no logo"),
    }
}

async fn audit(app: &AppState, operator: &str, command: &str, args: Option<String>) {
    let entry = AuditInput {
        operator,
        sysid: None,
        target: "branding",
        command,
        args,
        result: "ok",
        reason: None,
    };
    if let Err(e) = app.store.record_audit(entry).await {
        tracing::error!(error = %e, "audit write failed");
    }
}
