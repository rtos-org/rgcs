//! RGCS AI assistant: config, LLM adapters, tool definitions and the system prompt.
//! Knows nothing about the server state (axum only backs the `fake` test server); the server
//! implements the tool host.

pub mod agent;
pub mod anthropic;
pub mod config;
pub mod llm;
pub mod openai;
pub mod prompt;
#[cfg(feature = "fake")]
pub mod testing;
mod tool_schemas;
pub mod tools;

pub use agent::{run_turn, ToolHost, ToolRunRecord, TurnInput, TurnOutput, TRUNCATED_REPLY};
pub use config::{AiConfig, Limits, ProviderKind, ResolvedAi, Secret, Unconfigured, MAX_TOOL_ITERATIONS};
pub use llm::{
    client_for, AiError, Block, LlmClient, LlmRequest, LlmResponse, Role, Stop, Turn, Usage,
    DEFAULT_MAX_TOKENS,
};
pub use prompt::SYSTEM_PROMPT;
pub use tools::{parse_call, tool_specs, ToolCall, ToolError, ToolSpec, PROPOSABLE_COMMANDS, TOOL_NAMES};
