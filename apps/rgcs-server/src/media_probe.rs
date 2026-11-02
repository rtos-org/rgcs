//! MediaMTX liveness for the network view: a TCP connect to the WHEP upstream's
//! host:port every 5 s.

use std::sync::{Arc, Mutex as StdMutex};
use std::time::Duration;

use rgcs_core::network::MediaServer;

use crate::network::redact_url;

pub const PROBE_PERIOD: Duration = Duration::from_millis(5_000);
pub const PROBE_TIMEOUT: Duration = Duration::from_millis(1_000);

/// The last probe result; `reachable` stays `None` until the first probe ends.
#[derive(Clone, Default)]
pub struct MediaProbe {
    url: Arc<StdMutex<String>>,
    reachable: Arc<StdMutex<Option<bool>>>,
}

impl MediaProbe {
    /// Starts probing `whep_upstream` every `PROBE_PERIOD` (first probe right away).
    pub fn spawn(&self, whep_upstream: &str) {
        *lock(&self.url) = whep_upstream.to_string();
        let probe = self.clone();
        let url = whep_upstream.to_string();
        tokio::spawn(async move {
            let mut tick = tokio::time::interval(PROBE_PERIOD);
            tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            loop {
                tick.tick().await;
                let ok = probe_once(&url, PROBE_TIMEOUT).await;
                *lock(&probe.reachable) = Some(ok);
            }
        });
    }

    /// The upstream without userinfo, and the last result.
    pub fn status(&self) -> MediaServer {
        MediaServer {
            whep_upstream: redact_url(&lock(&self.url)),
            reachable: *lock(&self.reachable),
        }
    }
}

/// Poison-tolerant: a panicked prober must not take the topology down.
fn lock<T>(m: &StdMutex<T>) -> std::sync::MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// `host:port` of a URL, the port defaulting by scheme (80 / 443).
fn target(url: &str) -> Option<String> {
    let u = url::Url::parse(url).ok()?;
    let host = u.host_str()?;
    let port = u.port_or_known_default()?;
    Some(format!("{host}:{port}"))
}

/// True when a TCP connection to the URL's host:port opens within `timeout`.
pub async fn probe_once(url: &str, timeout: Duration) -> bool {
    let Some(addr) = target(url) else {
        return false;
    };
    matches!(
        tokio::time::timeout(timeout, tokio::net::TcpStream::connect(addr)).await,
        Ok(Ok(_))
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn probe_reaches_listener() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let url = format!("http://127.0.0.1:{port}/mt11/whep");
        assert!(probe_once(&url, Duration::from_secs(1)).await);
    }

    #[tokio::test]
    async fn probe_fails_on_closed_port() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);
        let url = format!("http://127.0.0.1:{port}/mt11/whep");
        assert!(!probe_once(&url, Duration::from_secs(1)).await);
    }

    #[tokio::test]
    async fn probe_fails_on_garbage_url() {
        assert!(!probe_once("not a url", Duration::from_secs(1)).await);
    }

    #[test]
    fn status_before_first_probe_is_none() {
        assert_eq!(MediaProbe::default().status().reachable, None);
    }

    #[test]
    fn default_port_follows_scheme() {
        assert_eq!(target("http://10.0.0.2/x").as_deref(), Some("10.0.0.2:80"));
        assert_eq!(target("https://10.0.0.2/x").as_deref(), Some("10.0.0.2:443"));
        assert_eq!(target("http://[::1]:8889/x").as_deref(), Some("[::1]:8889"));
    }
}
