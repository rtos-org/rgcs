//! Adapter tests against the scripted fake provider (no real LLM calls).

use std::time::Duration;

use rgcs_ai::llm::{client_for, AiError, Block, LlmClient, LlmRequest, Role, Stop, Turn};
use rgcs_ai::testing::{reply_status, FakeProviderServer, Protocol};
use rgcs_ai::{tool_specs, Limits, ProviderKind, ResolvedAi, Secret};
use serde_json::{json, Value};

const KEY: &str = "sk-test-123";

fn resolved(kind: ProviderKind, base_url: &str, key: Option<&str>, timeout_ms: u64) -> ResolvedAi {
    let model = match kind {
        ProviderKind::Anthropic => "claude-sonnet-5-5",
        _ => "qwen3:8b",
    };
    ResolvedAi {
        kind,
        model: model.into(),
        base_url: base_url.into(),
        key: key.map(Secret::new),
        effort: "medium".into(),
        limits: Limits {
            max_iterations: 6,
            request_timeout: Duration::from_millis(timeout_ms),
            chat_timeout: Duration::from_millis(90_000),
            max_tokens_per_chat: 60_000,
        },
    }
}

fn anthropic(fake: &FakeProviderServer) -> Box<dyn LlmClient> {
    client_for(&resolved(ProviderKind::Anthropic, &fake.url, Some(KEY), 5_000))
}

fn openai(fake: &FakeProviderServer, key: Option<&str>) -> Box<dyn LlmClient> {
    client_for(&resolved(ProviderKind::OpenaiCompat, &fake.url, key, 5_000))
}

fn user(text: &str) -> Turn {
    Turn {
        role: Role::User,
        blocks: vec![Block::Text(text.into())],
    }
}

fn thinking() -> Value {
    json!({"type": "thinking", "thinking": "", "signature": "sig1"})
}

fn anthropic_tool_reply() -> Value {
    json!({
        "content": [thinking(), {"type": "tool_use", "id": "tu_1", "name": "get_vehicle_status", "input": {"sysid": 3}}],
        "stop_reason": "tool_use",
        "usage": {"input_tokens": 120, "output_tokens": 30}
    })
}

fn anthropic_text_reply(stop: &str) -> Value {
    json!({
        "content": [{"type": "text", "text": "UAV-03 は正常です"}],
        "stop_reason": stop,
        "usage": {"input_tokens": 10, "output_tokens": 5}
    })
}

async fn call(
    client: &dyn LlmClient,
    turns: &[Turn],
    with_tools: bool,
) -> Result<rgcs_ai::llm::LlmResponse, AiError> {
    let specs = tool_specs();
    client
        .complete(LlmRequest {
            system: "sys",
            turns,
            tools: with_tools.then_some(specs.as_slice()),
            max_tokens: 4096,
        })
        .await
}

#[tokio::test]
async fn anthropic_tool_use_maps_blocks_usage_and_request() {
    let fake = FakeProviderServer::start(Protocol::Anthropic, vec![anthropic_tool_reply()]).await;
    let res = call(anthropic(&fake).as_ref(), &[user("状態は?")], true)
        .await
        .unwrap();
    assert_eq!(res.stop, Stop::ToolUse);
    assert_eq!(
        res.blocks,
        vec![
            Block::Opaque(thinking()),
            Block::ToolUse {
                id: "tu_1".into(),
                name: "get_vehicle_status".into(),
                input: json!({"sysid": 3})
            },
        ]
    );
    assert_eq!((res.usage.input, res.usage.output), (120, 30));

    let reqs = fake.requests();
    assert_eq!(reqs.len(), 1);
    let (headers, body) = &reqs[0];
    assert_eq!(headers["x-api-key"], KEY);
    assert_eq!(headers["anthropic-version"], "2023-06-01");
    assert!(headers.get("authorization").is_none());
    assert_eq!(body["model"], "claude-sonnet-5-5");
    assert_eq!(body["max_tokens"], 4096);
    assert_eq!(body["system"], "sys");
    assert_eq!(body["output_config"]["effort"], "medium");
    for absent in ["temperature", "tool_choice", "thinking"] {
        assert!(body.get(absent).is_none(), "{absent} must not be sent");
    }
    assert_eq!(body["tools"].as_array().unwrap().len(), rgcs_ai::TOOL_NAMES.len());
    assert_eq!(body["tools"][0]["name"], "get_vehicle_status");
    assert!(body["tools"][0]["input_schema"].is_object());
    assert_eq!(
        body["messages"],
        json!([{"role": "user", "content": [{"type": "text", "text": "状態は?"}]}])
    );
}

#[tokio::test]
async fn anthropic_replays_assistant_blocks_verbatim_and_tool_results() {
    let fake = FakeProviderServer::start(
        Protocol::Anthropic,
        vec![anthropic_tool_reply(), anthropic_text_reply("end_turn")],
    )
    .await;
    let client = anthropic(&fake);
    let first = call(client.as_ref(), &[user("状態は?")], true).await.unwrap();
    let turns = vec![
        user("状態は?"),
        Turn {
            role: Role::Assistant,
            blocks: first.blocks,
        },
        Turn {
            role: Role::User,
            blocks: vec![Block::ToolResult {
                tool_use_id: "tu_1".into(),
                content: "{\"ok\":1}".into(),
                is_error: false,
            }],
        },
    ];
    let second = call(client.as_ref(), &turns, true).await.unwrap();
    assert_eq!(second.stop, Stop::EndTurn);
    assert_eq!(second.blocks, vec![Block::Text("UAV-03 は正常です".into())]);

    let body = &fake.requests()[1].1;
    let msgs = body["messages"].as_array().unwrap();
    assert_eq!(msgs.len(), 3);
    assert_eq!(msgs[1]["role"], "assistant");
    assert_eq!(msgs[1]["content"][0], thinking());
    assert_eq!(
        msgs[1]["content"][1],
        json!({"type": "tool_use", "id": "tu_1", "name": "get_vehicle_status", "input": {"sysid": 3}})
    );
    assert_eq!(
        msgs[2],
        json!({"role": "user", "content": [{"type": "tool_result", "tool_use_id": "tu_1", "content": "{\"ok\":1}", "is_error": false}]})
    );
}

#[tokio::test]
async fn anthropic_forced_text_call_keeps_tools_defined_but_disabled() {
    let fake = FakeProviderServer::start(
        Protocol::Anthropic,
        vec![anthropic_text_reply("end_turn"), anthropic_text_reply("end_turn")],
    )
    .await;
    let client = anthropic(&fake);
    call(client.as_ref(), &[user("hi")], false).await.unwrap();
    let with_tool_history = vec![
        user("hi"),
        Turn {
            role: Role::Assistant,
            blocks: vec![Block::ToolUse {
                id: "tu_1".into(),
                name: "list_vehicles".into(),
                input: json!({}),
            }],
        },
        Turn {
            role: Role::User,
            blocks: vec![Block::ToolResult {
                tool_use_id: "tu_1".into(),
                content: "[]".into(),
                is_error: false,
            }],
        },
    ];
    call(client.as_ref(), &with_tool_history, false).await.unwrap();
    let reqs = fake.requests();
    assert!(reqs[0].1.get("tools").is_none());
    assert!(reqs[0].1.get("tool_choice").is_none());
    assert_eq!(reqs[1].1["tool_choice"], json!({"type": "none"}));
    assert_eq!(
        reqs[1].1["tools"].as_array().unwrap().len(),
        rgcs_ai::TOOL_NAMES.len()
    );
}

#[tokio::test]
async fn anthropic_stop_reasons() {
    let fake = FakeProviderServer::start(
        Protocol::Anthropic,
        vec![
            anthropic_text_reply("refusal"),
            anthropic_text_reply("max_tokens"),
            anthropic_text_reply("weird"),
        ],
    )
    .await;
    let client = anthropic(&fake);
    assert!(matches!(
        call(client.as_ref(), &[user("a")], true).await,
        Err(AiError::Refused)
    ));
    assert_eq!(
        call(client.as_ref(), &[user("a")], true).await.unwrap().stop,
        Stop::MaxTokens
    );
    assert!(matches!(
        call(client.as_ref(), &[user("a")], true).await,
        Err(AiError::Malformed)
    ));
}

#[tokio::test]
async fn anthropic_error_body_maps_to_provider_without_key() {
    let body = json!({"type": "error", "error": {"type": "overloaded_error", "message": "Overloaded"}});
    let fake = FakeProviderServer::start(Protocol::Anthropic, vec![reply_status(529, body)]).await;
    let err = call(anthropic(&fake).as_ref(), &[user("a")], true)
        .await
        .unwrap_err();
    match &err {
        AiError::Provider { status, message } => {
            assert_eq!(*status, 529);
            assert_eq!(message, "Overloaded");
        }
        other => panic!("unexpected {other:?}"),
    }
    assert!(!err.to_string().contains(KEY));
    assert!(!format!("{err:?}").contains(KEY));
}

#[tokio::test]
async fn provider_error_message_is_capped() {
    let long = "x".repeat(500);
    let body = json!({"error": {"type": "invalid_request_error", "message": long}});
    let fake = FakeProviderServer::start(Protocol::Anthropic, vec![reply_status(400, body)]).await;
    match call(anthropic(&fake).as_ref(), &[user("a")], true)
        .await
        .unwrap_err()
    {
        AiError::Provider { status: 400, message } => assert_eq!(message.chars().count(), 200),
        other => panic!("unexpected {other:?}"),
    }
}

#[tokio::test]
async fn exhausted_script_is_a_500_provider_error() {
    let fake = FakeProviderServer::start(Protocol::Anthropic, vec![]).await;
    let err = call(anthropic(&fake).as_ref(), &[user("a")], true)
        .await
        .unwrap_err();
    assert!(matches!(err, AiError::Provider { status: 500, .. }), "{err:?}");
}

#[tokio::test]
async fn malformed_success_body() {
    let fake = FakeProviderServer::start(Protocol::Anthropic, vec![json!({"nope": true})]).await;
    let err = call(anthropic(&fake).as_ref(), &[user("a")], true)
        .await
        .unwrap_err();
    assert!(matches!(err, AiError::Malformed), "{err:?}");
}

fn openai_tool_reply(arguments: &str) -> Value {
    json!({
        "choices": [{
            "message": {"role": "assistant", "content": null, "tool_calls": [
                {"id": "call_1", "type": "function", "function": {"name": "list_vehicles", "arguments": arguments}}
            ]},
            "finish_reason": "tool_calls"
        }],
        "usage": {"prompt_tokens": 50, "completion_tokens": 10}
    })
}

fn openai_text_reply(finish: &str) -> Value {
    json!({
        "choices": [{"message": {"role": "assistant", "content": "2 機です"}, "finish_reason": finish}],
        "usage": {"prompt_tokens": 60, "completion_tokens": 4}
    })
}

#[tokio::test]
async fn openai_tool_use_request_and_tool_result_replay() {
    let fake = FakeProviderServer::start(
        Protocol::OpenAi,
        vec![openai_tool_reply("{}"), openai_text_reply("stop")],
    )
    .await;
    let client = openai(&fake, None);
    let first = call(client.as_ref(), &[user("何機?")], true).await.unwrap();
    assert_eq!(first.stop, Stop::ToolUse);
    assert_eq!(
        first.blocks,
        vec![Block::ToolUse {
            id: "call_1".into(),
            name: "list_vehicles".into(),
            input: json!({})
        }]
    );
    assert_eq!((first.usage.input, first.usage.output), (50, 10));

    let turns = vec![
        user("何機?"),
        Turn {
            role: Role::Assistant,
            blocks: first.blocks,
        },
        Turn {
            role: Role::User,
            blocks: vec![Block::ToolResult {
                tool_use_id: "call_1".into(),
                content: "[1,2]".into(),
                is_error: false,
            }],
        },
    ];
    let second = call(client.as_ref(), &turns, true).await.unwrap();
    assert_eq!(second.stop, Stop::EndTurn);
    assert_eq!(second.blocks, vec![Block::Text("2 機です".into())]);

    let reqs = fake.requests();
    let (headers, body) = &reqs[0];
    assert!(headers.get("authorization").is_none());
    assert!(headers.get("x-api-key").is_none());
    assert_eq!(body["model"], "qwen3:8b");
    assert_eq!(body["max_tokens"], 4096);
    assert_eq!(body["tools"][0]["type"], "function");
    assert_eq!(body["tools"][0]["function"]["name"], "get_vehicle_status");
    assert!(body["tools"][0]["function"]["parameters"].is_object());
    assert_eq!(body["messages"][0], json!({"role": "system", "content": "sys"}));
    assert_eq!(body["messages"][1], json!({"role": "user", "content": "何機?"}));

    let msgs = reqs[1].1["messages"].as_array().unwrap().clone();
    assert_eq!(msgs.len(), 4);
    assert_eq!(msgs[2]["role"], "assistant");
    assert_eq!(msgs[2]["tool_calls"][0]["id"], "call_1");
    assert_eq!(msgs[2]["tool_calls"][0]["type"], "function");
    assert_eq!(msgs[2]["tool_calls"][0]["function"]["name"], "list_vehicles");
    assert_eq!(msgs[2]["tool_calls"][0]["function"]["arguments"], "{}");
    assert_eq!(
        msgs[3],
        json!({"role": "tool", "tool_call_id": "call_1", "content": "[1,2]"})
    );
}

#[tokio::test]
async fn openai_sends_bearer_only_with_a_key_and_drops_opaque() {
    let fake = FakeProviderServer::start(Protocol::OpenAi, vec![openai_text_reply("length")]).await;
    let turns = vec![
        user("a"),
        Turn {
            role: Role::Assistant,
            blocks: vec![Block::Opaque(thinking()), Block::Text("b".into())],
        },
        user("c"),
    ];
    let res = call(openai(&fake, Some(KEY)).as_ref(), &turns, false)
        .await
        .unwrap();
    assert_eq!(res.stop, Stop::MaxTokens);
    let (headers, body) = &fake.requests()[0];
    assert_eq!(headers["authorization"], format!("Bearer {KEY}"));
    assert!(body.get("tools").is_none());
    assert_eq!(body["messages"][2], json!({"role": "assistant", "content": "b"}));
}

#[tokio::test]
async fn openai_bad_arguments_become_invalid_json_marker() {
    let fake = FakeProviderServer::start(Protocol::OpenAi, vec![openai_tool_reply("{bad")]).await;
    let res = call(openai(&fake, None).as_ref(), &[user("a")], true)
        .await
        .unwrap();
    assert_eq!(
        res.blocks,
        vec![Block::ToolUse {
            id: "call_1".into(),
            name: "list_vehicles".into(),
            input: json!({"__invalid_json": "{bad"})
        }]
    );
}

#[tokio::test]
async fn openai_error_body() {
    let body = json!({"error": {"message": "model not found", "type": "not_found"}});
    let fake = FakeProviderServer::start(Protocol::OpenAi, vec![reply_status(404, body)]).await;
    let err = call(openai(&fake, Some(KEY)).as_ref(), &[user("a")], true)
        .await
        .unwrap_err();
    assert!(
        matches!(&err, AiError::Provider { status: 404, message } if message == "model not found"),
        "{err:?}"
    );
    assert!(!err.to_string().contains(KEY));
}

#[tokio::test]
async fn timeout_maps_to_timeout() {
    let fake = FakeProviderServer::start_with_delay(
        Protocol::Anthropic,
        vec![anthropic_text_reply("end_turn")],
        Duration::from_millis(300),
    )
    .await;
    let client = client_for(&resolved(ProviderKind::Anthropic, &fake.url, Some(KEY), 100));
    let err = call(client.as_ref(), &[user("a")], true).await.unwrap_err();
    assert!(matches!(err, AiError::Timeout), "{err:?}");
}

#[tokio::test]
async fn closed_port_is_unreachable() {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    drop(listener);
    for kind in [ProviderKind::Anthropic, ProviderKind::OpenaiCompat] {
        let client = client_for(&resolved(kind, &url, Some(KEY), 2_000));
        let err = call(client.as_ref(), &[user("a")], true).await.unwrap_err();
        assert!(matches!(err, AiError::Unreachable), "{err:?}");
    }
}

/// Answers every connection with `307` to `location` (a raw socket; reads the request first).
async fn redirect_server(location: String) -> String {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    tokio::spawn(async move {
        while let Ok((mut sock, _)) = listener.accept().await {
            let mut buf = vec![0u8; 64 * 1024];
            let _ = sock.read(&mut buf).await;
            let resp = format!(
                "HTTP/1.1 307 Temporary Redirect\r\nLocation: {location}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
            );
            let _ = sock.write_all(resp.as_bytes()).await;
        }
    });
    url
}

#[tokio::test]
async fn redirects_are_not_followed_so_the_key_stays_with_the_configured_host() {
    for (kind, protocol, path) in [
        (ProviderKind::Anthropic, Protocol::Anthropic, "/v1/messages"),
        (ProviderKind::OpenaiCompat, Protocol::OpenAi, "/chat/completions"),
    ] {
        let elsewhere = FakeProviderServer::start(protocol, vec![]).await;
        let url = redirect_server(format!("{}{path}", elsewhere.url)).await;
        let client = client_for(&resolved(kind, &url, Some(KEY), 5_000));
        let err = call(client.as_ref(), &[user("a")], true).await.unwrap_err();
        assert!(matches!(err, AiError::Provider { status: 307, .. }), "{err:?}");
        assert!(
            elsewhere.requests().is_empty(),
            "the request (and key) followed the redirect"
        );
    }
}
