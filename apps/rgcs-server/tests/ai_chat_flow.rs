//! `/api/ai/*` against a scripted fake LLM: answers with tools, continued conversations,
//! proposals executed only through the command path (single use, audited), dismiss, timeouts,
//! provider errors, key redaction and the rate limit. No real LLM is ever called.

mod common;

use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use axum::http::{Method, StatusCode};
use axum::Router as AxumRouter;
use common::*;
use rgcs_ai::testing::{reply_status, FakeProviderServer, Protocol};
use rgcs_ai::{
    AiConfig, AiError, Block, LlmClient, LlmRequest, LlmResponse, ProviderKind, Secret, Stop, Usage,
};
use rgcs_core::{AiProviderKind, AiStatus, VehicleCommand};
use rgcs_server::ai_api::build_ai_with;
use rgcs_server::ai_hub::AiHub;
use rgcs_server::app::{self, AppState};
use serde_json::{json, Value};
use tokio::sync::mpsc::{error::TryRecvError, UnboundedReceiver};

const KEY: &str = "sk-test-123";
const COPTER_LOITER: u32 = 5;
const PREFIX: &str = "[Target vehicle: UAV-03 (sysid 3)]";

struct Fixture {
    app: AxumRouter,
    state: AppState,
    cmds: UnboundedReceiver<VehicleCommand>,
    cookie: String,
    clock: Arc<AtomicU64>,
    _out: tokio::sync::mpsc::Receiver<rgcs_mavlink::Outgoing>,
}

fn config(kind: ProviderKind, url: &str, key: Option<&str>) -> AiConfig {
    AiConfig {
        provider: kind,
        base_url: Some(url.into()),
        api_key: key.map(Secret::new),
        ..AiConfig::default()
    }
}

async fn fixture_hub(hub: AiHub) -> Fixture {
    let (_, state, cmds, out) = spawn_app_recording().await;
    let clock = Arc::new(AtomicU64::new(1_000_000));
    let c = clock.clone();
    let state = state.with_ai(hub.with_clock(Arc::new(move || c.load(Ordering::SeqCst))));
    let app = app::build(state.clone(), None);
    seed_copter(&state, 3, COPTER_LOITER, false, false).await;
    let cookie = login(&app).await;
    Fixture {
        app,
        state,
        cmds,
        cookie,
        clock,
        _out: out,
    }
}

async fn fixture(cfg: AiConfig) -> Fixture {
    fixture_hub(build_ai_with(&cfg, &|_| None)).await
}

async fn openai_fixture(fake: &FakeProviderServer) -> Fixture {
    fixture(config(ProviderKind::OpenaiCompat, &fake.url, None)).await
}

fn tool_call(name: &str, args: Value) -> Value {
    json!({
        "choices": [{
            "message": {"role": "assistant", "content": null, "tool_calls": [
                {"id": "call_1", "type": "function", "function": {"name": name, "arguments": args.to_string()}}
            ]},
            "finish_reason": "tool_calls"
        }],
        "usage": {"prompt_tokens": 50, "completion_tokens": 10}
    })
}

fn text(t: &str) -> Value {
    json!({
        "choices": [{"message": {"role": "assistant", "content": t}, "finish_reason": "stop"}],
        "usage": {"prompt_tokens": 60, "completion_tokens": 4}
    })
}

fn propose(cmd: Value) -> Value {
    tool_call(
        "propose_command",
        json!({"sysid": 3, "command": cmd, "reason": "オペレーターの依頼"}),
    )
}

async fn post(f: &Fixture, cookie: &str, path: &str, body: Option<Value>) -> (StatusCode, Value) {
    let (status, body, _) = call(&f.app, req(Method::POST, path, Some(cookie), body)).await;
    (status, body)
}

async fn chat(f: &Fixture, body: Value) -> (StatusCode, Value) {
    post(f, &f.cookie, "/api/ai/chat", Some(body)).await
}

async fn ask(f: &Fixture, message: &str) -> (StatusCode, Value) {
    chat(f, json!({"sysid": 3, "message": message})).await
}

async fn execute(f: &Fixture, cookie: &str, cmd: Value) -> (StatusCode, Value) {
    post(f, cookie, "/api/vehicles/3/command", Some(cmd)).await
}

/// Asks for a proposal of `cmd` and returns its id.
async fn proposal_id(f: &Fixture) -> String {
    let (status, body) = ask(f, "提案して").await;
    assert_eq!(status, StatusCode::OK, "{body}");
    body["data"]["proposals"][0]["id"]
        .as_str()
        .expect("proposal")
        .to_string()
}

async fn vehicle_row(state: &AppState, command: &str, result: &str) -> rgcs_store::audit::AuditEntry {
    for _ in 0..40 {
        let rows = state.store.recent_audit(20).await.unwrap();
        let hit = rows
            .into_iter()
            .find(|r| r.target == "vehicle" && r.command == command && r.result == result);
        if let Some(row) = hit {
            return row;
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    panic!("no vehicle audit row {command} / {result}");
}

#[tokio::test]
async fn without_ai_the_status_says_disabled_and_chat_is_503() {
    let (app, state) = spawn_app().await;
    seed_copter(&state, 3, COPTER_LOITER, false, false).await;
    let cookie = login(&app).await;
    let (status, body, _) = call(&app, req(Method::GET, "/api/ai/status", Some(&cookie), None)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"]["configured"], false, "{body}");
    assert_eq!(body["data"]["reason"], "disabled");
    let (status, body, _) = call(
        &app,
        req(
            Method::POST,
            "/api/ai/chat",
            Some(&cookie),
            Some(json!({"sysid": 3, "message": "状態は?"})),
        ),
    )
    .await;
    assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(error_code(&body), "ai_unconfigured");
}

#[tokio::test]
async fn a_status_question_is_answered_and_the_conversation_continues() {
    let script = vec![
        tool_call("get_vehicle_status", json!({"sysid": 3})),
        text("UAV-03 は LOITER です"),
        text("続きです"),
    ];
    let fake = FakeProviderServer::start(Protocol::OpenAi, script).await;
    let f = openai_fixture(&fake).await;
    let (status, body) = ask(&f, "状態は?").await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let data = &body["data"];
    assert_eq!(data["reply"], "UAV-03 は LOITER です");
    let run = &data["tool_runs"][0];
    assert_eq!(
        (run["tool"].as_str(), run["sysid"].as_u64(), run["ok"].as_bool()),
        (Some("get_vehicle_status"), Some(3), Some(true))
    );
    assert_eq!(data["status_card"]["sysid"], 3);
    assert_eq!(data["status_card"]["name"], "UAV-03");
    assert_eq!(data["status_card"]["video"], "none");
    let id = data["conversation_id"].as_str().unwrap().to_string();
    assert!(uuid::Uuid::parse_str(&id).is_ok(), "{id}");
    let first = &fake.requests()[0].1;
    let user_text = first["messages"][1]["content"].as_str().unwrap();
    assert!(user_text.starts_with(PREFIX), "{user_text}");

    let (status, body) = chat(
        &f,
        json!({"sysid": 3, "message": "続けて", "conversation_id": id}),
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["data"]["conversation_id"], id.as_str());
    let third = &fake.requests()[2].1;
    let messages = third["messages"].as_array().unwrap();
    assert_eq!(
        messages.len(),
        1 + 4 + 1,
        "system + previous 4 + new user: {third}"
    );
}

#[tokio::test]
async fn a_history_too_costly_to_replay_is_full_before_any_llm_call() {
    let heavy = json!({
        "choices": [{"message": {"role": "assistant", "content": "長い答え"}, "finish_reason": "stop"}],
        "usage": {"prompt_tokens": 19_000, "completion_tokens": 1_000}
    });
    let fake = FakeProviderServer::start(Protocol::OpenAi, vec![heavy, text("not sent")]).await;
    let f = openai_fixture(&fake).await;
    let (status, body) = ask(&f, "状態は?").await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let id = body["data"]["conversation_id"].as_str().unwrap().to_string();
    let (status, body) = chat(
        &f,
        json!({"sysid": 3, "message": "続けて", "conversation_id": id}),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT, "{body}");
    assert_eq!(error_code(&body), "conversation_full");
    assert_eq!(fake.requests().len(), 1, "no LLM call for a full conversation");
}

#[tokio::test]
async fn a_proposal_is_executed_once_through_the_command_path() {
    let script = vec![propose(json!({"cmd": "rtl"})), text("RTL を提案します")];
    let fake = FakeProviderServer::start(Protocol::OpenAi, script).await;
    let mut f = openai_fixture(&fake).await;
    let (status, body) = ask(&f, "戻して").await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let p = &body["data"]["proposals"][0];
    assert_eq!(p["command"], json!({"cmd": "rtl"}), "{body}");
    assert_eq!(p["requires_confirm"], false);
    assert!(
        matches!(f.cmds.try_recv(), Err(TryRecvError::Empty)),
        "nothing sent"
    );
    let id = p["id"].as_str().unwrap().to_string();

    let cookie = f.cookie.clone();
    let (status, body) = execute(&f, &cookie, json!({"cmd": "rtl", "ai_proposal_id": id})).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert!(body["data"]["id"].is_u64());
    assert_eq!(f.cmds.recv().await, Some(VehicleCommand::Rtl));
    let row = vehicle_row(&f.state, "rtl", "ok").await;
    let args = row.args.unwrap_or_default();
    assert!(args.contains(&format!(r#""ai_proposal_id":"{id}""#)), "{args}");
    assert!(args.contains(r#""cmd":"rtl""#), "{args}");

    let (status, body) = execute(&f, &cookie, json!({"cmd": "rtl", "ai_proposal_id": id})).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(error_code(&body), "proposal_used");
    assert!(matches!(f.cmds.try_recv(), Err(TryRecvError::Empty)), "sent once");
}

#[tokio::test]
async fn an_arm_proposal_still_needs_the_confirm_token() {
    let script = vec![propose(json!({"cmd": "arm"})), text("ARM を提案します")];
    let fake = FakeProviderServer::start(Protocol::OpenAi, script).await;
    let f = openai_fixture(&fake).await;
    let id = proposal_id(&f).await;
    let cookie = f.cookie.clone();
    let (status, body) = execute(&f, &cookie, json!({"cmd": "arm", "ai_proposal_id": id})).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(error_code(&body), "confirm_required");
    let (_, confirm) = post(
        &f,
        &cookie,
        "/api/vehicles/3/confirm",
        Some(json!({"cmd": "arm"})),
    )
    .await;
    let token = confirm["data"]["confirm_token"].as_str().unwrap();
    let body = json!({"cmd": "arm", "ai_proposal_id": id, "confirm_token": token});
    let (status, body) = execute(&f, &cookie, body).await;
    assert_eq!(status, StatusCode::OK, "{body}");
}

#[tokio::test]
async fn wrong_unknown_foreign_and_expired_proposals_are_refused() {
    let script = vec![propose(json!({"cmd": "rtl"})), text("RTL を提案します")];
    let fake = FakeProviderServer::start(Protocol::OpenAi, script).await;
    let mut f = openai_fixture(&fake).await;
    let id = proposal_id(&f).await;
    let cookie = f.cookie.clone();
    let cases = [
        (
            json!({"cmd": "land", "ai_proposal_id": id}),
            "proposal_mismatch",
            StatusCode::CONFLICT,
        ),
        (
            json!({"cmd": "rtl", "ai_proposal_id": "p-nope"}),
            "proposal_not_found",
            StatusCode::NOT_FOUND,
        ),
    ];
    for (body, code, status) in cases {
        let (got, reply) = execute(&f, &cookie, body).await;
        assert_eq!((got, error_code(&reply)), (status, code), "{reply}");
    }
    f.state
        .store
        .create_user("op", "operator-pw", rgcs_core::operator::Role::Operator)
        .await
        .unwrap();
    let other = login_as(&f.app, "op", "operator-pw").await;
    let (status, body) = execute(&f, &other, json!({"cmd": "rtl", "ai_proposal_id": id})).await;
    assert_eq!((status, error_code(&body)), (StatusCode::FORBIDDEN, "forbidden"));
    f.clock.fetch_add(121_000, Ordering::SeqCst);
    let (status, body) = execute(&f, &cookie, json!({"cmd": "rtl", "ai_proposal_id": id})).await;
    assert_eq!(
        (status, error_code(&body)),
        (StatusCode::CONFLICT, "proposal_expired")
    );
    let row = vehicle_row(&f.state, "rtl", "rejected").await;
    assert!(
        row.args.unwrap_or_default().contains(&id),
        "rejections carry the proposal id"
    );
    assert!(
        matches!(f.cmds.try_recv(), Err(TryRecvError::Empty)),
        "nothing sent"
    );
}

#[tokio::test]
async fn a_dismissed_proposal_cannot_be_executed() {
    let script = vec![propose(json!({"cmd": "rtl"})), text("RTL を提案します")];
    let fake = FakeProviderServer::start(Protocol::OpenAi, script).await;
    let f = openai_fixture(&fake).await;
    let id = proposal_id(&f).await;
    let cookie = f.cookie.clone();
    let path = format!("/api/ai/proposals/{id}/dismiss");
    let (status, body) = post(&f, &cookie, &path, None).await;
    assert_eq!(status, StatusCode::OK, "{body}");
    assert_eq!(body["data"], json!({"id": id, "status": "dismissed"}));
    let audit = f.state.store.recent_audit(1).await.unwrap().remove(0);
    assert_eq!(
        (
            audit.target.as_str(),
            audit.command.as_str(),
            audit.result.as_str()
        ),
        ("ai", "dismiss_proposal", "ok")
    );
    let (status, body) = execute(&f, &cookie, json!({"cmd": "rtl", "ai_proposal_id": id})).await;
    assert_eq!(
        (status, error_code(&body)),
        (StatusCode::CONFLICT, "proposal_used")
    );
    let (status, body) = post(&f, &cookie, &path, None).await;
    assert_eq!(
        (status, error_code(&body)),
        (StatusCode::CONFLICT, "proposal_used")
    );
    let (status, body) = post(&f, &cookie, "/api/ai/proposals/p-nope/dismiss", None).await;
    assert_eq!(
        (status, error_code(&body)),
        (StatusCode::NOT_FOUND, "proposal_not_found")
    );
}

/// Answers the first call at once and every later call only after 500 ms.
struct SlowAfterFirst {
    calls: AtomicUsize,
    seen: std::sync::Mutex<Vec<usize>>,
}

#[async_trait]
impl LlmClient for SlowAfterFirst {
    async fn complete(&self, req: LlmRequest<'_>) -> Result<LlmResponse, AiError> {
        self.seen.lock().unwrap().push(req.turns.len());
        if self.calls.fetch_add(1, Ordering::SeqCst) == 1 {
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
        Ok(LlmResponse {
            blocks: vec![Block::Text("はい".into())],
            stop: Stop::EndTurn,
            usage: Usage { input: 5, output: 1 },
        })
    }
}

fn configured() -> AiStatus {
    AiStatus {
        configured: true,
        provider: Some(AiProviderKind::OpenaiCompat),
        model: Some("fake".into()),
        reason: None,
        budget_left: None,
    }
}

#[tokio::test]
async fn a_timed_out_chat_commits_nothing_and_frees_the_user() {
    let llm = Arc::new(SlowAfterFirst {
        calls: AtomicUsize::new(0),
        seen: std::sync::Mutex::new(Vec::new()),
    });
    let cfg = AiConfig {
        chat_timeout_ms: 200,
        ..AiConfig::default()
    };
    let f = fixture_hub(AiHub::new(llm.clone(), configured(), cfg.limits(), 0)).await;
    let (status, body) = ask(&f, "一つ目").await;
    assert_eq!(status, StatusCode::OK, "{body}");
    let id = body["data"]["conversation_id"].as_str().unwrap().to_string();
    let next = json!({"sysid": 3, "message": "二つ目", "conversation_id": id});
    let (status, body) = chat(&f, next.clone()).await;
    assert_eq!(
        (status, error_code(&body)),
        (StatusCode::GATEWAY_TIMEOUT, "ai_timeout")
    );
    let (status, body) = chat(&f, next).await;
    assert_eq!(status, StatusCode::OK, "not ai_busy: {body}");
    let seen = llm.seen.lock().unwrap().clone();
    assert_eq!(seen, vec![1, 3, 3], "the timed-out user turn was not kept");
    let unknown = json!({"sysid": 3, "message": "x", "conversation_id": uuid::Uuid::new_v4().to_string()});
    let (status, body) = chat(&f, unknown).await;
    assert_eq!(
        (status, error_code(&body)),
        (StatusCode::NOT_FOUND, "conversation_not_found")
    );
}

#[tokio::test]
async fn a_provider_error_is_502() {
    let script = vec![reply_status(500, json!({"error": {"message": "boom"}}))];
    let fake = FakeProviderServer::start(Protocol::OpenAi, script).await;
    let f = openai_fixture(&fake).await;
    let (status, body) = ask(&f, "状態は?").await;
    assert_eq!(
        (status, error_code(&body)),
        (StatusCode::BAD_GATEWAY, "ai_provider_error")
    );
}

fn anthropic_text() -> Value {
    json!({
        "content": [{"type": "text", "text": "正常です"}],
        "stop_reason": "end_turn",
        "usage": {"input_tokens": 10, "output_tokens": 5}
    })
}

#[tokio::test]
async fn the_api_key_never_reaches_a_response() {
    let overloaded = json!({"type": "error", "error": {"type": "overloaded_error", "message": "Overloaded"}});
    let script = vec![reply_status(529, overloaded), anthropic_text()];
    let fake = FakeProviderServer::start(Protocol::Anthropic, script).await;
    let f = fixture(config(ProviderKind::Anthropic, &fake.url, Some(KEY))).await;
    let (status, body, _) = call(&f.app, req(Method::GET, "/api/ai/status", Some(&f.cookie), None)).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"]["configured"], true, "{body}");
    assert_eq!(body["data"]["provider"], "anthropic");
    assert_eq!(body["data"]["model"], "claude-sonnet-5-5");
    let mut bodies = vec![body];
    let (status, body) = ask(&f, "状態は?").await;
    assert_eq!(
        (status, error_code(&body)),
        (StatusCode::BAD_GATEWAY, "ai_provider_error")
    );
    bodies.push(body);
    let (status, body) = ask(&f, "状態は?").await;
    assert_eq!(status, StatusCode::OK, "{body}");
    bodies.push(body);
    for b in &bodies {
        assert!(!b.to_string().contains(KEY), "{b}");
    }
    let headers = &fake.requests()[0].0;
    assert_eq!(headers["x-api-key"], KEY, "the key is sent to the provider only");
}

#[tokio::test]
async fn bad_messages_and_unknown_vehicles_are_refused() {
    let fake = FakeProviderServer::start(Protocol::OpenAi, vec![]).await;
    let f = openai_fixture(&fake).await;
    for message in ["", "   ", &"あ".repeat(2_001)] {
        let (status, body) = ask(&f, message).await;
        assert_eq!((status, error_code(&body)), (StatusCode::BAD_REQUEST, "invalid"));
    }
    let (status, body) = chat(&f, json!({"sysid": 9, "message": "状態は?"})).await;
    assert_eq!((status, error_code(&body)), (StatusCode::NOT_FOUND, "not_found"));
    assert!(fake.requests().is_empty(), "nothing reached the provider");
}

#[tokio::test]
async fn the_seventh_chat_in_a_minute_is_rate_limited() {
    let fake = FakeProviderServer::start(Protocol::OpenAi, vec![text("はい"); 6]).await;
    let f = openai_fixture(&fake).await;
    for _ in 0..6 {
        let (status, body) = ask(&f, "状態は?").await;
        assert_eq!(status, StatusCode::OK, "{body}");
    }
    let (status, body) = ask(&f, "状態は?").await;
    assert_eq!(
        (status, error_code(&body)),
        (StatusCode::TOO_MANY_REQUESTS, "rate_limited")
    );
    let retry = body["error"]["retry_after_s"].as_u64().expect("retry_after_s");
    assert!((1..=60).contains(&retry), "{body}");
}

#[tokio::test]
async fn the_daily_budget_stops_chats() {
    let fake = FakeProviderServer::start(Protocol::OpenAi, vec![text("はい"); 2]).await;
    let cfg = AiConfig {
        daily_token_budget: 10,
        ..config(ProviderKind::OpenaiCompat, &fake.url, None)
    };
    let f = fixture(cfg).await;
    let (status, _) = ask(&f, "状態は?").await;
    assert_eq!(status, StatusCode::OK);
    let (status, body) = ask(&f, "状態は?").await;
    assert_eq!(
        (status, error_code(&body)),
        (StatusCode::TOO_MANY_REQUESTS, "ai_budget")
    );
}
