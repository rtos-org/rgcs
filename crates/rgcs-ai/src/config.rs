//! `[ai]` section of `config.toml`: provider, model, key and the cost / time limits.
//!
//! The API key never leaves this crate in a printable form: [`Secret`] redacts `Debug`, has
//! no `Display` and no `Serialize`. Resolution takes the environment as a function so tests
//! never read the real `ANTHROPIC_API_KEY`.

use std::fmt;
use std::time::Duration;

use serde::Deserialize;

/// LLM calls that may end in tool use before the loop forces a text answer (review focus 3).
pub const MAX_TOOL_ITERATIONS: u32 = 6;

const ANTHROPIC_BASE_URL: &str = "https://api.anthropic.com";
const ANTHROPIC_MODEL: &str = "claude-sonnet-5-5";
const ANTHROPIC_KEY_ENV: &str = "ANTHROPIC_API_KEY";
const OPENAI_BASE_URL: &str = "http://127.0.0.1:11434/v1";
const OPENAI_MODEL: &str = "qwen3:8b";

/// An API key. `Debug` prints `Secret(***)`; read it only with [`Secret::expose`].
#[derive(Clone, PartialEq, Eq, Deserialize)]
#[serde(transparent)]
pub struct Secret(String);

impl Secret {
    pub fn new(value: impl Into<String>) -> Self {
        Self(value.into())
    }

    /// The raw key, for the provider request header only.
    pub fn expose(&self) -> &str {
        &self.0
    }
}

impl fmt::Debug for Secret {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("Secret(***)")
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProviderKind {
    None,
    Anthropic,
    OpenaiCompat,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct AiConfig {
    pub provider: ProviderKind,
    /// `None` → the provider default (`claude-sonnet-5-5` / `qwen3:8b`).
    pub model: Option<String>,
    /// `None` → the provider default.
    pub base_url: Option<String>,
    /// Discouraged (keep keys out of files); the env var wins when both are set.
    pub api_key: Option<Secret>,
    /// Env var holding the key. `None` → `ANTHROPIC_API_KEY` for Anthropic and no env var
    /// for OpenAI-compatible endpoints, so the Anthropic key never reaches a local server.
    pub api_key_env: Option<String>,
    /// Anthropic `output_config.effort`.
    pub effort: String,
    pub request_timeout_ms: u64,
    pub chat_timeout_ms: u64,
    pub max_tokens_per_chat: u64,
    /// Server-wide rolling 24 h token budget; `0` = unlimited.
    pub daily_token_budget: u64,
}

impl Default for AiConfig {
    fn default() -> Self {
        Self {
            provider: ProviderKind::None,
            model: None,
            base_url: None,
            api_key: None,
            api_key_env: None,
            effort: "medium".into(),
            request_timeout_ms: 30_000,
            chat_timeout_ms: 90_000,
            max_tokens_per_chat: 60_000,
            daily_token_budget: 2_000_000,
        }
    }
}

/// Why the assistant is off (`AiStatus.reason`).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Unconfigured {
    Disabled,
    NoApiKey,
}

impl Unconfigured {
    /// The `AiStatus.reason` string.
    pub fn reason(self) -> &'static str {
        match self {
            Self::Disabled => "disabled",
            Self::NoApiKey => "no_api_key",
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Limits {
    pub max_iterations: u32,
    pub request_timeout: Duration,
    pub chat_timeout: Duration,
    pub max_tokens_per_chat: u64,
}

/// A usable provider setup.
#[derive(Debug, Clone, PartialEq)]
pub struct ResolvedAi {
    pub kind: ProviderKind,
    pub model: String,
    pub base_url: String,
    pub key: Option<Secret>,
    /// Anthropic `output_config.effort`; unused by OpenAI-compatible endpoints.
    pub effort: String,
    pub limits: Limits,
}

impl ResolvedAi {
    /// `url` reduced to scheme + host + port for the log: userinfo (`user:key@`), path,
    /// query (`?api-key=`) and fragment can carry credentials and are dropped.
    pub fn loggable_url(url: &str) -> String {
        let (scheme, rest) = url.split_once("://").map_or(("", url), |(s, r)| (s, r));
        let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
        let host = authority.rsplit_once('@').map_or(authority, |(_, h)| h);
        if scheme.is_empty() {
            host.to_string()
        } else {
            format!("{scheme}://{host}")
        }
    }
}

impl AiConfig {
    /// Resolve defaults and the key. `env` stands in for `std::env::var` (tests pass a stub).
    pub fn resolve_with(&self, env: &dyn Fn(&str) -> Option<String>) -> Result<ResolvedAi, Unconfigured> {
        let (default_url, default_model, default_env) = match self.provider {
            ProviderKind::None => return Err(Unconfigured::Disabled),
            ProviderKind::Anthropic => (ANTHROPIC_BASE_URL, ANTHROPIC_MODEL, Some(ANTHROPIC_KEY_ENV)),
            ProviderKind::OpenaiCompat => (OPENAI_BASE_URL, OPENAI_MODEL, None),
        };
        let key = self.key_with(env, default_env);
        if self.provider == ProviderKind::Anthropic && key.is_none() {
            return Err(Unconfigured::NoApiKey);
        }
        Ok(ResolvedAi {
            kind: self.provider,
            model: self.model.clone().unwrap_or_else(|| default_model.into()),
            base_url: self.base_url.clone().unwrap_or_else(|| default_url.into()),
            key,
            effort: self.effort.clone(),
            limits: self.limits(),
        })
    }

    fn key_with(&self, env: &dyn Fn(&str) -> Option<String>, default_env: Option<&str>) -> Option<Secret> {
        let var = self.api_key_env.as_deref().or(default_env);
        let from_env = var.and_then(env).filter(|k| !k.trim().is_empty()).map(Secret);
        let from_file = self.api_key.clone().filter(|k| !k.0.trim().is_empty());
        from_env.or(from_file)
    }

    pub fn limits(&self) -> Limits {
        Limits {
            max_iterations: MAX_TOOL_ITERATIONS,
            request_timeout: Duration::from_millis(self.request_timeout_ms),
            chat_timeout: Duration::from_millis(self.chat_timeout_ms),
            max_tokens_per_chat: self.max_tokens_per_chat,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(serde::Deserialize)]
    struct Wrapper {
        ai: AiConfig,
    }

    fn parse(src: &str) -> Result<AiConfig, toml::de::Error> {
        toml::from_str::<Wrapper>(src).map(|w| w.ai)
    }

    fn no_env(_: &str) -> Option<String> {
        None
    }

    #[test]
    fn empty_section_is_disabled() {
        let cfg = parse("[ai]\n").unwrap();
        assert_eq!(cfg.provider, ProviderKind::None);
        assert_eq!(cfg.resolve_with(&no_env).unwrap_err(), Unconfigured::Disabled);
    }

    #[test]
    fn anthropic_without_key_is_no_api_key() {
        let cfg = parse("[ai]\nprovider = \"anthropic\"\n").unwrap();
        assert_eq!(cfg.resolve_with(&no_env).unwrap_err(), Unconfigured::NoApiKey);
    }

    #[test]
    fn anthropic_with_env_key_resolves_defaults() {
        let cfg = parse("[ai]\nprovider = \"anthropic\"\n").unwrap();
        let env = |k: &str| (k == "ANTHROPIC_API_KEY").then(|| "sk-test-123".to_string());
        let r = cfg.resolve_with(&env).unwrap();
        assert_eq!(r.kind, ProviderKind::Anthropic);
        assert_eq!(r.model, "claude-sonnet-5-5");
        assert_eq!(r.base_url, "https://api.anthropic.com");
        assert_eq!(r.effort, "medium");
        assert_eq!(r.key.as_ref().map(Secret::expose), Some("sk-test-123"));
        assert_eq!(r.limits.max_iterations, 6);
        assert_eq!(r.limits.request_timeout, Duration::from_millis(30_000));
        assert_eq!(r.limits.chat_timeout, Duration::from_millis(90_000));
        assert_eq!(r.limits.max_tokens_per_chat, 60_000);
        assert_eq!(cfg.daily_token_budget, 2_000_000);
    }

    #[test]
    fn env_key_wins_over_config_key() {
        let cfg = parse("[ai]\nprovider = \"anthropic\"\napi_key = \"sk-file\"\n").unwrap();
        let env = |k: &str| (k == "ANTHROPIC_API_KEY").then(|| "sk-env".to_string());
        let r = cfg.resolve_with(&env).unwrap();
        assert_eq!(r.key.as_ref().map(Secret::expose), Some("sk-env"));
        let r = cfg.resolve_with(&no_env).unwrap();
        assert_eq!(r.key.as_ref().map(Secret::expose), Some("sk-file"));
    }

    #[test]
    fn empty_env_key_does_not_count() {
        let cfg = parse("[ai]\nprovider = \"anthropic\"\n").unwrap();
        let env = |_: &str| Some(String::new());
        assert_eq!(cfg.resolve_with(&env).unwrap_err(), Unconfigured::NoApiKey);
    }

    #[test]
    fn openai_compat_needs_no_key() {
        let cfg = parse("[ai]\nprovider = \"openai_compat\"\n").unwrap();
        let r = cfg.resolve_with(&no_env).unwrap();
        assert_eq!(r.kind, ProviderKind::OpenaiCompat);
        assert_eq!(r.base_url, "http://127.0.0.1:11434/v1");
        assert_eq!(r.model, "qwen3:8b");
        assert!(r.key.is_none());
    }

    #[test]
    fn openai_compat_never_picks_up_the_anthropic_env_key() {
        let cfg = parse("[ai]\nprovider = \"openai_compat\"\n").unwrap();
        let env = |k: &str| (k == "ANTHROPIC_API_KEY").then(|| "sk-ant".to_string());
        assert!(cfg.resolve_with(&env).unwrap().key.is_none());
    }

    #[test]
    fn overrides_are_kept() {
        let src = "[ai]\nprovider = \"openai_compat\"\nmodel = \"llama\"\n\
                   base_url = \"http://10.0.0.2:8080/v1\"\nrequest_timeout_ms = 5000\n";
        let r = parse(src).unwrap().resolve_with(&no_env).unwrap();
        assert_eq!(r.model, "llama");
        assert_eq!(r.base_url, "http://10.0.0.2:8080/v1");
        assert_eq!(r.limits.request_timeout, Duration::from_millis(5000));
    }

    #[test]
    fn debug_redacts_the_key() {
        let cfg = parse("[ai]\nprovider = \"anthropic\"\napi_key = \"sk-test-123\"\n").unwrap();
        let text = format!("{cfg:?}");
        assert!(!text.contains("sk-test-123"), "{text}");
        assert!(text.contains("Secret(***)"), "{text}");
        let r = cfg.resolve_with(&no_env).unwrap();
        assert!(!format!("{r:?}").contains("sk-test-123"));
    }

    #[test]
    fn loggable_url_keeps_only_scheme_host_and_port() {
        let cases = [
            (
                "https://user:sk-secret@proxy.example:8443/v1?api-key=sk-q#f",
                "https://proxy.example:8443",
            ),
            ("http://127.0.0.1:11434/v1", "http://127.0.0.1:11434"),
            ("https://api.anthropic.com", "https://api.anthropic.com"),
            ("host-only?key=sk-q", "host-only"),
        ];
        for (url, want) in cases {
            assert_eq!(ResolvedAi::loggable_url(url), want, "{url}");
        }
    }

    #[test]
    fn unknown_key_is_a_parse_error() {
        assert!(parse("[ai]\nprovder = \"anthropic\"\n").is_err());
    }
}
