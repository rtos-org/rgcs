//! Test doubles (feature `fake`): an in-process scripted LLM and a scripted fake provider
//! HTTP server for both protocols.

use std::collections::VecDeque;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use async_trait::async_trait;
use axum::body::Bytes;
use axum::extract::State;
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::post;
use axum::{Json, Router};
use serde_json::{json, Value};
use tokio::task::JoinHandle;

use crate::llm::{AiError, Block, LlmClient, LlmRequest, LlmResponse, Stop, Turn, Usage};

const STATUS_KEY: &str = "__fake_status";
const BODY_KEY: &str = "__fake_body";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Protocol {
    Anthropic,
    OpenAi,
}

impl Protocol {
    fn path(self) -> &'static str {
        match self {
            Protocol::Anthropic => "/v1/messages",
            Protocol::OpenAi => "/chat/completions",
        }
    }
}

/// A script entry that answers with `status` and `body` instead of 200.
pub fn reply_status(status: u16, body: Value) -> Value {
    json!({ STATUS_KEY: status, BODY_KEY: body })
}

type Recorded = Arc<Mutex<Vec<(HeaderMap, Value)>>>;

#[derive(Clone)]
struct FakeState {
    script: Arc<Mutex<VecDeque<Value>>>,
    requests: Recorded,
    delay: Duration,
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

fn scripted_response(entry: Option<Value>) -> Response {
    let Some(entry) = entry else {
        let body =
            json!({"type": "error", "error": {"type": "fake_exhausted", "message": "script exhausted"}});
        return (StatusCode::INTERNAL_SERVER_ERROR, Json(body)).into_response();
    };
    match entry.get(STATUS_KEY).and_then(Value::as_u64) {
        Some(code) => {
            let status = u16::try_from(code)
                .ok()
                .and_then(|c| StatusCode::from_u16(c).ok())
                .unwrap_or(StatusCode::INTERNAL_SERVER_ERROR);
            (status, Json(entry.get(BODY_KEY).cloned().unwrap_or(Value::Null))).into_response()
        }
        None => Json(entry).into_response(),
    }
}

async fn handle(State(state): State<FakeState>, headers: HeaderMap, body: Bytes) -> Response {
    let parsed = serde_json::from_slice(&body).unwrap_or(Value::Null);
    lock(&state.requests).push((headers, parsed));
    if !state.delay.is_zero() {
        tokio::time::sleep(state.delay).await;
    }
    let entry = lock(&state.script).pop_front();
    scripted_response(entry)
}

/// Serves scripted replies in order on `127.0.0.1:0`; 500 once the script is exhausted.
pub struct FakeProviderServer {
    /// Base URL to put in `ResolvedAi::base_url` (no trailing slash, no `/v1`).
    pub url: String,
    requests: Recorded,
    task: JoinHandle<()>,
}

impl FakeProviderServer {
    pub async fn start(protocol: Protocol, script: Vec<Value>) -> Self {
        Self::start_with_delay(protocol, script, Duration::ZERO).await
    }

    /// Like `start`, but each reply waits `delay` first (timeout tests).
    pub async fn start_with_delay(protocol: Protocol, script: Vec<Value>, delay: Duration) -> Self {
        let state = FakeState {
            script: Arc::new(Mutex::new(script.into())),
            requests: Arc::default(),
            delay,
        };
        let requests = state.requests.clone();
        let router = Router::new()
            .route(protocol.path(), post(handle))
            .with_state(state);
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind fake provider");
        let url = format!("http://{}", listener.local_addr().expect("fake provider addr"));
        let task = tokio::spawn(async move {
            // The task is aborted on drop; a serve error just ends the fake.
            let _ = axum::serve(listener, router).await;
        });
        Self { url, requests, task }
    }

    /// Every request received so far: headers and the parsed JSON body.
    pub fn requests(&self) -> Vec<(HeaderMap, Value)> {
        lock(&self.requests).clone()
    }
}

impl Drop for FakeProviderServer {
    fn drop(&mut self) {
        self.task.abort();
    }
}

/// What `ScriptedLlm` answers next.
enum Script {
    /// Replies in order; `Err(Malformed)` once exhausted.
    Fixed(VecDeque<Result<LlmResponse, AiError>>),
    /// A `list_vehicles` tool use on every call, forever.
    AlwaysToolUse,
}

/// An in-process `LlmClient` with scripted replies. Records, per call, whether tools were
/// offered and the turns that were sent.
pub struct ScriptedLlm {
    script: Mutex<Script>,
    seen: Mutex<Vec<(bool, Vec<Turn>)>>,
}

impl ScriptedLlm {
    pub fn new(replies: Vec<LlmResponse>) -> Self {
        Self::from_results(replies.into_iter().map(Ok).collect())
    }

    /// Like `new`, but entries may be errors (`Err(AiError::Refused)`, …).
    pub fn from_results(replies: Vec<Result<LlmResponse, AiError>>) -> Self {
        Self::with_script(Script::Fixed(replies.into()))
    }

    /// Answers every call, the forced no-tools one included, with a tool use.
    pub fn always_tool_use() -> Self {
        Self::with_script(Script::AlwaysToolUse)
    }

    fn with_script(script: Script) -> Self {
        Self {
            script: Mutex::new(script),
            seen: Mutex::default(),
        }
    }

    /// Per call: `true` when the request offered tools.
    pub fn calls(&self) -> Vec<bool> {
        lock(&self.seen).iter().map(|(tools, _)| *tools).collect()
    }

    /// Per call: the turns sent.
    pub fn requests(&self) -> Vec<Vec<Turn>> {
        lock(&self.seen).iter().map(|(_, turns)| turns.clone()).collect()
    }
}

fn endless_tool_use(n: usize) -> LlmResponse {
    LlmResponse {
        blocks: vec![Block::ToolUse {
            id: format!("toolu_{n}"),
            name: "list_vehicles".into(),
            input: json!({}),
        }],
        stop: Stop::ToolUse,
        usage: Usage {
            input: 100,
            output: 10,
        },
    }
}

#[async_trait]
impl LlmClient for ScriptedLlm {
    async fn complete(&self, req: LlmRequest<'_>) -> Result<LlmResponse, AiError> {
        let n = {
            let mut seen = lock(&self.seen);
            seen.push((req.tools.is_some(), req.turns.to_vec()));
            seen.len()
        };
        match &mut *lock(&self.script) {
            Script::Fixed(replies) => replies.pop_front().unwrap_or(Err(AiError::Malformed)),
            Script::AlwaysToolUse => Ok(endless_tool_use(n)),
        }
    }
}
