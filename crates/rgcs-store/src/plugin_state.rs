//! `plugin_state`: plugins an admin switched off or on.
//! No row means enabled: placing the folder is the admin's decision.

use std::collections::HashMap;

use sqlx::Row;

use crate::{Result, Store};

impl Store {
    /// Every stored choice, by plugin id.
    pub async fn plugin_enabled(&self) -> Result<HashMap<String, bool>> {
        let rows = sqlx::query("SELECT plugin_id, enabled FROM plugin_state")
            .fetch_all(&self.pool)
            .await?;
        Ok(rows
            .iter()
            .map(|r| (r.get("plugin_id"), r.get::<i64, _>("enabled") != 0))
            .collect())
    }

    pub async fn set_plugin_enabled(&self, id: &str, enabled: bool) -> Result<()> {
        sqlx::query(
            "INSERT INTO plugin_state (plugin_id, enabled) VALUES (?1, ?2) \
             ON CONFLICT(plugin_id) DO UPDATE SET enabled = excluded.enabled",
        )
        .bind(id)
        .bind(i64::from(enabled))
        .execute(&self.pool)
        .await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use crate::Store;

    #[tokio::test]
    async fn choices_are_stored_and_overwritten() {
        let s = Store::open_memory().await.unwrap();
        assert!(s.plugin_enabled().await.unwrap().is_empty());
        s.set_plugin_enabled("docomo-lte", false).await.unwrap();
        s.set_plugin_enabled("sea", true).await.unwrap();
        s.set_plugin_enabled("docomo-lte", true).await.unwrap();
        s.set_plugin_enabled("sea", false).await.unwrap();
        let m = s.plugin_enabled().await.unwrap();
        assert_eq!(m.len(), 2);
        assert_eq!((m["docomo-lte"], m["sea"]), (true, false));
    }
}
