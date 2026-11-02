//! `rgcs-server`: MAVLink link → router → WebSocket telemetry, REST API and the static UI.
//!
//! The binary in `main.rs` only wires configuration and tasks together; everything else lives
//! here so integration tests can build the axum app in-process.

pub mod ai_api;
pub mod ai_hub;
pub mod ai_meter;
pub mod ai_tools;
pub mod ai_tools_guard;
pub mod ai_validate;
pub mod api;
pub mod app;
pub mod assignment_api;
pub mod auth;
pub mod auto_record;
pub mod branding;
pub mod calib_api;
pub mod calibration;
pub mod camera_api;
pub mod cameras;
pub mod commands;
pub mod config;
pub mod confirm;
mod env_amedas;
pub mod env_api;
pub mod env_fetch;
pub mod env_hub;
pub mod env_view;
pub mod export_api;
pub mod export_csv;
pub mod flight_api;
pub mod flights;
pub mod geofence_api;
pub mod gps_time;
pub mod guard_api;
pub mod guard_hub;
pub mod guard_settings;
pub mod guard_vehicle;
pub mod guard_worker;
pub mod guided;
pub mod input_api;
pub mod inspector_api;
pub mod logbook_api;
pub mod logs;
pub mod logs_api;
pub mod media_probe;
pub mod message_log;
pub mod messages_api;
pub mod mission_api;
pub mod missions;
pub mod network;
pub mod network_api;
pub mod other_guard;
pub mod overlay_api;
#[cfg(any(test, feature = "sim"))]
pub mod overlay_fake;
pub mod overlay_fetch;
#[cfg(test)]
mod overlay_fetch_tests;
pub mod overlay_tiles;
pub mod param_api;
pub mod param_pick;
pub mod params;
pub mod pdf;
pub mod plugin_api;
pub mod plugins;
pub mod present_api;
pub mod roi;
pub mod roi_api;
mod roi_native;
mod roi_task;
pub mod sessions;
pub mod settings;
pub mod shutdown;
pub mod survey_camera_api;
pub mod telemetry;
pub mod transfer;
pub mod ui_embed;
pub mod video;
pub mod video_api;
pub mod ws;

/// Build id baked in by `scripts/build-pi.sh` (`RGCS_BUILD=<git sha>[-dirty]`); `dev` otherwise.
pub const BUILD: &str = match option_env!("RGCS_BUILD") {
    Some(b) => b,
    None => "dev",
};
