//! The bounded tool-use loop (review focus 3 and 4).
//!
//! At most `limits.max_iterations` LLM calls may end in tool use; one more call is then sent
//! without tools to force a text answer. Usage is summed over every call, the forced one
//! included, and the loop stops once it exceeds `limits.max_tokens_per_chat`.
//!
//! `new_turns` never ends with a `tool_use` that lacks its `tool_result`: when the loop stops
//! on a tool-use response, each call gets an error result and a fixed assistant text closes
//! the turn. Tool output reaches the model only as tool-result JSON text. At most
//! `MAX_TOOL_CALLS_PER_RESPONSE` calls of one response and `MAX_TOOL_CALLS_PER_TURN` calls of
//! one turn are run.

use std::time::{SystemTime, UNIX_EPOCH};

use async_trait::async_trait;
use rgcs_core::SysId;
use serde_json::{json, Value};

use crate::config::Limits;
use crate::llm::{
    AiError, Block, LlmClient, LlmRequest, Role, Stop, Turn, Usage, DEFAULT_MAX_TOKENS, INVALID_JSON_KEY,
};
use crate::prompt::SYSTEM_PROMPT;
use crate::tools::{parse_call, tool_specs, ToolCall, ToolError, ToolSpec};

/// The reply when the iteration or token cap ends the loop without a text answer.
pub const TRUNCATED_REPLY: &str = "上限に達したため途中で終了しました";
/// Stored and shown in place of an assistant reply with no text (`content: []`, `""`): an
/// empty assistant message in the history makes every later Anthropic request a 400.
pub const EMPTY_REPLY: &str = "(応答が空でした)";
/// Longest tool-result text sent to the model (chars).
pub const MAX_TOOL_RESULT_CHARS: usize = 8_000;
/// Tool calls run per LLM response; the rest get a `too_many_tool_calls` error result.
pub const MAX_TOOL_CALLS_PER_RESPONSE: usize = 8;
/// Tool calls run per operator message, over all responses.
pub const MAX_TOOL_CALLS_PER_TURN: usize = 16;
/// Longest tool name kept in a `ToolRunRecord` (the model may send anything).
const MAX_RECORDED_NAME_CHARS: usize = 64;

#[async_trait]
pub trait ToolHost: Send + Sync {
    /// Runs one parsed call; Ok = JSON result for the model, Err = tool error (sent with is_error).
    async fn run(&self, call: &ToolCall) -> Result<Value, ToolError>;
}

pub struct TurnInput<'a> {
    pub history: &'a [Turn],
    pub user_text: String,
    pub limits: &'a Limits,
}

#[derive(Debug, Clone, PartialEq)]
pub struct ToolRunRecord {
    pub name: String,
    pub sysid: Option<SysId>,
    pub ok: bool,
    /// The tool error code when `!ok`.
    pub error: Option<String>,
    /// The host's JSON result when `ok`.
    pub result: Option<Value>,
    /// Unix ms when the call finished.
    pub ts: u64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct TurnOutput {
    /// The user turn + every assistant / tool-result turn, to append on success.
    pub new_turns: Vec<Turn>,
    /// The final assistant text blocks joined by "\n".
    pub reply: String,
    pub runs: Vec<ToolRunRecord>,
    pub usage: Usage,
    pub truncated: bool,
    /// Tokens the history will cost to replay: the last call's input + output as reported
    /// (0 when the provider reports no usage). The hub refuses a conversation once it is too
    /// costly for the per-chat cap.
    pub context: u64,
}

/// Runs one operator message to its final answer. Errors from the LLM are returned as is;
/// the caller then appends nothing to the conversation.
pub async fn run_turn(
    llm: &dyn LlmClient,
    host: &dyn ToolHost,
    input: TurnInput<'_>,
) -> Result<TurnOutput, AiError> {
    let specs = tool_specs();
    let start = input.history.len();
    let mut turns = input.history.to_vec();
    turns.push(Turn {
        role: Role::User,
        blocks: vec![Block::Text(input.user_text)],
    });
    let mut runs = Vec::new();
    let mut usage = Usage::default();
    let mut call = 0;
    loop {
        let tools = (call < input.limits.max_iterations).then_some(specs.as_slice());
        let resp = complete(llm, &turns, tools).await?;
        let context = resp.usage.total();
        usage = Usage {
            input: usage.input + resp.usage.input,
            output: usage.output + resp.usage.output,
        };
        let uses = tool_uses(&resp.blocks);
        let stop = resp.stop;
        turns.push(Turn {
            role: Role::Assistant,
            blocks: storable(resp.blocks, uses.is_empty()),
        });
        if uses.is_empty() {
            let truncated = stop == Stop::MaxTokens;
            return Ok(finish(turns.split_off(start), runs, (usage, context), truncated));
        }
        if tools.is_none() || usage.total() > input.limits.max_tokens_per_chat {
            turns.extend(close_unrun(&uses));
            return Ok(finish(turns.split_off(start), runs, (usage, context), true));
        }
        let allowed = MAX_TOOL_CALLS_PER_RESPONSE.min(MAX_TOOL_CALLS_PER_TURN.saturating_sub(runs.len()));
        let (results, records) = run_tools(host, &uses, allowed).await;
        turns.push(results);
        runs.extend(records);
        call += 1;
    }
}

async fn complete(
    llm: &dyn LlmClient,
    turns: &[Turn],
    tools: Option<&[ToolSpec]>,
) -> Result<crate::llm::LlmResponse, AiError> {
    llm.complete(LlmRequest {
        system: SYSTEM_PROMPT,
        turns,
        tools,
        max_tokens: DEFAULT_MAX_TOKENS,
    })
    .await
}

/// A `tool_use` block of the latest response: (id, name, input).
struct Use {
    id: String,
    name: String,
    input: Value,
}

fn tool_uses(blocks: &[Block]) -> Vec<Use> {
    blocks
        .iter()
        .filter_map(|b| match b {
            Block::ToolUse { id, name, input } => Some(Use {
                id: id.clone(),
                name: name.clone(),
                input: input.clone(),
            }),
            _ => None,
        })
        .collect()
}

/// The response blocks as they may be stored: blank text blocks dropped (the API refuses
/// them in history) and, for a final answer with no text left, [`EMPTY_REPLY`] appended.
fn storable(blocks: Vec<Block>, is_answer: bool) -> Vec<Block> {
    let kept: Vec<Block> = blocks
        .into_iter()
        .filter(|b| !matches!(b, Block::Text(t) if t.trim().is_empty()))
        .collect();
    let has_text = kept.iter().any(|b| matches!(b, Block::Text(_)));
    if !is_answer || has_text {
        return kept;
    }
    kept.into_iter()
        .chain([Block::Text(EMPTY_REPLY.into())])
        .collect()
}

fn finish(
    new_turns: Vec<Turn>,
    runs: Vec<ToolRunRecord>,
    (usage, context): (Usage, u64),
    truncated: bool,
) -> TurnOutput {
    let text = new_turns.last().map(final_text).unwrap_or_default();
    let reply = if truncated && text.trim().is_empty() {
        TRUNCATED_REPLY.to_string()
    } else {
        text
    };
    TurnOutput {
        new_turns,
        reply,
        runs,
        usage,
        truncated,
        context,
    }
}

fn final_text(turn: &Turn) -> String {
    let texts: Vec<&str> = turn
        .blocks
        .iter()
        .filter_map(|b| match b {
            Block::Text(t) => Some(t.as_str()),
            _ => None,
        })
        .collect();
    texts.join("\n")
}

/// Error results for calls the loop will not run, then a fixed assistant text, so the
/// history stays valid for the next request.
fn close_unrun(uses: &[Use]) -> [Turn; 2] {
    let error = json!({"error": "limit_reached", "message": TRUNCATED_REPLY});
    let blocks = uses.iter().map(|u| result_block(&u.id, &error, true)).collect();
    [
        Turn {
            role: Role::User,
            blocks,
        },
        Turn {
            role: Role::Assistant,
            blocks: vec![Block::Text(TRUNCATED_REPLY.into())],
        },
    ]
}

/// Runs the first `allowed` calls in order; the rest are answered with a
/// `too_many_tool_calls` error without reaching the host (so no query and no audit row), which
/// keeps every tool_use paired with its result. All results go back in one user turn.
async fn run_tools(host: &dyn ToolHost, uses: &[Use], allowed: usize) -> (Turn, Vec<ToolRunRecord>) {
    let mut blocks = Vec::with_capacity(uses.len());
    let mut records = Vec::with_capacity(allowed.min(uses.len()));
    for u in &uses[..allowed.min(uses.len())] {
        let (block, record) = run_tool(host, u).await;
        blocks.push(block);
        records.push(record);
    }
    let refused = json!({"error": "too_many_tool_calls", "message": "too many tool calls; not run"});
    blocks.extend(
        uses.iter()
            .skip(allowed)
            .map(|u| result_block(&u.id, &refused, true)),
    );
    let turn = Turn {
        role: Role::User,
        blocks,
    };
    (turn, records)
}

async fn run_tool(host: &dyn ToolHost, u: &Use) -> (Block, ToolRunRecord) {
    let parsed = if u.input.get(INVALID_JSON_KEY).is_some() {
        Err(ToolError::new(
            "invalid_json",
            "tool arguments were not valid JSON",
        ))
    } else {
        parse_call(&u.name, &u.input)
    };
    let sysid = parsed.as_ref().ok().and_then(ToolCall::sysid);
    let outcome = match parsed {
        Ok(call) => host.run(&call).await,
        Err(e) => Err(e),
    };
    let (content, is_error) = match &outcome {
        Ok(value) => (value.clone(), false),
        Err(e) => (json!({"error": e.code, "message": e.message}), true),
    };
    let record = ToolRunRecord {
        name: u.name.chars().take(MAX_RECORDED_NAME_CHARS).collect(),
        sysid,
        ok: outcome.is_ok(),
        error: outcome.as_ref().err().map(|e| e.code.to_string()),
        result: outcome.ok(),
        ts: unix_ms(),
    };
    (result_block(&u.id, &content, is_error), record)
}

fn result_block(id: &str, content: &Value, is_error: bool) -> Block {
    Block::ToolResult {
        tool_use_id: id.to_string(),
        content: capped_json(content),
        is_error,
    }
}

/// `value` as JSON text of at most `MAX_TOOL_RESULT_CHARS` chars. A longer text is cut at a
/// char boundary and wrapped as `{"partial": "<cut text>", "truncated": true}`, still valid JSON.
pub fn capped_json(value: &Value) -> String {
    let text = value.to_string();
    let len = text.chars().count();
    if len <= MAX_TOOL_RESULT_CHARS {
        return text;
    }
    let mut keep = MAX_TOOL_RESULT_CHARS.min(len);
    loop {
        let cut: String = text.chars().take(keep).collect();
        let wrapped = json!({"partial": cut, "truncated": true}).to_string();
        let over = wrapped.chars().count().saturating_sub(MAX_TOOL_RESULT_CHARS);
        if over == 0 {
            return wrapped;
        }
        // Escaping can grow the text; shrink by at least the overflow and retry.
        keep = keep.saturating_sub(over.max(1));
    }
}

fn unix_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
        .unwrap_or(0)
}
