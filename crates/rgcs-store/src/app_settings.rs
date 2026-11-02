//! `app_settings` (migration 0001): small key → value application settings.

use sqlx::Row;

use crate::{Result, Store};

/// Key of the 地図表示 › ジンバルを地面に投影 switch.
pub const GIMBAL_GROUND_PROJECTION: &str = "map.gimbal_ground_projection";
/// Key of 地図表示 › 軌跡を残す時間 (minutes, 0–120).
pub const TRACK_MINUTES: &str = "map.track_minutes";
/// Key of the RGCS MAVLink SYSID (1–255).
pub const GCS_SYSID: &str = "mavlink.gcs_sysid";
/// Key of the 実験機能 › AI 緊急介入 settings (JSON `GuardSettings`).
pub const GUARD_SETTINGS: &str = "guard.settings";
/// Key of the 外的要因データ settings (JSON `EnvSettings`).
pub const ENV_SETTINGS: &str = "env.settings";

impl Store {
    pub async fn app_setting(&self, key: &str) -> Result<Option<String>> {
        let row = sqlx::query("SELECT value FROM app_settings WHERE key = ?1")
            .bind(key)
            .fetch_optional(&self.pool)
            .await?;
        Ok(row.map(|r| r.get("value")))
    }

    pub async fn put_app_setting(&self, key: &str, value: &str) -> Result<()> {
        sqlx::query("INSERT INTO app_settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
            .bind(key)
            .bind(value)
            .execute(&self.pool)
            .await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use crate::Store;

    #[tokio::test]
    async fn guard_and_env_settings_are_absent_on_a_fresh_db() {
        let s = Store::open_memory().await.unwrap();
        assert_eq!(s.app_setting(super::GUARD_SETTINGS).await.unwrap(), None);
        assert_eq!(s.app_setting(super::ENV_SETTINGS).await.unwrap(), None);
        assert_eq!(super::GUARD_SETTINGS, "guard.settings");
        assert_eq!(super::ENV_SETTINGS, "env.settings");
    }

    #[tokio::test]
    async fn app_setting_round_trips_and_survives_a_reopen() {
        let dir = std::env::temp_dir().join(format!("rgcs-app-{}", uuid::Uuid::new_v4().simple()));
        let path = dir.join("rgcs.db");
        {
            let s = Store::open(&path).await.unwrap();
            assert_eq!(s.app_setting("map.gimbal_ground_projection").await.unwrap(), None);
            s.put_app_setting("map.gimbal_ground_projection", "true")
                .await
                .unwrap();
            s.put_app_setting("map.gimbal_ground_projection", "false")
                .await
                .unwrap();
            s.put_app_setting("map.gimbal_ground_projection", "true")
                .await
                .unwrap();
        }
        let s = Store::open(&path).await.unwrap();
        assert_eq!(
            s.app_setting("map.gimbal_ground_projection")
                .await
                .unwrap()
                .as_deref(),
            Some("true")
        );
        let _ = std::fs::remove_dir_all(dir);
    }
}
