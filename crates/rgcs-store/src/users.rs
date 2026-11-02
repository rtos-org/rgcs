//! Users table. The seeded `admin` / `admin` pair is the mock login; while it
//! still works the server reports `dev_mode = true` and the UI shows a badge.

use rgcs_core::operator::Role;
use sqlx::Row;

use crate::password::{hash_password, verify_password};
use crate::{now_iso, Result, Store};

pub const DEV_USERNAME: &str = "admin";
pub const DEV_PASSWORD: &str = "admin";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UserRow {
    pub username: String,
    pub role: Role,
    pub disabled: bool,
}

fn parse_role(s: &str) -> Role {
    if s == "admin" {
        Role::Admin
    } else {
        Role::Operator
    }
}

impl Store {
    /// Creates `admin` / `admin` when the users table is empty (first start).
    pub(crate) async fn seed_dev_admin(&self) -> Result<()> {
        let count: i64 = sqlx::query("SELECT COUNT(*) AS n FROM users")
            .fetch_one(&self.pool)
            .await?
            .get("n");
        if count == 0 {
            self.create_user(DEV_USERNAME, DEV_PASSWORD, Role::Admin).await?;
            tracing::warn!("seeded development account admin/admin; change it before deployment");
        }
        Ok(())
    }

    pub async fn create_user(&self, username: &str, password: &str, role: Role) -> Result<()> {
        let hash = hash_password(password)?;
        let role = match role {
            Role::Admin => "admin",
            Role::Operator => "operator",
        };
        sqlx::query("INSERT INTO users (username, password_hash, role, created_at) VALUES (?1, ?2, ?3, ?4)")
            .bind(username)
            .bind(hash)
            .bind(role)
            .bind(now_iso())
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    /// `Some(user)` when the password matches an enabled account.
    pub async fn verify_login(&self, username: &str, password: &str) -> Result<Option<UserRow>> {
        let row =
            sqlx::query("SELECT username, password_hash, role, disabled FROM users WHERE username = ?1")
                .bind(username)
                .fetch_optional(&self.pool)
                .await?;
        let Some(row) = row else {
            // Pay the full KDF cost so timing does not reveal whether the user exists.
            let _ = verify_password(password, crate::password::dummy_hash());
            return Ok(None);
        };
        let hash: String = row.get("password_hash");
        let disabled: i64 = row.get("disabled");
        if disabled != 0 || !verify_password(password, &hash) {
            return Ok(None);
        }
        Ok(Some(UserRow {
            username: row.get("username"),
            role: parse_role(&row.get::<String, _>("role")),
            disabled: false,
        }))
    }

    pub async fn user(&self, username: &str) -> Result<Option<UserRow>> {
        let row = sqlx::query("SELECT username, role, disabled FROM users WHERE username = ?1")
            .bind(username)
            .fetch_optional(&self.pool)
            .await?;
        Ok(row.map(|r| UserRow {
            username: r.get("username"),
            role: parse_role(&r.get::<String, _>("role")),
            disabled: r.get::<i64, _>("disabled") != 0,
        }))
    }

    /// True while the seeded development credentials still log in.
    pub async fn dev_mode(&self) -> Result<bool> {
        Ok(self.verify_login(DEV_USERNAME, DEV_PASSWORD).await?.is_some())
    }

    pub async fn set_password(&self, username: &str, password: &str) -> Result<()> {
        let hash = hash_password(password)?;
        sqlx::query("UPDATE users SET password_hash = ?1 WHERE username = ?2")
            .bind(hash)
            .bind(username)
            .execute(&self.pool)
            .await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn seeds_admin_and_reports_dev_mode() {
        let s = Store::open_memory().await.unwrap();
        let u = s.verify_login("admin", "admin").await.unwrap().unwrap();
        assert_eq!(u.role, Role::Admin);
        assert!(s.dev_mode().await.unwrap());
        assert!(s.verify_login("admin", "wrong").await.unwrap().is_none());
        assert!(s.verify_login("nobody", "admin").await.unwrap().is_none());
    }

    #[tokio::test]
    async fn changing_the_password_leaves_dev_mode() {
        let s = Store::open_memory().await.unwrap();
        s.set_password("admin", "correct horse").await.unwrap();
        assert!(!s.dev_mode().await.unwrap());
        assert!(s.verify_login("admin", "correct horse").await.unwrap().is_some());
        assert_eq!(s.user("admin").await.unwrap().unwrap().username, "admin");
        assert!(s.user("ghost").await.unwrap().is_none());
    }
}
