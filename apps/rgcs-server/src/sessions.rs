//! The live WebSocket sessions (one per browser tab) for the network view's client list.
//! A `SessionGuard` holds the registry entry for the whole life of `ws::session`; its `Drop`
//! is the only remover, so every exit path (close, error, lag, shutdown) cleans up.

use std::collections::BTreeMap;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use rgcs_core::operator::Role;
use rgcs_core::ClientSession;

#[derive(Clone, Default)]
pub struct SessionRegistry {
    inner: Arc<Mutex<BTreeMap<u64, ClientSession>>>,
    next: Arc<AtomicU64>,
}

impl SessionRegistry {
    /// Adds a session; ids start at 1 and follow connect order.
    pub fn register(
        &self,
        username: &str,
        role: Role,
        addr: Option<SocketAddr>,
        user_agent: Option<&str>,
        now_unix_ms: u64,
    ) -> SessionGuard {
        let id = self.next.fetch_add(1, Ordering::Relaxed) + 1;
        let row = ClientSession {
            id,
            username: username.to_string(),
            role,
            addr: addr.map(|a| a.to_string()),
            browser: browser_label(user_agent),
            connected_since_unix_ms: now_unix_ms,
        };
        self.lock().insert(id, row);
        SessionGuard {
            registry: self.clone(),
            id,
        }
    }

    /// Current sessions ordered by id (= connect order).
    pub fn list(&self) -> Vec<ClientSession> {
        self.lock().values().cloned().collect()
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, BTreeMap<u64, ClientSession>> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }
}

/// Removes its session from the registry when dropped.
pub struct SessionGuard {
    registry: SessionRegistry,
    id: u64,
}

impl SessionGuard {
    pub fn id(&self) -> u64 {
        self.id
    }
}

impl Drop for SessionGuard {
    fn drop(&mut self) {
        self.registry.lock().remove(&self.id);
    }
}

/// Coarse browser name from a User-Agent; Edge and Chrome both say `Chrome/`, so order matters.
pub fn browser_label(user_agent: Option<&str>) -> String {
    let ua = user_agent.unwrap_or("");
    let label = if ua.contains("Edg/") {
        "Edge"
    } else if ua.contains("Firefox/") {
        "Firefox"
    } else if ua.contains("Chrome/") {
        "Chrome"
    } else if ua.contains("Safari/") {
        "Safari"
    } else {
        "Other"
    };
    label.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn register_lists_and_drop_removes() {
        let reg = SessionRegistry::default();
        let addr: SocketAddr = "10.0.0.5:51000".parse().unwrap();
        let g1 = reg.register(
            "admin",
            Role::Admin,
            Some(addr),
            Some("x Chrome/129.0 Safari/537.36"),
            1000,
        );
        let _g2 = reg.register("op", Role::Operator, None, None, 2000);
        let rows = reg.list();
        assert_eq!(rows.iter().map(|r| r.id).collect::<Vec<_>>(), vec![1, 2]);
        assert_eq!(rows[0].username, "admin");
        assert_eq!(rows[0].role, Role::Admin);
        assert_eq!(rows[0].addr.as_deref(), Some("10.0.0.5:51000"));
        assert_eq!(rows[0].browser, "Chrome");
        assert_eq!(rows[0].connected_since_unix_ms, 1000);
        assert_eq!(rows[1].addr, None);
        assert_eq!(g1.id(), 1);
        drop(g1);
        assert_eq!(reg.list().iter().map(|r| r.id).collect::<Vec<_>>(), vec![2]);
    }

    #[test]
    fn browser_labels() {
        let cases = [
            (Some("Mozilla/5.0 Chrome/129.0 Safari/537.36 Edg/129.0"), "Edge"),
            (Some("Mozilla/5.0 Gecko/20100101 Firefox/131.0"), "Firefox"),
            (Some("Mozilla/5.0 Chrome/129.0 Safari/537.36"), "Chrome"),
            (Some("Mozilla/5.0 Version/18.0 Safari/605.1.15"), "Safari"),
            (Some("curl/8.7"), "Other"),
            (None, "Other"),
        ];
        for (ua, want) in cases {
            assert_eq!(browser_label(ua), want, "{ua:?}");
        }
    }
}
