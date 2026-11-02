//! WHEP signalling relay: the browser's SDP offer goes to MediaMTX, the answer comes back.

//! WHEP signalling relay: the browser's SDP offer goes to MediaMTX, the answer comes back.

use std::time::Duration;

use url::Url;

/// Offers larger than this are refused before anything is forwarded.
pub const MAX_OFFER_BYTES: usize = 64 * 1024;
const MAX_ANSWER_BYTES: usize = 256 * 1024;
const UPSTREAM_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum WhepError {
    #[error("invalid upstream url: {0}")]
    InvalidUpstream(String),
    #[error("media server unreachable")]
    Unreachable,
    #[error("media server answered {0}")]
    Upstream(u16),
    #[error("answer too large")]
    AnswerTooLarge,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WhepAnswer {
    pub sdp: String,
}

#[derive(Clone)]
pub struct WhepRelay {
    client: reqwest::Client,
    upstream: Url,
}

impl WhepRelay {
    pub fn new(upstream: &str) -> Result<Self, WhepError> {
        let upstream = Url::parse(upstream).map_err(|e| WhepError::InvalidUpstream(e.to_string()))?;
        let client = reqwest::Client::builder()
            .timeout(UPSTREAM_TIMEOUT)
            .build()
            .map_err(|e| WhepError::InvalidUpstream(e.to_string()))?;
        Ok(Self { client, upstream })
    }

    pub fn upstream(&self) -> &Url {
        &self.upstream
    }

    /// POSTs the offer as `application/sdp`; 2xx with the answer body is success.
    pub async fn offer(&self, sdp: &[u8]) -> Result<WhepAnswer, WhepError> {
        let res = self
            .client
            .post(self.upstream.clone())
            .header("content-type", "application/sdp")
            .body(sdp.to_vec())
            .send()
            .await
            .map_err(|_| WhepError::Unreachable)?;
        let status = res.status().as_u16();
        if !(200..300).contains(&status) {
            return Err(WhepError::Upstream(status));
        }
        let body = res.bytes().await.map_err(|_| WhepError::Unreachable)?;
        if body.len() > MAX_ANSWER_BYTES {
            return Err(WhepError::AnswerTooLarge);
        }
        Ok(WhepAnswer {
            sdp: String::from_utf8_lossy(&body).into_owned(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::{header, HeaderMap, StatusCode};
    use axum::routing::post;
    use axum::Router;

    async fn upstream(status: StatusCode) -> String {
        let app = Router::new().route(
            "/mt11/whep",
            post(move |headers: HeaderMap, body: String| async move {
                let ct = headers
                    .get(header::CONTENT_TYPE)
                    .and_then(|v| v.to_str().ok())
                    .unwrap_or("")
                    .to_string();
                (
                    status,
                    [(header::CONTENT_TYPE, "application/sdp")],
                    format!("answer-for:{body};ct={ct}"),
                )
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        format!("http://127.0.0.1:{}/mt11/whep", addr.port())
    }

    #[tokio::test]
    async fn offer_forwards_sdp_and_returns_the_answer() {
        let relay = WhepRelay::new(&upstream(StatusCode::CREATED).await).unwrap();
        let a = relay.offer(b"v=0\r\no=- 1 1 IN IP4 0.0.0.0").await.unwrap();
        assert_eq!(
            a.sdp,
            "answer-for:v=0\r\no=- 1 1 IN IP4 0.0.0.0;ct=application/sdp"
        );
    }

    #[tokio::test]
    async fn upstream_5xx_maps_to_upstream_error() {
        let relay = WhepRelay::new(&upstream(StatusCode::INTERNAL_SERVER_ERROR).await).unwrap();
        assert_eq!(relay.offer(b"v=0").await.unwrap_err(), WhepError::Upstream(500));
    }

    #[tokio::test]
    async fn unreachable_upstream_maps_to_unreachable() {
        let relay = WhepRelay::new("http://127.0.0.1:1/mt11/whep").unwrap();
        assert_eq!(relay.offer(b"v=0").await.unwrap_err(), WhepError::Unreachable);
        assert!(WhepRelay::new("not a url").is_err());
        assert_eq!(MAX_OFFER_BYTES, 64 * 1024);
    }
}
