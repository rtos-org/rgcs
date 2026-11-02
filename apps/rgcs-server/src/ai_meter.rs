//! Token metering for AI chat turns, and the provider-error replies sent to the client.

use async_trait::async_trait;
use axum::http::StatusCode;
use rgcs_ai::{AiError, LlmClient, LlmRequest, LlmResponse};

use crate::ai_hub::AiHub;

/// Wraps the LLM client and charges the tokens of every answered call to the hub's budget the
/// moment it answers: a turn that later fails, times out or is dropped (client gone) cannot
/// skip its accounting.
pub struct Metered<'a> {
    inner: &'a dyn LlmClient,
    hub: &'a AiHub,
}

impl<'a> Metered<'a> {
    pub fn new(inner: &'a dyn LlmClient, hub: &'a AiHub) -> Self {
        Self { inner, hub }
    }
}

#[async_trait]
impl LlmClient for Metered<'_> {
    async fn complete(&self, req: LlmRequest<'_>) -> Result<LlmResponse, AiError> {
        let resp = self.inner.complete(req).await?;
        self.hub.charge(resp.usage.total(), self.hub.now_ms());
        Ok(resp)
    }
}

/// Status, code and message for a failed turn. The provider's own error text can carry keys,
/// URLs or account details, so only its HTTP status reaches the client (and the log).
pub fn provider_error(e: &AiError) -> (StatusCode, &'static str, String) {
    match e {
        AiError::Timeout => (
            StatusCode::GATEWAY_TIMEOUT,
            "ai_timeout",
            "the AI did not answer in time".into(),
        ),
        AiError::Refused => (
            StatusCode::BAD_GATEWAY,
            "ai_refused",
            "the AI refused to answer".into(),
        ),
        AiError::Provider { status, .. } => (
            StatusCode::BAD_GATEWAY,
            "ai_provider_error",
            format!("AI provider error (HTTP {status})"),
        ),
        AiError::Unreachable => (
            StatusCode::BAD_GATEWAY,
            "ai_provider_error",
            "AI provider unreachable".into(),
        ),
        AiError::Malformed => (
            StatusCode::BAD_GATEWAY,
            "ai_provider_error",
            "unexpected AI provider response".into(),
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rgcs_ai::testing::ScriptedLlm;
    use rgcs_ai::{AiError, Block, LlmClient, LlmRequest, LlmResponse, Stop, Usage};

    fn reply(input: u64, output: u64) -> LlmResponse {
        LlmResponse {
            blocks: vec![Block::Text("ok".into())],
            stop: Stop::EndTurn,
            usage: Usage { input, output },
        }
    }

    fn req() -> LlmRequest<'static> {
        LlmRequest {
            system: "",
            turns: &[],
            tools: None,
            max_tokens: 16,
        }
    }

    fn hub(budget: u64) -> crate::ai_hub::AiHub {
        let status = rgcs_core::AiStatus {
            configured: true,
            provider: Some(rgcs_core::AiProviderKind::OpenaiCompat),
            model: Some("fake".into()),
            reason: None,
            budget_left: None,
        };
        let limits = rgcs_ai::AiConfig::default().limits();
        crate::ai_hub::AiHub::new(
            std::sync::Arc::new(ScriptedLlm::new(vec![])),
            status,
            limits,
            budget,
        )
    }

    #[tokio::test]
    async fn each_answered_call_is_charged_at_once_so_a_dropped_turn_cannot_skip_it() {
        let inner = ScriptedLlm::from_results(vec![Ok(reply(100, 20)), Err(AiError::Unreachable)]);
        let h = hub(1_000);
        {
            let meter = Metered::new(&inner, &h);
            assert!(meter.complete(req()).await.is_ok());
            // the turn is dropped here (client gone) before any post-turn accounting
        }
        assert_eq!(h.status(h.now_ms()).budget_left, Some(880));
        let meter = Metered::new(&inner, &h);
        assert!(meter.complete(req()).await.is_err());
        assert_eq!(
            h.status(h.now_ms()).budget_left,
            Some(880),
            "a failed call bills nothing"
        );
    }

    #[test]
    fn a_provider_error_never_echoes_the_provider_text() {
        let e = AiError::Provider {
            status: 401,
            message: "invalid x-api-key sk-ant-abc123 for https://api.example".into(),
        };
        let (status, code, message) = provider_error(&e);
        assert_eq!((status.as_u16(), code), (502, "ai_provider_error"));
        assert!(
            !message.contains("sk-ant") && !message.contains("https://"),
            "{message}"
        );
        assert!(message.contains("401"), "{message}");
    }
}
