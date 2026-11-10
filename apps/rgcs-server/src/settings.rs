//! `GET/PUT /api/settings/app`: what the UI needs that is not per-vehicle —
//! the language default, the map tile source (config.toml) and the persisted 地図表示 switch.

use axum::extract::State;
use axum::http::StatusCode;
use axum::response::Response;
use axum::Json;
use rgcs_store::app_settings::{GCS_SYSID, GIMBAL_GROUND_PROJECTION, TRACK_MINUTES};
use rgcs_store::audit::AuditInput;
use serde::{Deserialize, Serialize};

use crate::api::{err, ok};
use crate::app::AppState;
use crate::auth::AuthUser;

/// 地図表示.
#[derive(Debug, Clone, Default, Serialize, Deserialize, ts_rs::TS)]
#[ts(export)]
pub struct MapSettings {
    /// Draw the gimbal footprint on the ground instead of the direction fan; default off.
    pub gimbal_ground_projection: bool,
    /// How many minutes of flight track the maps keep (0 = none, at most 120); default 10.
    pub track_minutes: u32,
}

/// Default and upper bound of `track_minutes`.
pub const DEFAULT_TRACK_MINUTES: u32 = 10;
pub const MAX_TRACK_MINUTES: i64 = 120;

/// MAVLink identity (user request 2026-10-19).
#[derive(Debug, Clone, Serialize, ts_rs::TS)]
#[ts(export)]
pub struct MavlinkSettings {
    pub gcs_sysid: u8,
}

#[derive(Serialize, ts_rs::TS)]
#[ts(export)]
pub struct AppSettings {
    pub lang: String,
    pub map_tile_url: String,
    pub map_attribution: String,
    pub map: MapSettings,
    pub basemaps: Vec<crate::config::Basemap>,
    /// DEM tile template for the 3D map; `null` when 3D is off.
    pub terrain_tiles: Option<String>,
    /// Resolved DEM encoding: `mapbox` or `terrarium`, even when 3D is off.
    pub terrain_encoding: String,
    pub mavlink: MavlinkSettings,
}

/// `PUT /api/settings/app` body: only the persisted settings, each optional.
#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AppSettingsPut {
    pub map: Option<MapSettingsPut>,
    /// Admin only.
    pub mavlink: Option<MavlinkSettingsPut>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MavlinkSettingsPut {
    /// Wider than u8 so 0 / 256 are a validation error, not a parse error.
    pub gcs_sysid: Option<i64>,
}

/// The stored SYSID, or 255 when unset / invalid.
pub async fn load_gcs_sysid(store: &rgcs_store::Store) -> u8 {
    let stored = store.app_setting(GCS_SYSID).await.ok().flatten();
    stored
        .and_then(|v| v.parse::<u8>().ok())
        .filter(|v| *v >= 1)
        .unwrap_or(rgcs_core::gcs::DEFAULT_GCS_SYSID)
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MapSettingsPut {
    pub gimbal_ground_projection: Option<bool>,
    /// Wider than u32 so a negative value is a validation error, not a parse error.
    pub track_minutes: Option<i64>,
}

async fn current(app: &AppState) -> rgcs_store::Result<AppSettings> {
    let projection = app.store.app_setting(GIMBAL_GROUND_PROJECTION).await?;
    let minutes = app.store.app_setting(TRACK_MINUTES).await?;
    Ok(AppSettings {
        lang: "ja".into(),
        map_tile_url: app.map_tile_url.clone(),
        map_attribution: app.map_attribution.clone(),
        map: MapSettings {
            gimbal_ground_projection: projection.as_deref() == Some("true"),
            track_minutes: minutes
                .and_then(|v| v.parse::<u32>().ok())
                .filter(|v| i64::from(*v) <= MAX_TRACK_MINUTES)
                .unwrap_or(DEFAULT_TRACK_MINUTES),
        },
        basemaps: app.basemaps.clone(),
        terrain_tiles: app.terrain_tiles.clone(),
        terrain_encoding: app.terrain_encoding.clone(),
        mavlink: MavlinkSettings {
            gcs_sysid: app.gcs.get(),
        },
    })
}

pub async fn app_settings(State(app): State<AppState>, AuthUser(_op): AuthUser) -> Response {
    match current(&app).await {
        Ok(s) => ok(s),
        Err(e) => err(StatusCode::INTERNAL_SERVER_ERROR, "internal", e.to_string()),
    }
}

fn audit_put<'a>(op: &'a str, args: serde_json::Value) -> AuditInput<'a> {
    AuditInput {
        operator: op,
        sysid: None,
        target: "settings",
        command: "app_settings_put",
        args: Some(args.to_string()),
        result: "ok",
        reason: None,
    }
}

/// Stores one 地図表示 value and audits it as `{"map": {name: value}}`.
async fn put_map(
    app: &AppState,
    op: &str,
    key: &str,
    name: &str,
    value: serde_json::Value,
) -> Result<(), Box<Response>> {
    let stored = match &value {
        serde_json::Value::String(s) => s.clone(),
        v => v.to_string(),
    };
    app.store
        .put_app_setting(key, &stored)
        .await
        .map_err(|e| Box::new(err(StatusCode::INTERNAL_SERVER_ERROR, "internal", e.to_string())))?;
    if let Err(e) = app
        .store
        .record_audit(audit_put(op, serde_json::json!({ "map": { name: value } })))
        .await
    {
        tracing::error!(error = %e, "audit write failed");
    }
    Ok(())
}

/// 1–255 and not a connected vehicle's SYSID; applied to the link at once.
async fn put_gcs_sysid(
    app: &AppState,
    op: &rgcs_core::operator::Operator,
    value: i64,
) -> Result<(), Box<Response>> {
    if op.role != rgcs_core::operator::Role::Admin {
        return Err(Box::new(err(
            StatusCode::FORBIDDEN,
            "forbidden",
            "admin role required",
        )));
    }
    let Ok(sysid) = u8::try_from(value)
        .map_err(|_| ())
        .and_then(|v| if v >= 1 { Ok(v) } else { Err(()) })
    else {
        return Err(Box::new(err(
            StatusCode::BAD_REQUEST,
            "validation",
            "gcs_sysid must be 1–255",
        )));
    };
    if app.missions.any_busy() {
        return Err(Box::new(err(
            StatusCode::CONFLICT,
            "busy",
            "a mission transfer is running; change the SYSID after it ends",
        )));
    }
    if app.router.lock().await.states().iter().any(|v| v.sysid == sysid) {
        return Err(Box::new(err(
            StatusCode::BAD_REQUEST,
            "sysid_in_use",
            format!("SYSID {sysid} belongs to a connected vehicle"),
        )));
    }
    app.store
        .put_app_setting(GCS_SYSID, &sysid.to_string())
        .await
        .map_err(|e| Box::new(err(StatusCode::INTERNAL_SERVER_ERROR, "internal", e.to_string())))?;
    app.gcs.set(sysid);
    if let Err(e) = app
        .store
        .record_audit(audit_put(
            &op.username,
            serde_json::json!({ "mavlink": { "gcs_sysid": sysid } }),
        ))
        .await
    {
        tracing::error!(error = %e, "audit write failed");
    }
    Ok(())
}

/// The map switch: any signed-in operator (a station display preference); the SYSID: admin only. Audited.
pub async fn put_app_settings(
    State(app): State<AppState>,
    AuthUser(op): AuthUser,
    Json(body): Json<AppSettingsPut>,
) -> Response {
    if let Some(value) = body.mavlink.and_then(|m| m.gcs_sysid) {
        if let Err(r) = put_gcs_sysid(&app, &op, value).await {
            return *r;
        }
    }
    let map = body.map.unwrap_or(MapSettingsPut {
        gimbal_ground_projection: None,
        track_minutes: None,
    });
    if let Some(minutes) = map.track_minutes {
        if !(0..=MAX_TRACK_MINUTES).contains(&minutes) {
            return err(
                StatusCode::BAD_REQUEST,
                "validation",
                format!("track_minutes must be 0–{MAX_TRACK_MINUTES}"),
            );
        }
        let value = serde_json::json!(minutes);
        if let Err(r) = put_map(&app, &op.username, TRACK_MINUTES, "track_minutes", value).await {
            return *r;
        }
    }
    if let Some(flag) = map.gimbal_ground_projection {
        let value = serde_json::json!(flag);
        if let Err(r) = put_map(
            &app,
            &op.username,
            GIMBAL_GROUND_PROJECTION,
            "gimbal_ground_projection",
            value,
        )
        .await
        {
            return *r;
        }
    }
    app_settings(State(app), AuthUser(op)).await
}
