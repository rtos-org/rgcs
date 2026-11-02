//! `env_sources` (migration 0013): per-source enable / interval / timeout overrides of the
//! external-data sources. Absent rows read as the defaults.

use sqlx::Row;

use crate::{now_iso, Result, Store};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EnvSourceRow {
    pub id: String,
    pub enabled: bool,
    pub interval_s: u32,
    pub timeout_ms: u32,
}

impl Store {
    pub async fn env_source(&self, id: &str) -> Result<Option<EnvSourceRow>> {
        let row = sqlx::query("SELECT id, enabled, interval_s, timeout_ms FROM env_sources WHERE id = ?1")
            .bind(id)
            .fetch_optional(&self.pool)
            .await?;
        Ok(row.map(|r| EnvSourceRow {
            id: r.get("id"),
            enabled: r.get::<i64, _>("enabled") != 0,
            interval_s: r.get::<i64, _>("interval_s").max(0) as u32,
            timeout_ms: r.get::<i64, _>("timeout_ms").max(0) as u32,
        }))
    }

    pub async fn put_env_source(&self, row: &EnvSourceRow) -> Result<()> {
        sqlx::query(
            "INSERT INTO env_sources (id, enabled, interval_s, timeout_ms, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?5) \
             ON CONFLICT(id) DO UPDATE SET enabled = excluded.enabled, \
             interval_s = excluded.interval_s, timeout_ms = excluded.timeout_ms, \
             updated_at = excluded.updated_at",
        )
        .bind(&row.id)
        .bind(i64::from(row.enabled))
        .bind(i64::from(row.interval_s))
        .bind(i64::from(row.timeout_ms))
        .bind(now_iso())
        .execute(&self.pool)
        .await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(enabled: bool, interval_s: u32) -> EnvSourceRow {
        EnvSourceRow {
            id: "open_meteo".into(),
            enabled,
            interval_s,
            timeout_ms: 8000,
        }
    }

    #[tokio::test]
    async fn absent_source_reads_none() {
        let s = Store::open_memory().await.unwrap();
        assert_eq!(s.env_source("open_meteo").await.unwrap(), None);
    }

    #[tokio::test]
    async fn put_upserts_and_survives_a_reopen() {
        let dir = std::env::temp_dir().join(format!("rgcs-env-{}", uuid::Uuid::new_v4().simple()));
        let path = dir.join("rgcs.db");
        {
            let s = Store::open(&path).await.unwrap();
            s.put_env_source(&row(true, 600)).await.unwrap();
            s.put_env_source(&row(false, 900)).await.unwrap();
        }
        let s = Store::open(&path).await.unwrap();
        assert_eq!(s.env_source("open_meteo").await.unwrap(), Some(row(false, 900)));
        assert_eq!(s.env_source("jma_amedas").await.unwrap(), None);
        let _ = std::fs::remove_dir_all(dir);
    }
}
