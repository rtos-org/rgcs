//! RTSP DESCRIBE reachability probe (port of the Python `video_probe.py`).

//! RTSP DESCRIBE reachability probe (port of the Python `video_probe.py`).

use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

pub const RTSP_DEFAULT_PORT: u16 = 554;
const MAX_REPLY_BYTES: usize = 4096;
const USER_AGENT: &str = "rgcs-server";

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ProbeError {
    #[error("RTSP URL must not contain whitespace or control characters")]
    BadChars,
    #[error("not an rtsp:// URL: {0}")]
    NotRtsp(String),
}

/// Validates `url` and rebuilds it from parsed parts so nothing unexpected reaches the wire.
pub fn rtsp_request_uri(url: &str) -> Result<(String, u16, String), ProbeError> {
    if url.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err(ProbeError::BadChars);
    }
    let parsed = url::Url::parse(url).map_err(|_| ProbeError::NotRtsp(url.to_string()))?;
    let host = parsed
        .host_str()
        .filter(|_| parsed.scheme() == "rtsp")
        .ok_or_else(|| ProbeError::NotRtsp(url.to_string()))?;
    let port = parsed.port().unwrap_or(RTSP_DEFAULT_PORT);
    let path = if parsed.path().is_empty() {
        "/"
    } else {
        parsed.path()
    };
    let query = parsed.query().map(|q| format!("?{q}")).unwrap_or_default();
    let bracketed = if host.contains(':') {
        format!("[{host}]")
    } else {
        host.to_string()
    };
    Ok((
        host.to_string(),
        port,
        format!("rtsp://{bracketed}:{port}{path}{query}"),
    ))
}

/// True when DESCRIBE answers 2xx or 401 (exists, needs credentials MediaMTX holds).
pub async fn probe_rtsp(url: &str, timeout: Duration) -> bool {
    let Ok((host, port, uri)) = rtsp_request_uri(url) else {
        return false;
    };
    let request = format!(
        "DESCRIBE {uri} RTSP/1.0\r\nCSeq: 1\r\nAccept: application/sdp\r\nUser-Agent: {USER_AGENT}\r\n\r\n"
    );
    tokio::time::timeout(timeout, async move {
        let mut stream = TcpStream::connect((host.as_str(), port)).await.ok()?;
        stream.write_all(request.as_bytes()).await.ok()?;
        let mut buf = Vec::new();
        let mut chunk = [0u8; 256];
        while !buf.windows(2).any(|w| w == b"\r\n") && buf.len() < MAX_REPLY_BYTES {
            let n = stream.read(&mut chunk).await.ok()?;
            if n == 0 {
                break;
            }
            buf.extend_from_slice(&chunk[..n]);
        }
        Some(status_is_ok(&buf))
    })
    .await
    .ok()
    .flatten()
    .unwrap_or(false)
}

fn status_is_ok(reply: &[u8]) -> bool {
    let line = String::from_utf8_lossy(reply);
    let mut parts = line.split("\r\n").next().unwrap_or("").split_whitespace();
    let proto = parts.next().unwrap_or("");
    let code: u16 = parts.next().and_then(|c| c.parse().ok()).unwrap_or(0);
    proto.starts_with("RTSP/") && ((200..300).contains(&code) || code == 401)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    #[test]
    fn rtsp_request_uri_rebuilds_and_defaults_port() {
        assert_eq!(
            rtsp_request_uri("rtsp://192.168.144.25:8554/video1").unwrap(),
            (
                "192.168.144.25".to_string(),
                8554,
                "rtsp://192.168.144.25:8554/video1".to_string()
            )
        );
        assert_eq!(rtsp_request_uri("rtsp://cam/x").unwrap().1, 554);
        assert_eq!(rtsp_request_uri("rtsp://cam").unwrap().2, "rtsp://cam:554/");
        assert!(matches!(
            rtsp_request_uri("http://x"),
            Err(ProbeError::NotRtsp(_))
        ));
        assert!(matches!(
            rtsp_request_uri("rtsp://a b"),
            Err(ProbeError::BadChars)
        ));
    }

    async fn fake_rtsp(status_line: &'static str) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            while let Ok((mut s, _)) = listener.accept().await {
                let mut buf = [0u8; 512];
                let _ = s.read(&mut buf).await;
                let _ = s
                    .write_all(format!("{status_line}\r\nCSeq: 1\r\n\r\n").as_bytes())
                    .await;
            }
        });
        format!("rtsp://127.0.0.1:{}/video1", addr.port())
    }

    #[tokio::test]
    async fn probe_rtsp_true_on_200_and_401_false_on_404_and_refused() {
        let t = Duration::from_secs(1);
        assert!(probe_rtsp(&fake_rtsp("RTSP/1.0 200 OK").await, t).await);
        assert!(probe_rtsp(&fake_rtsp("RTSP/1.0 401 Unauthorized").await, t).await);
        assert!(!probe_rtsp(&fake_rtsp("RTSP/1.0 404 Not Found").await, t).await);
        assert!(!probe_rtsp("rtsp://127.0.0.1:1/video1", t).await);
        assert!(!probe_rtsp("http://nope", t).await);
    }
}
