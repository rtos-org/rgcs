//! AI chat wire types. The agent only proposes commands;
//! the operator's 実行 press sends them through the normal command path.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::command::VehicleCommand;
use crate::vehicle::SysId;

/// Which wire protocol the configured LLM speaks.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, rename_all = "snake_case")]
pub enum AiProviderKind {
    Anthropic,
    OpenaiCompat,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AiStatus {
    pub configured: bool,
    pub provider: Option<AiProviderKind>,
    pub model: Option<String>,
    /// "disabled" | "no_api_key" when not configured.
    pub reason: Option<String>,
    #[ts(type = "number | null")]
    pub budget_left: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AiChatRequest {
    pub sysid: SysId,
    pub message: String,
    pub conversation_id: Option<String>,
}

/// Video state of the target vehicle as the server sees it (no frame age is available).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, rename_all = "snake_case")]
pub enum AiVideoState {
    Live,
    Checking,
    Down,
    None,
}

/// The tool card's key-value grid, built from the last `get_vehicle_status` call.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AiStatusCard {
    pub sysid: SysId,
    pub name: String,
    #[ts(type = "number | null")]
    pub last_rx_age_ms: Option<u64>,
    pub video: AiVideoState,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AiToolRun {
    pub tool: String,
    pub sysid: Option<SysId>,
    pub ok: bool,
    pub error: Option<String>,
    #[ts(type = "number")]
    pub ts: u64,
}

/// A validated command the AI suggests. Nothing is sent until the operator presses 実行.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AiProposal {
    pub id: String,
    pub sysid: SysId,
    pub vehicle_name: String,
    pub command: VehicleCommand,
    pub reason: String,
    pub requires_confirm: bool,
    #[ts(type = "number")]
    pub created_ms: u64,
    #[ts(type = "number")]
    pub expires_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct AiChatReply {
    pub conversation_id: String,
    pub reply: String,
    pub tool_runs: Vec<AiToolRun>,
    pub status_card: Option<AiStatusCard>,
    pub proposals: Vec<AiProposal>,
    pub truncated: bool,
    #[ts(type = "number")]
    pub ts: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reply() -> AiChatReply {
        AiChatReply {
            conversation_id: "c1".into(),
            reply: "ok".into(),
            tool_runs: vec![],
            status_card: None,
            proposals: vec![AiProposal {
                id: "p-1".into(),
                sysid: 3,
                vehicle_name: "UAV-03".into(),
                command: VehicleCommand::SetMode {
                    mode: "LOITER".into(),
                },
                reason: "hold".into(),
                requires_confirm: false,
                created_ms: 1,
                expires_ms: 2,
            }],
            truncated: false,
            ts: 3,
        }
    }

    #[test]
    fn proposal_command_serializes_tagged() {
        let json = serde_json::to_string(&reply()).unwrap();
        assert!(
            json.contains(r#""command":{"cmd":"set_mode","args":{"mode":"LOITER"}}"#),
            "{json}"
        );
    }

    #[test]
    fn enums_are_snake_case() {
        assert_eq!(serde_json::to_string(&AiVideoState::Live).unwrap(), r#""live""#);
        assert_eq!(
            serde_json::to_string(&AiProviderKind::OpenaiCompat).unwrap(),
            r#""openai_compat""#
        );
    }
}
