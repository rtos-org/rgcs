//! Presentation tokens for the audience page: revocable, never shown twice.

use sqlx::Row;

use crate::{now_iso, Result, Store};

pub const TOKEN_PREFIX_LEN: usize = 6;

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct PresentationToken {
    /// First six characters: enough to identify a token in a list without exposing it.
    pub token_prefix: String,
    pub label: String,
    pub created_by: String,
    pub created_at: String,
    pub revoked_at: Option<String>,
}

impl Store {
    /// Returns the full token once; afterwards only its prefix is ever listed.
    pub async fn create_presentation_token(&self, label: &str, created_by: &str) -> Result<String> {
        let token = uuid::Uuid::new_v4().simple().to_string();
        sqlx::query(
            "INSERT INTO presentation_tokens (token, label, created_by, created_at) VALUES (?1, ?2, ?3, ?4)",
        )
        .bind(&token)
        .bind(label)
        .bind(created_by)
        .bind(now_iso())
        .execute(&self.pool)
        .await?;
        Ok(token)
    }

    pub async fn list_presentation_tokens(&self) -> Result<Vec<PresentationToken>> {
        let rows = sqlx::query("SELECT token, label, created_by, created_at, revoked_at FROM presentation_tokens ORDER BY created_at DESC")
            .fetch_all(&self.pool)
            .await?;
        Ok(rows
            .into_iter()
            .map(|r| {
                let token: String = r.get("token");
                PresentationToken {
                    token_prefix: token.chars().take(TOKEN_PREFIX_LEN).collect(),
                    label: r.get("label"),
                    created_by: r.get("created_by"),
                    created_at: r.get("created_at"),
                    revoked_at: r.get("revoked_at"),
                }
            })
            .collect())
    }

    /// Revokes by prefix; false when no live token starts with it.
    pub async fn revoke_presentation_token(&self, prefix: &str) -> Result<bool> {
        if prefix.len() < TOKEN_PREFIX_LEN || !prefix.chars().all(|c| c.is_ascii_hexdigit()) {
            return Ok(false);
        }
        let done = sqlx::query("UPDATE presentation_tokens SET revoked_at = ?1 WHERE revoked_at IS NULL AND substr(token, 1, ?2) = ?3")
            .bind(now_iso())
            .bind(TOKEN_PREFIX_LEN as i64)
            .bind(prefix)
            .execute(&self.pool)
            .await?;
        Ok(done.rows_affected() > 0)
    }

    pub async fn presentation_token_valid(&self, token: &str) -> Result<bool> {
        if token.len() != 32 || !token.chars().all(|c| c.is_ascii_hexdigit()) {
            return Ok(false);
        }
        let row =
            sqlx::query("SELECT 1 AS ok FROM presentation_tokens WHERE token = ?1 AND revoked_at IS NULL")
                .bind(token)
                .fetch_optional(&self.pool)
                .await?;
        Ok(row.is_some())
    }
}

#[cfg(test)]
mod tests {
    use crate::Store;

    #[tokio::test]
    async fn create_list_validate_and_revoke() {
        let s = Store::open_memory().await.unwrap();
        let token = s
            .create_presentation_token("会場モニター", "admin")
            .await
            .unwrap();
        assert_eq!(token.len(), 32);
        assert!(token.chars().all(|c| c.is_ascii_hexdigit()));
        assert!(s.presentation_token_valid(&token).await.unwrap());
        assert!(!s.presentation_token_valid("0000").await.unwrap());
        let list = s.list_presentation_tokens().await.unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].token_prefix, &token[..6]);
        assert_eq!(list[0].label, "会場モニター");
        assert!(list[0].revoked_at.is_none());
        assert!(s.revoke_presentation_token(&token[..6]).await.unwrap());
        assert!(!s.presentation_token_valid(&token).await.unwrap());
        assert!(s.list_presentation_tokens().await.unwrap()[0]
            .revoked_at
            .is_some());
        assert!(!s.revoke_presentation_token("zzzzzz").await.unwrap());
    }
}
