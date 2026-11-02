//! Opaque session tokens (256 bits of randomness) with a 12 h lifetime.

use sqlx::Row;
use time::{Duration, OffsetDateTime};

use crate::{iso, now_iso, Result, Store, UserRow};

pub const SESSION_HOURS: i64 = 12;

fn new_token() -> String {
    format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    )
}

impl Store {
    /// Issues a new session and returns its token (the cookie value).
    pub async fn create_session(&self, username: &str) -> Result<String> {
        let token = new_token();
        let expires = iso(OffsetDateTime::now_utc() + Duration::hours(SESSION_HOURS));
        sqlx::query("INSERT INTO sessions (token, username, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)")
            .bind(&token)
            .bind(username)
            .bind(now_iso())
            .bind(expires)
            .execute(&self.pool)
            .await?;
        Ok(token)
    }

    /// The user behind a token, if it exists, has not expired and the account is enabled.
    pub async fn session_user(&self, token: &str) -> Result<Option<UserRow>> {
        let row = sqlx::query(
            "SELECT u.username, u.role, u.disabled FROM sessions s JOIN users u ON u.username = s.username \
             WHERE s.token = ?1 AND s.expires_at > ?2",
        )
        .bind(token)
        .bind(now_iso())
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.filter(|r| r.get::<i64, _>("disabled") == 0).map(|r| UserRow {
            username: r.get("username"),
            role: if r.get::<String, _>("role") == "admin" {
                rgcs_core::operator::Role::Admin
            } else {
                rgcs_core::operator::Role::Operator
            },
            disabled: false,
        }))
    }

    pub async fn delete_session(&self, token: &str) -> Result<()> {
        sqlx::query("DELETE FROM sessions WHERE token = ?1")
            .bind(token)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    /// Removes expired rows; returns how many were deleted.
    pub async fn purge_expired_sessions(&self) -> Result<u64> {
        let res = sqlx::query("DELETE FROM sessions WHERE expires_at <= ?1")
            .bind(now_iso())
            .execute(&self.pool)
            .await?;
        Ok(res.rows_affected())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn session_lifecycle() {
        let s = Store::open_memory().await.unwrap();
        let token = s.create_session("admin").await.unwrap();
        assert_eq!(token.len(), 64);
        assert_eq!(s.session_user(&token).await.unwrap().unwrap().username, "admin");
        assert!(s.session_user("nope").await.unwrap().is_none());
        s.delete_session(&token).await.unwrap();
        assert!(s.session_user(&token).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn expired_sessions_are_invisible_and_purged() {
        let s = Store::open_memory().await.unwrap();
        let token = s.create_session("admin").await.unwrap();
        sqlx::query("UPDATE sessions SET expires_at = '2000-01-01T00:00:00Z'")
            .execute(s.pool())
            .await
            .unwrap();
        assert!(s.session_user(&token).await.unwrap().is_none());
        assert_eq!(s.purge_expired_sessions().await.unwrap(), 1);
    }
}
