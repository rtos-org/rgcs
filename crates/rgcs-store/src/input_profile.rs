//! `gimbal_input_profile`: a single JSON row.

use rgcs_core::GimbalInputProfile;
use sqlx::Row;

use crate::{now_iso, Result, Store};

impl Store {
    /// The saved profile, or the spec default (also when the saved JSON no longer parses).
    pub async fn gimbal_input_profile(&self) -> Result<GimbalInputProfile> {
        let row = sqlx::query("SELECT json FROM gimbal_input_profile WHERE id = 1")
            .fetch_optional(&self.pool)
            .await?;
        Ok(row
            .and_then(|r| serde_json::from_str(&r.get::<String, _>("json")).ok())
            .unwrap_or_default())
    }

    pub async fn put_gimbal_input_profile(&self, p: &GimbalInputProfile) -> Result<()> {
        let json = serde_json::to_string(p).map_err(|e| crate::StoreError::Password(e.to_string()))?;
        sqlx::query(
            "INSERT INTO gimbal_input_profile (id, json, updated_at) VALUES (1, ?1, ?2) \
             ON CONFLICT(id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at",
        )
        .bind(json)
        .bind(now_iso())
        .execute(&self.pool)
        .await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use crate::Store;
    use rgcs_core::GimbalInputProfile;

    #[tokio::test]
    async fn defaults_when_absent_and_round_trips() {
        let s = Store::open_memory().await.unwrap();
        assert_eq!(
            s.gimbal_input_profile().await.unwrap(),
            GimbalInputProfile::default()
        );
        let p = GimbalInputProfile {
            max_pan_speed: 55.0,
            ..GimbalInputProfile::default()
        };
        s.put_gimbal_input_profile(&p).await.unwrap();
        assert_eq!(s.gimbal_input_profile().await.unwrap(), p);
        let p2 = GimbalInputProfile {
            max_tilt_speed: 12.0,
            ..p.clone()
        };
        s.put_gimbal_input_profile(&p2).await.unwrap();
        assert_eq!(s.gimbal_input_profile().await.unwrap().max_tilt_speed, 12.0);
    }
}
