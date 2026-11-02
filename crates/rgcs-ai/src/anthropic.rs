//! Anthropic Messages API adapter (`POST {base_url}/v1/messages`, non-streaming).
//!
//! Assistant `thinking` and unknown blocks are kept as `Block::Opaque` and replayed unchanged.

use std::time::Duration;

use async_trait::async_trait;
use serde_json::{json, Map, Value};

use crate::config::{ResolvedAi, Secret};
use crate::llm::{self, AiError, Block, LlmClient, LlmRequest, LlmResponse, Role, Stop, Turn, Usage};
use crate::tools::{tool_specs, ToolSpec};

pub const ANTHROPIC_VERSION: &str = "2023-06-01";

pub struct AnthropicClient {
    http: reqwest::Client,
    url: String,
    model: String,
    key: Secret,
    effort: String,
    timeout: Duration,
}

impl AnthropicClient {
    pub fn new(r: &ResolvedAi) -> Self {
        Self {
            http: llm::http_client(),
            url: llm::endpoint(&r.base_url, "/v1/messages"),
            model: r.model.clone(),
            key: r.key.clone().unwrap_or_else(|| Secret::new("")),
            effort: r.effort.clone(),
            timeout: r.limits.request_timeout,
        }
    }
}

#[async_trait]
impl LlmClient for AnthropicClient {
    async fn complete(&self, req: LlmRequest<'_>) -> Result<LlmResponse, AiError> {
        let body = request_body(&self.model, &self.effort, &req);
        let http = self
            .http
            .post(&self.url)
            .timeout(self.timeout)
            .header("x-api-key", self.key.expose())
            .header("anthropic-version", ANTHROPIC_VERSION)
            .json(&body);
        parse_response(&llm::send_json(http, "anthropic").await?)
    }
}

fn tool_json(spec: &ToolSpec) -> Value {
    json!({"name": spec.name, "description": spec.description, "input_schema": spec.schema})
}

fn has_tool_blocks(turns: &[Turn]) -> bool {
    turns
        .iter()
        .flat_map(|t| &t.blocks)
        .any(|b| matches!(b, Block::ToolUse { .. } | Block::ToolResult { .. }))
}

/// The request body. With `tools: None` and tool blocks in the history the tools stay
/// defined (the API rejects tool blocks otherwise) and `tool_choice: none` forces text.
fn request_body(model: &str, effort: &str, req: &LlmRequest<'_>) -> Value {
    let mut body = Map::new();
    body.insert("model".into(), json!(model));
    body.insert("max_tokens".into(), json!(req.max_tokens));
    body.insert("system".into(), json!(req.system));
    body.insert("messages".into(), req.turns.iter().map(turn_json).collect());
    body.insert("output_config".into(), json!({"effort": effort}));
    match req.tools {
        Some(specs) => {
            body.insert("tools".into(), specs.iter().map(tool_json).collect());
        }
        None if has_tool_blocks(req.turns) => {
            body.insert("tools".into(), tool_specs().iter().map(tool_json).collect());
            body.insert("tool_choice".into(), json!({"type": "none"}));
        }
        None => {}
    }
    Value::Object(body)
}

fn turn_json(turn: &Turn) -> Value {
    let role = match turn.role {
        Role::User => "user",
        Role::Assistant => "assistant",
    };
    json!({"role": role, "content": turn.blocks.iter().map(block_json).collect::<Vec<_>>()})
}

fn block_json(block: &Block) -> Value {
    match block {
        Block::Text(text) => json!({"type": "text", "text": text}),
        Block::ToolUse { id, name, input } => {
            json!({"type": "tool_use", "id": id, "name": name, "input": input})
        }
        Block::ToolResult {
            tool_use_id,
            content,
            is_error,
        } => json!({
            "type": "tool_result", "tool_use_id": tool_use_id, "content": content, "is_error": is_error
        }),
        Block::Opaque(value) => value.clone(),
    }
}

fn parse_block(value: &Value) -> Result<Block, AiError> {
    match value["type"].as_str() {
        Some("text") => Ok(Block::Text(
            value["text"].as_str().ok_or(AiError::Malformed)?.to_owned(),
        )),
        Some("tool_use") => Ok(Block::ToolUse {
            id: value["id"].as_str().ok_or(AiError::Malformed)?.to_owned(),
            name: value["name"].as_str().ok_or(AiError::Malformed)?.to_owned(),
            input: value.get("input").cloned().unwrap_or_else(|| json!({})),
        }),
        Some(_) => Ok(Block::Opaque(value.clone())),
        None => Err(AiError::Malformed),
    }
}

fn parse_stop(stop: Option<&str>) -> Result<Stop, AiError> {
    match stop {
        Some("tool_use") => Ok(Stop::ToolUse),
        Some("end_turn") => Ok(Stop::EndTurn),
        Some("max_tokens") => Ok(Stop::MaxTokens),
        Some("refusal") => Err(AiError::Refused),
        other => {
            tracing::warn!(
                stop_reason = other.unwrap_or("missing"),
                "unexpected anthropic stop_reason"
            );
            Err(AiError::Malformed)
        }
    }
}

fn parse_response(body: &Value) -> Result<LlmResponse, AiError> {
    let content = body["content"].as_array().ok_or(AiError::Malformed)?;
    let stop = parse_stop(body["stop_reason"].as_str())?;
    let blocks = content.iter().map(parse_block).collect::<Result<Vec<_>, _>>()?;
    let usage = &body["usage"];
    let input = llm::token(usage, "input_tokens")
        + llm::token(usage, "cache_creation_input_tokens")
        + llm::token(usage, "cache_read_input_tokens");
    Ok(LlmResponse {
        blocks,
        stop,
        usage: Usage {
            input,
            output: llm::token(usage, "output_tokens"),
        },
    })
}
