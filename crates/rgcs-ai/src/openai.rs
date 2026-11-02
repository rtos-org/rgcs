//! OpenAI-compatible chat completions adapter (`POST {base_url}/chat/completions`, e.g. Ollama).
//!
//! Opaque blocks are dropped; tool results go back as `role: "tool"` messages.

use std::time::Duration;

use async_trait::async_trait;
use serde_json::{json, Map, Value};

use crate::config::{ResolvedAi, Secret};
use crate::llm::{
    self, AiError, Block, LlmClient, LlmRequest, LlmResponse, Role, Stop, Turn, Usage, INVALID_JSON_KEY,
};
use crate::tools::ToolSpec;

pub struct OpenAiClient {
    http: reqwest::Client,
    url: String,
    model: String,
    key: Option<Secret>,
    timeout: Duration,
}

impl OpenAiClient {
    pub fn new(r: &ResolvedAi) -> Self {
        Self {
            http: llm::http_client(),
            url: llm::endpoint(&r.base_url, "/chat/completions"),
            model: r.model.clone(),
            key: r.key.clone(),
            timeout: r.limits.request_timeout,
        }
    }
}

#[async_trait]
impl LlmClient for OpenAiClient {
    async fn complete(&self, req: LlmRequest<'_>) -> Result<LlmResponse, AiError> {
        let body = request_body(&self.model, &req);
        let http = self.http.post(&self.url).timeout(self.timeout).json(&body);
        let http = match &self.key {
            Some(key) => http.bearer_auth(key.expose()),
            None => http,
        };
        parse_response(&llm::send_json(http, "openai_compat").await?)
    }
}

fn tool_json(spec: &ToolSpec) -> Value {
    json!({"type": "function", "function": {
        "name": spec.name, "description": spec.description, "parameters": spec.schema
    }})
}

fn request_body(model: &str, req: &LlmRequest<'_>) -> Value {
    let system = json!({"role": "system", "content": req.system});
    let messages: Vec<Value> = std::iter::once(system)
        .chain(req.turns.iter().flat_map(turn_messages))
        .collect();
    let mut body = Map::new();
    body.insert("model".into(), json!(model));
    body.insert("max_tokens".into(), json!(req.max_tokens));
    body.insert("messages".into(), Value::Array(messages));
    if let Some(specs) = req.tools {
        body.insert("tools".into(), specs.iter().map(tool_json).collect());
    }
    Value::Object(body)
}

fn turn_messages(turn: &Turn) -> Vec<Value> {
    match turn.role {
        Role::User => turn.blocks.iter().filter_map(user_message).collect(),
        Role::Assistant => vec![assistant_message(&turn.blocks)],
    }
}

fn user_message(block: &Block) -> Option<Value> {
    match block {
        Block::Text(text) => Some(json!({"role": "user", "content": text})),
        Block::ToolResult {
            tool_use_id, content, ..
        } => Some(json!({"role": "tool", "tool_call_id": tool_use_id, "content": content})),
        Block::ToolUse { .. } | Block::Opaque(_) => None,
    }
}

/// Arguments as the model sent them: invalid JSON is replayed as its original string.
fn arguments_text(input: &Value) -> String {
    match input.as_object() {
        Some(map) if map.len() == 1 => match map.get(INVALID_JSON_KEY).and_then(Value::as_str) {
            Some(raw) => raw.to_owned(),
            None => input.to_string(),
        },
        _ => input.to_string(),
    }
}

fn assistant_message(blocks: &[Block]) -> Value {
    let texts: Vec<&str> = blocks
        .iter()
        .filter_map(|b| match b {
            Block::Text(t) => Some(t.as_str()),
            _ => None,
        })
        .collect();
    let calls: Vec<Value> = blocks
        .iter()
        .filter_map(|b| match b {
            Block::ToolUse { id, name, input } => Some(json!({
                "id": id, "type": "function", "function": {"name": name, "arguments": arguments_text(input)}
            })),
            _ => None,
        })
        .collect();
    let content = if texts.is_empty() {
        Value::Null
    } else {
        json!(texts.join("\n"))
    };
    let content = if content.is_null() && calls.is_empty() {
        json!("")
    } else {
        content
    };
    let mut msg = Map::new();
    msg.insert("role".into(), json!("assistant"));
    msg.insert("content".into(), content);
    if !calls.is_empty() {
        msg.insert("tool_calls".into(), Value::Array(calls));
    }
    Value::Object(msg)
}

/// Arguments arrive as a JSON string; an object (some servers) is taken as-is.
fn parse_arguments(raw: &Value) -> Value {
    match raw {
        Value::String(s) if s.trim().is_empty() => json!({}),
        Value::String(s) => serde_json::from_str(s).unwrap_or_else(|_| json!({ INVALID_JSON_KEY: s })),
        Value::Null => json!({}),
        other => other.clone(),
    }
}

fn parse_call(call: &Value) -> Result<Block, AiError> {
    let function = &call["function"];
    Ok(Block::ToolUse {
        id: call["id"].as_str().ok_or(AiError::Malformed)?.to_owned(),
        name: function["name"].as_str().ok_or(AiError::Malformed)?.to_owned(),
        input: parse_arguments(&function["arguments"]),
    })
}

/// `length` wins; tool calls mean tool use even when a server reports `stop` with them.
fn parse_stop(finish: Option<&str>, has_calls: bool) -> Result<Stop, AiError> {
    match finish {
        Some("length") => Ok(Stop::MaxTokens),
        _ if has_calls => Ok(Stop::ToolUse),
        Some("stop") => Ok(Stop::EndTurn),
        Some("content_filter") => Err(AiError::Refused),
        other => {
            tracing::warn!(
                finish_reason = other.unwrap_or("missing"),
                "unexpected openai finish_reason"
            );
            Err(AiError::Malformed)
        }
    }
}

fn parse_response(body: &Value) -> Result<LlmResponse, AiError> {
    let choice = body["choices"].get(0).ok_or(AiError::Malformed)?;
    let message = choice
        .get("message")
        .filter(|m| m.is_object())
        .ok_or(AiError::Malformed)?;
    let calls = message["tool_calls"].as_array().map(Vec::as_slice).unwrap_or(&[]);
    let stop = parse_stop(choice["finish_reason"].as_str(), !calls.is_empty())?;
    let text = message["content"]
        .as_str()
        .filter(|t| !t.is_empty())
        .map(|t| Block::Text(t.to_owned()));
    let tool_blocks = calls.iter().map(parse_call).collect::<Result<Vec<_>, _>>()?;
    let usage = &body["usage"];
    Ok(LlmResponse {
        blocks: text.into_iter().chain(tool_blocks).collect(),
        stop,
        usage: Usage {
            input: llm::token(usage, "prompt_tokens"),
            output: llm::token(usage, "completion_tokens"),
        },
    })
}
