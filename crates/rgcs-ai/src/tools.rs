//! Tool calls the LLM may make: names, input parsing and limits.
//!
//! Inputs are parsed as JSON values, never string-matched. Every tool only reads or proposes;
//! none sends anything to a vehicle or a camera, and none can trigger, cancel or change the
//! level of an AI 緊急介入 alert.

use std::fmt;

use rgcs_core::{SysId, VehicleCommand};
use serde_json::{Map, Value};

pub use crate::tool_schemas::{tool_specs, ToolSpec};

pub const TOOL_NAMES: [&str; 7] = [
    "get_vehicle_status",
    "list_vehicles",
    "list_recent_messages",
    "search_log",
    "propose_command",
    "list_guard_alerts",
    "get_external_factors",
];

/// `cmd` values `propose_command` accepts (`change_alt` and `other` are absent).
pub const PROPOSABLE_COMMANDS: [&str; 11] = [
    "pause",
    "resume",
    "rtl",
    "land",
    "change_speed",
    "set_mode",
    "mission_start",
    "mission_resume",
    "arm",
    "disarm",
    "takeoff",
];

pub const DEFAULT_MESSAGE_LIMIT: u32 = 20;
pub const MAX_MESSAGE_LIMIT: u32 = 50;
pub const MAX_QUERY_CHARS: usize = 100;
pub const MAX_REASON_CHARS: usize = 500;

#[derive(Debug, Clone, PartialEq)]
pub enum ToolCall {
    GetVehicleStatus {
        sysid: SysId,
    },
    ListVehicles,
    ListRecentMessages {
        sysid: Option<SysId>,
        limit: u32,
    },
    SearchLog {
        query: String,
        sysid: Option<SysId>,
        since: Option<i64>,
    },
    ProposeCommand {
        sysid: SysId,
        command: VehicleCommand,
        reason: String,
    },
    /// AI 緊急介入 alerts (deterministic detections), read only.
    ListGuardAlerts {
        sysid: Option<SysId>,
    },
    /// The fused external factors (each reading with source and time), read only.
    GetExternalFactors,
}

impl ToolCall {
    pub fn name(&self) -> &'static str {
        let [status, list, recent, search, propose, alerts, factors] = TOOL_NAMES;
        match self {
            Self::GetVehicleStatus { .. } => status,
            Self::ListVehicles => list,
            Self::ListRecentMessages { .. } => recent,
            Self::SearchLog { .. } => search,
            Self::ProposeCommand { .. } => propose,
            Self::ListGuardAlerts { .. } => alerts,
            Self::GetExternalFactors => factors,
        }
    }

    /// The vehicle the call is about, if any (audit `sysid`).
    pub fn sysid(&self) -> Option<SysId> {
        match self {
            Self::GetVehicleStatus { sysid } | Self::ProposeCommand { sysid, .. } => Some(*sysid),
            Self::ListRecentMessages { sysid, .. }
            | Self::SearchLog { sysid, .. }
            | Self::ListGuardAlerts { sysid } => *sysid,
            Self::ListVehicles | Self::GetExternalFactors => None,
        }
    }
}

/// A tool failure returned to the LLM as `{error: code, message}`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ToolError {
    pub code: &'static str,
    pub message: String,
}

impl ToolError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    fn invalid(message: impl Into<String>) -> Self {
        Self::new("invalid", message)
    }
}

impl fmt::Display for ToolError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for ToolError {}

/// Parse and bound-check one tool call from the LLM.
pub fn parse_call(name: &str, input: &Value) -> Result<ToolCall, ToolError> {
    if !TOOL_NAMES.contains(&name) {
        return Err(ToolError::new("unknown_tool", format!("no tool named {name}")));
    }
    let empty = Map::new();
    let args = match input {
        Value::Object(map) => map,
        Value::Null => &empty,
        _ => return Err(ToolError::invalid("input must be a JSON object")),
    };
    match name {
        "get_vehicle_status" => Ok(ToolCall::GetVehicleStatus {
            sysid: required_sysid(args)?,
        }),
        "list_vehicles" => Ok(ToolCall::ListVehicles),
        "list_recent_messages" => parse_recent(args),
        "search_log" => parse_search(args),
        "list_guard_alerts" => Ok(ToolCall::ListGuardAlerts {
            sysid: optional_sysid(args)?,
        }),
        "get_external_factors" => Ok(ToolCall::GetExternalFactors),
        _ => parse_propose(args),
    }
}

fn parse_recent(args: &Map<String, Value>) -> Result<ToolCall, ToolError> {
    let limit = match args.get("limit") {
        None | Some(Value::Null) => DEFAULT_MESSAGE_LIMIT,
        Some(v) => v
            .as_u64()
            .filter(|n| (1..=u64::from(MAX_MESSAGE_LIMIT)).contains(n))
            .map(|n| n as u32)
            .ok_or_else(|| ToolError::invalid("limit must be an integer 1 to 50"))?,
    };
    Ok(ToolCall::ListRecentMessages {
        sysid: optional_sysid(args)?,
        limit,
    })
}

fn parse_search(args: &Map<String, Value>) -> Result<ToolCall, ToolError> {
    let query = args
        .get("query")
        .and_then(Value::as_str)
        .filter(|q| !q.trim().is_empty() && q.chars().count() <= MAX_QUERY_CHARS)
        .ok_or_else(|| ToolError::invalid("query must be 1 to 100 characters"))?;
    let since = match args.get("since") {
        None | Some(Value::Null) => None,
        Some(v) => Some(
            v.as_i64()
                .ok_or_else(|| ToolError::invalid("since must be unix milliseconds"))?,
        ),
    };
    Ok(ToolCall::SearchLog {
        query: query.to_string(),
        sysid: optional_sysid(args)?,
        since,
    })
}

fn parse_propose(args: &Map<String, Value>) -> Result<ToolCall, ToolError> {
    let sysid = required_sysid(args)?;
    let raw = args
        .get("command")
        .filter(|c| c.is_object())
        .ok_or_else(|| ToolError::invalid("command must be an object {cmd, args}"))?;
    let cmd = raw.get("cmd").and_then(Value::as_str).unwrap_or_default();
    if cmd == "other" {
        return Err(ToolError::new(
            "not_allowed",
            "raw MAV_CMD commands cannot be proposed",
        ));
    }
    let command: VehicleCommand = serde_json::from_value(raw.clone())
        .map_err(|_| ToolError::invalid(format!("unknown command or bad args for {cmd:?}")))?;
    let reason = args
        .get("reason")
        .and_then(Value::as_str)
        .filter(|r| !r.trim().is_empty() && r.chars().count() <= MAX_REASON_CHARS)
        .ok_or_else(|| ToolError::invalid("reason must be 1 to 500 characters"))?;
    Ok(ToolCall::ProposeCommand {
        sysid,
        command,
        reason: reason.to_string(),
    })
}

fn required_sysid(args: &Map<String, Value>) -> Result<SysId, ToolError> {
    optional_sysid(args)?.ok_or_else(|| ToolError::invalid("sysid is required"))
}

fn optional_sysid(args: &Map<String, Value>) -> Result<Option<SysId>, ToolError> {
    match args.get("sysid") {
        None | Some(Value::Null) => Ok(None),
        Some(v) => v
            .as_u64()
            .filter(|n| (1..=255).contains(n))
            .map(|n| Some(n as SysId))
            .ok_or_else(|| ToolError::invalid("sysid must be an integer 1 to 255")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rgcs_core::VehicleCommand;
    use serde_json::json;

    fn code(r: Result<ToolCall, ToolError>) -> &'static str {
        r.unwrap_err().code
    }

    #[test]
    fn specs_follow_tool_names_and_are_objects() {
        let specs = tool_specs();
        let names: Vec<&str> = specs.iter().map(|s| s.name).collect();
        assert_eq!(names, TOOL_NAMES);
        for s in &specs {
            assert_eq!(s.schema["type"], "object", "{}", s.name);
            assert!(!s.description.is_empty());
        }
    }

    #[test]
    fn propose_schema_lists_only_allowed_commands() {
        let spec = tool_specs()
            .into_iter()
            .find(|s| s.name == "propose_command")
            .unwrap();
        let cmds = &spec.schema["properties"]["command"]["properties"]["cmd"]["enum"];
        let list: Vec<&str> = cmds
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_str().unwrap())
            .collect();
        assert_eq!(list, PROPOSABLE_COMMANDS);
        assert!(!list.contains(&"other") && !list.contains(&"change_alt"));
    }

    #[test]
    fn parses_propose_command() {
        let input = json!({"sysid":3,"command":{"cmd":"set_mode","args":{"mode":"loiter"}},"reason":"hold"});
        assert_eq!(
            parse_call("propose_command", &input).unwrap(),
            ToolCall::ProposeCommand {
                sysid: 3,
                command: VehicleCommand::SetMode {
                    mode: "loiter".into()
                },
                reason: "hold".into(),
            }
        );
        let unit = json!({"sysid":3,"command":{"cmd":"rtl"},"reason":"battery"});
        assert!(matches!(
            parse_call("propose_command", &unit).unwrap(),
            ToolCall::ProposeCommand {
                command: VehicleCommand::Rtl,
                ..
            }
        ));
    }

    #[test]
    fn propose_other_is_not_allowed() {
        let input = json!({"sysid":3,"command":{"cmd":"other","args":{"mav_cmd":400,"params":[0,0,0,0,0,0,0]}},"reason":"x"});
        assert_eq!(code(parse_call("propose_command", &input)), "not_allowed");
    }

    #[test]
    fn propose_rejects_bad_input() {
        let long = "a".repeat(501);
        let bad = [
            json!({"sysid":3,"command":{"cmd":"rtl"},"reason":long}),
            json!({"sysid":3,"command":{"cmd":"rtl"},"reason":""}),
            json!({"sysid":3,"command":{"cmd":"rtl"}}),
            json!({"sysid":0,"command":{"cmd":"rtl"},"reason":"x"}),
            json!({"sysid":300,"command":{"cmd":"rtl"},"reason":"x"}),
            json!({"sysid":3,"command":{"cmd":"fly_away"},"reason":"x"}),
            json!({"sysid":3,"command":{"cmd":"set_mode"},"reason":"x"}),
            json!({"sysid":3,"reason":"x"}),
        ];
        for input in bad {
            assert_eq!(code(parse_call("propose_command", &input)), "invalid", "{input}");
        }
        let ok = json!({"sysid":3,"command":{"cmd":"rtl"},"reason":"a".repeat(500)});
        assert!(parse_call("propose_command", &ok).is_ok());
    }

    #[test]
    fn list_recent_messages_limits() {
        for limit in [0, 51] {
            let r = parse_call("list_recent_messages", &json!({"limit": limit}));
            assert_eq!(code(r), "invalid", "{limit}");
        }
        assert_eq!(
            parse_call("list_recent_messages", &json!({})).unwrap(),
            ToolCall::ListRecentMessages {
                sysid: None,
                limit: 20
            }
        );
        assert_eq!(
            parse_call("list_recent_messages", &json!({"sysid": 2, "limit": 50})).unwrap(),
            ToolCall::ListRecentMessages {
                sysid: Some(2),
                limit: 50
            }
        );
        assert_eq!(
            code(parse_call("list_recent_messages", &json!({"limit": "5"}))),
            "invalid"
        );
    }

    #[test]
    fn search_log_query_bounds() {
        assert_eq!(code(parse_call("search_log", &json!({"query": ""}))), "invalid");
        let long = "x".repeat(101);
        assert_eq!(code(parse_call("search_log", &json!({"query": long}))), "invalid");
        assert_eq!(code(parse_call("search_log", &json!({}))), "invalid");
        let jp = "電".repeat(100);
        assert!(parse_call("search_log", &json!({"query": jp})).is_ok());
        assert_eq!(
            parse_call(
                "search_log",
                &json!({"query": "EKF", "sysid": 3, "since": 1700000000000_i64})
            )
            .unwrap(),
            ToolCall::SearchLog {
                query: "EKF".into(),
                sysid: Some(3),
                since: Some(1_700_000_000_000)
            }
        );
    }

    #[test]
    fn status_and_list_vehicles() {
        assert_eq!(
            parse_call("get_vehicle_status", &json!({"sysid": 3})).unwrap(),
            ToolCall::GetVehicleStatus { sysid: 3 }
        );
        assert_eq!(code(parse_call("get_vehicle_status", &json!({}))), "invalid");
        assert_eq!(
            parse_call("list_vehicles", &json!({})).unwrap(),
            ToolCall::ListVehicles
        );
        assert_eq!(
            parse_call("list_vehicles", &serde_json::Value::Null).unwrap(),
            ToolCall::ListVehicles
        );
        assert_eq!(code(parse_call("list_vehicles", &json!([1]))), "invalid");
    }

    #[test]
    fn seven_tools_in_order() {
        let names: Vec<&str> = tool_specs().iter().map(|s| s.name).collect();
        assert_eq!(
            names,
            [
                "get_vehicle_status",
                "list_vehicles",
                "list_recent_messages",
                "search_log",
                "propose_command",
                "list_guard_alerts",
                "get_external_factors",
            ]
        );
    }

    #[test]
    fn guard_and_env_tools_parse() {
        assert_eq!(
            parse_call("list_guard_alerts", &json!({})).unwrap(),
            ToolCall::ListGuardAlerts { sysid: None }
        );
        assert_eq!(
            parse_call("list_guard_alerts", &json!({"sysid": 2})).unwrap(),
            ToolCall::ListGuardAlerts { sysid: Some(2) }
        );
        assert_eq!(
            code(parse_call("list_guard_alerts", &json!({"sysid": 300}))),
            "invalid"
        );
        assert_eq!(
            code(parse_call("list_guard_alerts", &json!({"sysid": "1"}))),
            "invalid"
        );
        assert_eq!(
            parse_call("get_external_factors", &json!({})).unwrap(),
            ToolCall::GetExternalFactors
        );
        assert_eq!(
            parse_call("get_external_factors", &serde_json::Value::Null).unwrap(),
            ToolCall::GetExternalFactors
        );
        let names = [
            ToolCall::ListGuardAlerts { sysid: Some(4) }.name(),
            ToolCall::GetExternalFactors.name(),
        ];
        assert_eq!(names, ["list_guard_alerts", "get_external_factors"]);
        assert_eq!(ToolCall::ListGuardAlerts { sysid: Some(4) }.sysid(), Some(4));
        assert_eq!(ToolCall::GetExternalFactors.sysid(), None);
    }

    #[test]
    fn guard_and_env_descriptions_say_what_the_data_is() {
        let specs = tool_specs();
        let find = |n: &str| specs.iter().find(|s| s.name == n).unwrap().description;
        let alerts = find("list_guard_alerts");
        assert!(
            alerts.contains("deterministic") && alerts.contains("cannot"),
            "{alerts}"
        );
        let env = find("get_external_factors");
        assert!(env.contains("source") && env.contains("at_ms"), "{env}");
    }

    #[test]
    fn unknown_tool() {
        assert_eq!(code(parse_call("send_command", &json!({}))), "unknown_tool");
    }
}
