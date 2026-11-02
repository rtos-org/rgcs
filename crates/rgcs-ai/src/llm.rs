//! Provider-neutral conversation types, the `LlmClient` trait and the shared HTTP plumbing.
//!
//! Secrets never reach an `AiError`: errors carry only the HTTP status and the provider's
//! own error `message` (capped), never a `reqwest::Error`, headers or a whole body.

use async_trait::async_trait;
use serde_json::Value;

use crate::anthropic::AnthropicClient;
use crate::config::{ProviderKind, ResolvedAi};
use crate::openai::OpenAiClient;
use crate::tools::ToolSpec;

/// `max_tokens` of every LLM call (fixed-values table).
pub const DEFAULT_MAX_TOKENS: u32 = 4096;
/// Longest provider error message kept in `AiError::Provider`.
pub const MAX_ERROR_MESSAGE_CHARS: usize = 200;
/// Marker key for OpenAI tool-call arguments that were not valid JSON.
pub const INVALID_JSON_KEY: &str = "__invalid_json";

#[derive(Debug, Clone, PartialEq)]
pub enum Block {
    Text(String),
    ToolUse {
        id: String,
        name: String,
        input: Value,
    },
    ToolResult {
        tool_use_id: String,
        content: String,
        is_error: bool,
    },
    /// Thinking and unknown blocks: replayed verbatim (Anthropic), dropped (OpenAI).
    Opaque(Value),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Role {
    User,
    Assistant,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Turn {
    pub role: Role,
    pub blocks: Vec<Block>,
}

#[derive(Debug, Clone, Copy)]
pub struct LlmRequest<'a> {
    pub system: &'a str,
    pub turns: &'a [Turn],
    /// `None` forces a text answer (the loop's final call).
    pub tools: Option<&'a [ToolSpec]>,
    pub max_tokens: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Stop {
    EndTurn,
    ToolUse,
    MaxTokens,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Usage {
    pub input: u64,
    pub output: u64,
}

impl Usage {
    pub fn total(&self) -> u64 {
        self.input + self.output
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct LlmResponse {
    pub blocks: Vec<Block>,
    pub stop: Stop,
    pub usage: Usage,
}

#[derive(Debug, thiserror::Error)]
pub enum AiError {
    #[error("provider timed out")]
    Timeout,
    #[error("provider refused the request")]
    Refused,
    /// `message` is at most 200 chars, taken from the error JSON's `message` field only.
    #[error("provider error {status}: {message}")]
    Provider { status: u16, message: String },
    #[error("provider unreachable")]
    Unreachable,
    #[error("unexpected provider response")]
    Malformed,
}

#[async_trait]
pub trait LlmClient: Send + Sync {
    async fn complete(&self, req: LlmRequest<'_>) -> Result<LlmResponse, AiError>;
}

/// The adapter for the configured wire protocol.
pub fn client_for(r: &ResolvedAi) -> Box<dyn LlmClient> {
    match r.kind {
        ProviderKind::Anthropic => Box::new(AnthropicClient::new(r)),
        // `ProviderKind::None` never resolves (`Unconfigured::Disabled`).
        ProviderKind::OpenaiCompat | ProviderKind::None => Box::new(OpenAiClient::new(r)),
    }
}

/// The HTTP client of both adapters. Redirects are never followed: reqwest would resend the
/// `x-api-key` header to the redirect target, so a 3xx is a provider error instead.
/// Panics like `reqwest::Client::new` when the TLS backend cannot start (never falls back to a
/// client that follows redirects).
pub(crate) fn http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .expect("the HTTP client (TLS backend) failed to initialise")
}

/// `base_url` + `path` without a doubled slash.
pub(crate) fn endpoint(base_url: &str, path: &str) -> String {
    format!("{}{path}", base_url.trim_end_matches('/'))
}

/// Sends a prepared JSON request and returns the success body.
pub(crate) async fn send_json(
    req: reqwest::RequestBuilder,
    provider: &'static str,
) -> Result<Value, AiError> {
    let resp = req.send().await.map_err(map_transport)?;
    let status = resp.status();
    let bytes = resp.bytes().await.map_err(map_transport)?;
    if !status.is_success() {
        return Err(provider_error(status, &bytes, provider));
    }
    serde_json::from_slice(&bytes).map_err(|_| AiError::Malformed)
}

/// Never formats the `reqwest::Error` itself.
fn map_transport(e: reqwest::Error) -> AiError {
    if e.is_timeout() {
        AiError::Timeout
    } else {
        AiError::Unreachable
    }
}

fn provider_error(status: reqwest::StatusCode, body: &[u8], provider: &'static str) -> AiError {
    let parsed: Value = serde_json::from_slice(body).unwrap_or(Value::Null);
    let error = &parsed["error"];
    let error_type = error["type"].as_str().unwrap_or("unknown");
    let message = error["message"]
        .as_str()
        .or_else(|| error.as_str())
        .or_else(|| status.canonical_reason())
        .unwrap_or("");
    tracing::warn!(
        provider,
        status = status.as_u16(),
        error_type,
        "llm provider error"
    );
    AiError::Provider {
        status: status.as_u16(),
        message: message.chars().take(MAX_ERROR_MESSAGE_CHARS).collect(),
    }
}

/// Input / output token counts from a usage object, 0 when missing.
pub(crate) fn token(usage: &Value, key: &str) -> u64 {
    usage[key].as_u64().unwrap_or(0)
}
