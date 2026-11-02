//! `GET /api/vehicles/{sysid}/params/pick?names=A,B` (2026-10-20): a few named parameters for the
//! planner's predicted flight path. Missing ones are requested with PARAM_REQUEST_READ and the
//! reply waits up to ~1 s for them; whatever is still unknown is listed in `missing`.

use std::collections::BTreeMap;
use std::time::Duration;

use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use axum::response::Response;
use rgcs_core::SysId;
use serde::{Deserialize, Serialize};

use crate::api::{err, ok};
use crate::app::AppState;
use crate::auth::AuthUser;
use crate::param_api::MAX_NAME_LEN;

const MAX_NAMES: usize = 32;
const WAIT: Duration = Duration::from_millis(200);
const WAIT_ROUNDS: u32 = 5;

#[derive(Deserialize)]
pub struct PickQuery {
    pub names: String,
}

#[derive(Debug, Serialize)]
pub struct Picked {
    pub values: BTreeMap<String, f32>,
    pub missing: Vec<String>,
}

/// ArduPilot names: 1–16 of `A–Z 0–9 _`.
fn valid_name(name: &str) -> bool {
    (1..=MAX_NAME_LEN).contains(&name.len())
        && name
            .bytes()
            .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit() || b == b'_')
}

fn parse(names: &str) -> Option<Vec<String>> {
    let list: Vec<String> = names
        .split(',')
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
        .collect();
    let ok = !list.is_empty() && list.len() <= MAX_NAMES && list.iter().all(|n| valid_name(n));
    ok.then_some(list)
}

fn read(app: &AppState, sysid: SysId, names: &[String]) -> Picked {
    let (values, missing): (Vec<_>, Vec<_>) = names
        .iter()
        .map(|n| (n.clone(), app.params.get(sysid, n)))
        .partition(|(_, v)| v.is_some());
    Picked {
        values: values
            .into_iter()
            .filter_map(|(n, v)| v.map(|v| (n, v)))
            .collect(),
        missing: missing.into_iter().map(|(n, _)| n).collect(),
    }
}

pub async fn pick(
    State(app): State<AppState>,
    AuthUser(_user): AuthUser,
    Path(sysid): Path<SysId>,
    Query(q): Query<PickQuery>,
) -> Response {
    let Some(names) = parse(&q.names) else {
        return err(
            StatusCode::BAD_REQUEST,
            "invalid_names",
            format!("1–{MAX_NAMES} comma-separated names of A–Z, 0–9 and _ (at most {MAX_NAME_LEN} each)"),
        );
    };
    let mut got = read(&app, sysid, &names);
    if got.missing.is_empty() {
        return ok(got);
    }
    for name in &got.missing {
        let _ = app.outgoing.try_send(rgcs_mavlink::Outgoing {
            message: rgcs_mavlink::encode_param_request_read(sysid, name),
        });
    }
    for _ in 0..WAIT_ROUNDS {
        tokio::time::sleep(WAIT).await;
        got = read(&app, sysid, &names);
        if got.missing.is_empty() {
            break;
        }
    }
    ok(got)
}
