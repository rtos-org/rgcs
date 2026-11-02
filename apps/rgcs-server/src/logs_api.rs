//! Stored DataFlash logs: list, list on the flight controller, fetch over
//! MAVLink (202 + `log_fetch_progress`), download, upload from the browser, attach to a flight.

use std::path::{Path, PathBuf};

use axum::body::{Body, Bytes};
use axum::extract::{Path as UrlPath, Query, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use futures::StreamExt;
use rgcs_core::{FlightLog, LinkStatus, LogSource, SysId};
use rgcs_store::audit::AuditInput;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tokio::io::AsyncWriteExt;

use crate::api::{err, ok};
use crate::app::AppState;
use crate::auth::AuthUser;
use crate::logbook_api::{created, internal, validation};
use crate::logs::LogError;

/// 1 GiB: a long flight's DataFlash from an SD card.
pub const MAX_UPLOAD_BYTES: usize = 1024 * 1024 * 1024;
const MAX_FILENAME: usize = 80;

#[derive(Serialize)]
pub struct LogsReply {
    pub fetch_enabled: bool,
    pub logs: Vec<FlightLog>,
}

#[derive(Deserialize)]
pub struct FetchBody {
    pub fc_log_id: u32,
    pub flight_id: Option<i64>,
}

#[derive(Deserialize)]
pub struct UploadQuery {
    pub filename: Option<String>,
    pub flight_id: Option<i64>,
}

#[derive(Deserialize)]
pub struct AttachBody {
    pub flight_id: Option<i64>,
}

pub fn logs_dir(data_dir: &Path, sysid: SysId) -> PathBuf {
    data_dir.join("logs").join(sysid.to_string())
}

/// Keeps `[A-Za-z0-9._-]`, replaces the rest with `_`, caps the length; empty → `upload.bin`.
pub fn sanitize_filename(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-') {
                c
            } else {
                '_'
            }
        })
        .take(MAX_FILENAME)
        .collect();
    let trimmed = cleaned.trim_matches(|c| c == '.' || c == '_');
    if trimmed.is_empty() {
        "upload.bin".into()
    } else {
        trimmed.to_string()
    }
}

fn log_error(e: LogError) -> Response {
    match e {
        LogError::Disabled => err(
            StatusCode::SERVICE_UNAVAILABLE,
            "log_fetch_disabled",
            e.to_string(),
        ),
        LogError::Busy => err(StatusCode::CONFLICT, "busy", e.to_string()),
        LogError::Timeout => err(StatusCode::GATEWAY_TIMEOUT, "timeout", e.to_string()),
        LogError::LinkClosed => err(StatusCode::SERVICE_UNAVAILABLE, "link_lost", e.to_string()),
        LogError::NotFound => err(StatusCode::NOT_FOUND, "not_found", e.to_string()),
        LogError::Io(m) => err(StatusCode::INTERNAL_SERVER_ERROR, "io", m),
        LogError::TooLarge => err(StatusCode::PAYLOAD_TOO_LARGE, "too_large", e.to_string()),
    }
}

async fn link_ok(app: &AppState, sysid: SysId) -> Result<(), Box<Response>> {
    match app.router.lock().await.state(sysid) {
        None => Err(Box::new(err(
            StatusCode::NOT_FOUND,
            "not_found",
            format!("vehicle {sysid} is not connected"),
        ))),
        Some(v) if v.link == LinkStatus::Lost => Err(Box::new(err(
            StatusCode::SERVICE_UNAVAILABLE,
            "link_lost",
            "no heartbeat for 10 s",
        ))),
        Some(_) => Ok(()),
    }
}

/// `flight_id` must be a live (not superseded) flight of this vehicle (when given).
async fn check_flight(app: &AppState, sysid: SysId, flight_id: Option<i64>) -> Result<(), Box<Response>> {
    let Some(id) = flight_id else { return Ok(()) };
    match app.store.flight(id).await {
        Ok(Some(f)) if f.sysid == sysid => {}
        Ok(_) => return Err(Box::new(validation("flight_id is not a flight of this vehicle"))),
        Err(e) => return Err(Box::new(internal(e))),
    }
    match app.store.flight_superseded_by(id).await {
        Ok(None) => Ok(()),
        Ok(Some(newer)) => Err(Box::new(validation(format!(
            "flight {id} was corrected by flight {newer}; attach to that one"
        )))),
        Err(e) => Err(Box::new(internal(e))),
    }
}

async fn audit(
    app: &AppState,
    op: &str,
    sysid: SysId,
    command: &str,
    args: serde_json::Value,
    result: &str,
    reason: Option<String>,
) {
    let entry = AuditInput {
        operator: op,
        sysid: Some(sysid),
        target: "logs",
        command,
        args: Some(args.to_string()),
        result,
        reason,
    };
    if let Err(e) = app.store.record_audit(entry).await {
        tracing::warn!(error = %e, "audit write failed");
    }
}

/// `GET /api/vehicles/{sysid}/logs`
pub async fn list(
    State(app): State<AppState>,
    AuthUser(_op): AuthUser,
    UrlPath(sysid): UrlPath<SysId>,
) -> Response {
    match app.store.list_logs(sysid).await {
        Ok(logs) => ok(LogsReply {
            fetch_enabled: app.logs.enabled(),
            logs,
        }),
        Err(e) => internal(e),
    }
}

/// `GET /api/vehicles/{sysid}/logs/fc` — what the flight controller holds.
pub async fn list_fc(
    State(app): State<AppState>,
    AuthUser(_op): AuthUser,
    UrlPath(sysid): UrlPath<SysId>,
) -> Response {
    if !app.logs.enabled() {
        return log_error(LogError::Disabled);
    }
    if let Err(r) = link_ok(&app, sysid).await {
        return *r;
    }
    match app.logs.list(sysid, &app.outgoing).await {
        Ok(entries) => ok(entries),
        Err(e) => log_error(e),
    }
}

/// `POST /api/vehicles/{sysid}/logs/fetch` → 202; the transfer runs in the background.
pub async fn fetch(
    State(app): State<AppState>,
    AuthUser(op): AuthUser,
    UrlPath(sysid): UrlPath<SysId>,
    Json(body): Json<FetchBody>,
) -> Response {
    if !app.logs.enabled() {
        return log_error(LogError::Disabled);
    }
    if let Err(r) = link_ok(&app, sysid).await {
        return *r;
    }
    if let Err(r) = check_flight(&app, sysid, body.flight_id).await {
        return *r;
    }
    let Ok(fc_log_id) = u16::try_from(body.fc_log_id) else {
        return validation("fc_log_id is out of range");
    };
    let entries = match app.logs.list(sysid, &app.outgoing).await {
        Ok(e) => e,
        Err(e) => return log_error(e),
    };
    let Some(entry) = entries.iter().find(|e| e.id == body.fc_log_id).copied() else {
        return log_error(LogError::NotFound);
    };
    let filename = format!("{}_{}.bin", entry.id, entry.time_utc);
    let path = logs_dir(&app.data_dir, sysid).join(&filename);
    let operator = op.username.clone();
    tokio::spawn(async move {
        let result = app
            .logs
            .fetch(sysid, fc_log_id, entry.size, &path, &app.outgoing)
            .await;
        let args = json!({ "fc_log_id": entry.id, "filename": filename, "flight_id": body.flight_id });
        match result {
            Ok(size) => {
                if let Err(e) = app
                    .store
                    .add_log(
                        sysid,
                        body.flight_id,
                        Some(entry.id),
                        &filename,
                        size,
                        LogSource::Mavlink,
                        &operator,
                    )
                    .await
                {
                    tracing::warn!(error = %e, "flight_logs insert failed");
                }
                audit(&app, &operator, sysid, "log_fetch", args, "ok", None).await;
            }
            Err(e) => {
                audit(
                    &app,
                    &operator,
                    sysid,
                    "log_fetch",
                    args,
                    "failed",
                    Some(e.to_string()),
                )
                .await
            }
        }
    });
    (
        StatusCode::ACCEPTED,
        Json(json!({ "success": true, "data": { "fc_log_id": entry.id } })),
    )
        .into_response()
}

async fn own_log(app: &AppState, sysid: SysId, id: i64) -> Result<FlightLog, Box<Response>> {
    match app.store.log(id).await {
        Ok(Some(l)) if l.sysid == sysid => Ok(l),
        Ok(_) => Err(Box::new(err(
            StatusCode::NOT_FOUND,
            "not_found",
            format!("log {id} is unknown"),
        ))),
        Err(e) => Err(Box::new(internal(e))),
    }
}

/// `GET /api/vehicles/{sysid}/logs/{id}/file` — streamed attachment.
pub async fn file(
    State(app): State<AppState>,
    AuthUser(_op): AuthUser,
    UrlPath((sysid, id)): UrlPath<(SysId, i64)>,
) -> Response {
    let log = match own_log(&app, sysid, id).await {
        Ok(l) => l,
        Err(r) => return *r,
    };
    let path = logs_dir(&app.data_dir, sysid).join(&log.filename);
    let Ok(f) = tokio::fs::File::open(&path).await else {
        return err(StatusCode::NOT_FOUND, "not_found", "log file is missing on disk");
    };
    let stream = tokio_util::io::ReaderStream::new(f);
    let mut headers = HeaderMap::new();
    headers.insert(
        header::CONTENT_TYPE,
        "application/octet-stream".parse().expect("static"),
    );
    if let Ok(v) = format!("attachment; filename=\"{}\"", log.filename).parse() {
        headers.insert(header::CONTENT_DISPOSITION, v);
    }
    headers.insert(header::CONTENT_LENGTH, log.size.into());
    (StatusCode::OK, headers, Body::from_stream(stream)).into_response()
}

/// `POST /api/vehicles/{sysid}/logs/upload?filename=&flight_id=` — raw body streamed to disk.
pub async fn upload(
    State(app): State<AppState>,
    AuthUser(op): AuthUser,
    UrlPath(sysid): UrlPath<SysId>,
    Query(q): Query<UploadQuery>,
    headers: HeaderMap,
    body: Body,
) -> Response {
    let declared = headers
        .get(header::CONTENT_LENGTH)
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.parse::<u64>().ok())
        .unwrap_or(0);
    if declared == 0 {
        return validation("the request body is empty");
    }
    if declared > MAX_UPLOAD_BYTES as u64 {
        return err(
            StatusCode::PAYLOAD_TOO_LARGE,
            "too_large",
            "uploads are limited to 1 GiB",
        );
    }
    if let Err(r) = check_flight(&app, sysid, q.flight_id).await {
        return *r;
    }
    let name = format!(
        "upload_{}_{}",
        crate::app::unix_ms(),
        sanitize_filename(q.filename.as_deref().unwrap_or("upload.bin"))
    );
    let dir = logs_dir(&app.data_dir, sysid);
    let path = dir.join(&name);
    let written = match stream_to_file(&dir, &path, body).await {
        Ok(n) if n > 0 => n,
        Ok(_) => {
            let _ = tokio::fs::remove_file(&path).await;
            return validation("the request body is empty");
        }
        Err(UploadError::TooLarge) => {
            let _ = tokio::fs::remove_file(&path).await;
            return err(
                StatusCode::PAYLOAD_TOO_LARGE,
                "too_large",
                "uploads are limited to 1 GiB",
            );
        }
        Err(UploadError::Io(e)) => {
            let _ = tokio::fs::remove_file(&path).await;
            return err(StatusCode::INTERNAL_SERVER_ERROR, "io", e);
        }
    };
    match app
        .store
        .add_log(
            sysid,
            q.flight_id,
            None,
            &name,
            written,
            LogSource::Upload,
            &op.username,
        )
        .await
    {
        Ok(log) => {
            audit(
                &app,
                &op.username,
                sysid,
                "log_upload",
                json!({ "id": log.id, "size": written }),
                "ok",
                None,
            )
            .await;
            created(log)
        }
        Err(e) => internal(e),
    }
}

enum UploadError {
    TooLarge,
    Io(String),
}

/// Streams the body to `path`, cutting it at `MAX_UPLOAD_BYTES` whatever the headers claim.
async fn stream_to_file(dir: &Path, path: &Path, body: Body) -> Result<u64, UploadError> {
    let io = |e: std::io::Error| UploadError::Io(e.to_string());
    tokio::fs::create_dir_all(dir).await.map_err(io)?;
    let mut file = tokio::fs::File::create(path).await.map_err(io)?;
    let mut stream = Body::new(http_body_util::Limited::new(body, MAX_UPLOAD_BYTES)).into_data_stream();
    let mut written = 0u64;
    while let Some(chunk) = stream.next().await {
        let chunk: Bytes = chunk.map_err(|e| {
            let inner = e.into_inner();
            if inner.downcast_ref::<http_body_util::LengthLimitError>().is_some() {
                UploadError::TooLarge
            } else {
                UploadError::Io(inner.to_string())
            }
        })?;
        file.write_all(&chunk).await.map_err(io)?;
        written += chunk.len() as u64;
    }
    file.flush().await.map_err(io)?;
    Ok(written)
}

/// `PATCH /api/vehicles/{sysid}/logs/{id}` — (re)attach to a flight or detach with `null`.
pub async fn attach(
    State(app): State<AppState>,
    AuthUser(op): AuthUser,
    UrlPath((sysid, id)): UrlPath<(SysId, i64)>,
    Json(body): Json<AttachBody>,
) -> Response {
    let before = match own_log(&app, sysid, id).await {
        Ok(l) => l,
        Err(r) => return *r,
    };
    if let Err(r) = check_flight(&app, sysid, body.flight_id).await {
        return *r;
    }
    match app.store.attach_log(id, body.flight_id).await {
        Ok(true) => match app.store.log(id).await {
            Ok(Some(l)) => {
                let args = json!({ "id": id, "from": before.flight_id, "to": body.flight_id });
                audit(&app, &op.username, sysid, "log_attach", args, "ok", None).await;
                ok(l)
            }
            Ok(None) => err(StatusCode::NOT_FOUND, "not_found", "log vanished"),
            Err(e) => internal(e),
        },
        Ok(false) => err(StatusCode::NOT_FOUND, "not_found", format!("log {id} is unknown")),
        Err(e) => internal(e),
    }
}

#[cfg(test)]
mod tests {
    use super::sanitize_filename;

    #[test]
    fn filenames_are_reduced_to_a_safe_charset() {
        assert_eq!(
            sanitize_filename("2026-12-05 10:00:00.bin"),
            "2026-12-05_10_00_00.bin"
        );
        assert_eq!(sanitize_filename("../../etc/passwd"), "etc_passwd");
        assert_eq!(sanitize_filename(""), "upload.bin");
        assert_eq!(sanitize_filename("ログ.BIN"), "BIN");
        assert!(sanitize_filename(&"a".repeat(200)).len() <= 80);
    }
}
