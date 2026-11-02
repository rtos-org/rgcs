//! `GET /api/vehicles/{sysid}/logbook/export?form=1|2|3&from=&to=&format=pdf|csv`
//!: the three MLIT forms for one vehicle and period.

use axum::extract::{Path, Query, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use rgcs_core::jst;
use rgcs_core::SysId;
use serde::Deserialize;

use crate::app::AppState;
use crate::auth::AuthUser;
use crate::export_csv::{csv_form1, csv_form2, csv_form3};
use crate::logbook_api::{internal, validation};
use crate::pdf::forms::{render_form1, render_form2, render_form3, FormContext};

#[derive(Deserialize)]
pub struct ExportQuery {
    pub form: u8,
    pub from: String,
    pub to: String,
    pub format: String,
}

const MAX_RUNS: u32 = 1000;

pub async fn export(
    State(app): State<AppState>,
    AuthUser(_op): AuthUser,
    Path(sysid): Path<SysId>,
    Query(q): Query<ExportQuery>,
) -> Response {
    if !(1..=3).contains(&q.form) {
        return validation("form must be 1, 2 or 3");
    }
    if !jst::is_date(&q.from) || !jst::is_date(&q.to) || q.from > q.to {
        return validation("from/to must be YYYY-MM-DD with from <= to");
    }
    let pdf = match q.format.as_str() {
        "pdf" => true,
        "csv" => false,
        _ => return validation("format must be pdf or csv"),
    };
    let live_name = match app.router.lock().await.state(sysid) {
        Some(v) => v.name.clone(),
        None => format!("UAV-{sysid:02}"),
    };
    let registry = match app.store.registry(sysid, &live_name).await {
        Ok(r) => r,
        Err(e) => return internal(e),
    };
    let ctx = FormContext {
        registry: &registry,
        from: &q.from,
        to: &q.to,
    };
    let bytes = match q.form {
        1 => match app.store.list_flights(sysid, Some(&q.from), Some(&q.to)).await {
            Ok(f) if pdf => render_form1(&ctx, &f),
            Ok(f) => csv_form1(&f),
            Err(e) => return internal(e),
        },
        2 => match app
            .store
            .list_inspections(sysid, Some(&q.from), Some(&q.to), MAX_RUNS)
            .await
        {
            Ok(mut runs) if pdf => {
                runs.reverse();
                render_form2(&ctx, &runs)
            }
            Ok(mut runs) => {
                runs.reverse();
                csv_form2(&runs)
            }
            Err(e) => return internal(e),
        },
        _ => match app
            .store
            .list_maintenance(sysid, Some(&q.from), Some(&q.to))
            .await
        {
            Ok(r) if pdf => render_form3(&ctx, &r),
            Ok(r) => csv_form3(&r),
            Err(e) => return internal(e),
        },
    };
    let ext = if pdf { "pdf" } else { "csv" };
    let mut headers = HeaderMap::new();
    let content_type = if pdf {
        "application/pdf"
    } else {
        "text/csv; charset=utf-8"
    };
    headers.insert(header::CONTENT_TYPE, content_type.parse().expect("static"));
    let name = format!(
        "attachment; filename=\"logbook-{sysid}-form{}-{}-{}.{ext}\"",
        q.form, q.from, q.to
    );
    if let Ok(v) = name.parse() {
        headers.insert(header::CONTENT_DISPOSITION, v);
    }
    (StatusCode::OK, headers, bytes).into_response()
}
