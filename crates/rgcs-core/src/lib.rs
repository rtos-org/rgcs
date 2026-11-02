//! Domain types shared by every RGCS crate and exported to TypeScript with `ts-rs`.
//!
//! Nothing here depends on MAVLink, tokio or the web framework: these are the
//! values that cross the WebSocket / HTTP boundary.

pub mod ai;
pub mod assignment;
pub mod calibration;
pub mod camera;
pub mod camera_media;
pub mod command;
pub mod env;
pub mod gcs;
pub mod geofence;
pub mod guard;
pub mod inspector;
pub mod jst;
pub mod log;
pub mod logbook;
pub mod mission;
pub mod mission_stored;
pub mod network;
pub mod operator;
pub mod overlay_area;
pub mod params;
pub mod plugin;
pub mod plugin_info;
mod plugin_validate;
pub mod roi;
pub mod survey_camera;
pub mod vehicle;
pub mod ws;

pub use ai::{
    AiChatReply, AiChatRequest, AiProposal, AiProviderKind, AiStatus, AiStatusCard, AiToolRun, AiVideoState,
};
pub use assignment::{Assignment, Written};
pub use calibration::{
    CalibFrame, CalibKind, CalibPhase, CalibRecord, CalibStatus, CompassProgress, RcRange,
};
pub use camera::{
    AxisFunction, AxisMapping, ButtonFunction, ButtonMapping, CameraCaps, CameraCommand, CameraKind,
    CameraProfile, CameraSnapshot, CameraState, CenterMode, Deadman, Firmware, GimbalAttitude, GimbalCaps,
    GimbalInputProfile, GimbalMode, ProfileError, RecordingState, VideoMode, VideoSource, VideoSourceMode,
    VideoSourceStatus, ZoomCaps, ZoomUnit,
};
pub use camera_media::{
    mt11_encoding_presets, AiAck, AiTrackingCaps, CameraClock, Detection, EncodingInfo, EncodingPreset,
    NormRect, StorageInfo, StorageStatus, ThermalCaps, ThermalFrame, ThermalGain, ThermalPoint, ThermalState,
    TrackState, TrackStatus, VideoCodec, AI_BOX_PX_DEFAULT, AI_BOX_PX_RANGE, AI_CENTER_BOX_PX, MT11_PALETTES,
};
pub use command::{CommandResult, VehicleCommand};
pub use env::{
    EnvClass, EnvFactor, EnvLevel, EnvReading, EnvSettings, EnvSourceStatus, EnvSummary, EnvThresholds,
};
pub use gcs::GcsId;
pub use geofence::{FenceZone, LatLon, RallyPoint};
pub use guard::{
    GuardAlert, GuardConsent, GuardLevel, GuardPhase, GuardSettings, GuardSigns, GUARD_COUNTDOWN_S,
    GUARD_TAKEOVER_WAIT_S,
};
pub use inspector::{InspectorDetail, InspectorDir, InspectorRow};
pub use log::{ackable, severity_of_statustext, LogEntry, MessageSource, Severity};
pub use logbook::{
    FcLogEntry, Flight, FlightInput, FlightLog, FlightPatch, FlightSquawk, FlightSquawkInput, FlightStatus,
    InspectionItem, InspectionResult, InspectionResultInput, InspectionResultRow, InspectionRun,
    InspectionRunInput, InspectionTemplate, InspectionTemplateInput, LogFetchProgress, LogSource,
    MaintenanceInput, MaintenanceRecord, PilotInfo, PilotInput, VehicleRegistry, VehicleRegistryInput,
};
pub use mission::{
    demo20, haversine_m, FenceInfo, Finding, FindingLevel, Home, Mission, MissionFrame, MissionItem,
    MissionProgress, MissionStats, MissionSummaryRow, MissionTransfer, StoredParam, SurveyBlock,
    TransferPhase, UploadReport, MAV_CMD_DO_JUMP, MAV_CMD_NAV_LAND, MAV_CMD_NAV_RETURN_TO_LAUNCH,
    MAV_CMD_NAV_TAKEOFF, MAV_CMD_NAV_WAYPOINT,
};
pub use mission_stored::{as_stored, stored_forms, stored_in_location};
pub use network::{
    CameraLink, CameraTransport, ClientSession, ComponentKind, MavLinkInfo, MavLinkKind, MediaServer,
    NetComponent, NetSystem, NetVehicle, NetworkTopology, ServerNode, Unconfigured, VideoPath,
    UNCONFIGURED_STANDALONE,
};
pub use operator::Operator;
pub use overlay_area::{AreaStatus, OverlayArea, TileEstimate};
pub use params::{ParamChange, ParamEntry, ParamHistoryEntry, ParamProgress, ParamWriteResult};
pub use plugin::{
    parse_manifest, valid_id, validate, LegendEntry, LocalText, Manifest, OverlayCache, OverlayInfo,
    OverlaySpec, PluginError, PluginInfo, PluginLink, PluginStatus, TileFormat,
};
pub use roi::{
    default_roi_targets, roi_slot_id, validate_roi_targets, RoiControl, RoiControlMode, RoiMode, RoiStatus,
    RoiTarget, ROI_SLOT_COUNT,
};
pub use survey_camera::{validate_survey_camera, SurveyCamera};
pub use vehicle::{
    diff, Attitude, Battery, GeoPoint, Gps, LinkStatus, NavInfo, SysId, VehicleKind, VehicleState,
    VehicleStateDiff, VehicleSummary,
};
pub use ws::{ClientMessage, ServerMessage, VehicleMessage, VideoSourceEntry};
