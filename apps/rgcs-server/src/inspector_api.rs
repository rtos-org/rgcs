//! MAVLink inspector endpoints (user request 2026-10-19): what the link received and what RGCS
//! sent, per system / component / message.

use axum::extract::{Path, State};
use axum::http::StatusCode;
use axum::response::Response;
use rgcs_core::{InspectorDir, InspectorRow};
use serde::Serialize;

use crate::api::{err, ok};
use crate::app::AppState;
use crate::auth::AuthUser;

#[derive(Serialize, ts_rs::TS)]
#[ts(export)]
pub struct InspectorList {
    pub rows: Vec<InspectorRow>,
    /// The RGCS SYSID (its `tx` rows carry it).
    pub gcs_sysid: u8,
}

/// `GET /api/mavlink/inspector`
pub async fn list(State(app): State<AppState>, AuthUser(_op): AuthUser) -> Response {
    let rows = app.inspector.rows(app.inspector.now_ms());
    ok(InspectorList {
        rows,
        gcs_sysid: app.gcs.get(),
    })
}

/// `GET /api/mavlink/inspector/{dir}/{sysid}/{compid}/{msg_id}` — the row and its last message's fields.
pub async fn detail(
    State(app): State<AppState>,
    AuthUser(_op): AuthUser,
    Path((dir, sysid, compid, msg_id)): Path<(InspectorDir, u8, u8, u32)>,
) -> Response {
    match app
        .inspector
        .detail(dir, sysid, compid, msg_id, app.inspector.now_ms())
    {
        Some(d) => ok(d),
        None => err(StatusCode::NOT_FOUND, "not_found", "no such message on the link"),
    }
}
