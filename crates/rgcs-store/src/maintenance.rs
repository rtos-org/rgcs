//! 点検整備記録 (様式 3): hand-entered maintenance rows with a snapshot of the total flight time.

use rgcs_core::jst;
use rgcs_core::{MaintenanceInput, MaintenanceRecord, SysId};
use sqlx::Row;

use crate::{unix_ms, Result, Store, StoreError};

fn record_of(r: &sqlx::sqlite::SqliteRow) -> MaintenanceRecord {
    MaintenanceRecord {
        id: r.get("id"),
        sysid: r.get::<i64, _>("sysid") as SysId,
        performed_on: r.get("performed_on"),
        total_minutes: r.get::<i64, _>("total_minutes").max(0) as u32,
        detail: r.get("detail"),
        reason: r.get("reason"),
        place: r.get("place"),
        engineer: r.get("engineer"),
        notes: r.get("notes"),
        supersedes: r.get("supersedes"),
        created_by: r.get("created_by"),
        created_at: r.get::<i64, _>("created_at").max(0) as u64,
    }
}

impl Store {
    /// Inserts a record with `total_minutes` = the vehicle's total at this moment.
    pub async fn create_maintenance(
        &self,
        sysid: SysId,
        input: &MaintenanceInput,
        by: &str,
    ) -> Result<MaintenanceRecord> {
        if !jst::is_date(&input.performed_on) {
            return Err(StoreError::Invalid("performed_on".into()));
        }
        let total = self.total_flight_minutes(sysid).await?;
        let res = sqlx::query(
            "INSERT INTO maintenance_records (sysid, performed_on, total_minutes, detail, reason, place, engineer, notes, \
             supersedes, created_by, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        )
        .bind(i64::from(sysid))
        .bind(&input.performed_on)
        .bind(i64::from(total))
        .bind(&input.detail)
        .bind(&input.reason)
        .bind(&input.place)
        .bind(&input.engineer)
        .bind(&input.notes)
        .bind(input.supersedes)
        .bind(by)
        .bind(unix_ms() as i64)
        .execute(&self.pool)
        .await?;
        let row = sqlx::query("SELECT * FROM maintenance_records WHERE id = ?1")
            .bind(res.last_insert_rowid())
            .fetch_one(&self.pool)
            .await?;
        Ok(record_of(&row))
    }

    pub async fn maintenance(&self, id: i64) -> Result<Option<MaintenanceRecord>> {
        let row = sqlx::query("SELECT * FROM maintenance_records WHERE id = ?1")
            .bind(id)
            .fetch_optional(&self.pool)
            .await?;
        Ok(row.as_ref().map(record_of))
    }

    pub async fn maintenance_is_superseded(&self, id: i64) -> Result<bool> {
        let v: Option<i64> =
            sqlx::query_scalar("SELECT id FROM maintenance_records WHERE supersedes = ?1 LIMIT 1")
                .bind(id)
                .fetch_optional(&self.pool)
                .await?;
        Ok(v.is_some())
    }

    /// Non-superseded records of one vehicle, ascending `performed_on`, within the dates when given.
    pub async fn list_maintenance(
        &self,
        sysid: SysId,
        from: Option<&str>,
        to: Option<&str>,
    ) -> Result<Vec<MaintenanceRecord>> {
        let rows = sqlx::query(
            "SELECT * FROM maintenance_records WHERE sysid = ?1 \
             AND (?2 IS NULL OR performed_on >= ?2) AND (?3 IS NULL OR performed_on <= ?3) \
             AND id NOT IN (SELECT supersedes FROM maintenance_records WHERE supersedes IS NOT NULL) \
             ORDER BY performed_on, id",
        )
        .bind(i64::from(sysid))
        .bind(from)
        .bind(to)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.iter().map(record_of).collect())
    }
}

#[cfg(test)]
mod tests {
    use rgcs_core::{FlightInput, MaintenanceInput};

    use crate::Store;

    #[tokio::test]
    async fn maintenance_snapshots_total_minutes() {
        let s = Store::open_memory().await.unwrap();
        s.create_flight(
            1,
            &FlightInput {
                pilot: "a".into(),
                pilot_license: "".into(),
                takeoff_at: 1_796_050_800_000,
                landed_at: 1_796_050_800_000 + 90_000,
                takeoff_place: "".into(),
                landing_place: "".into(),
                purposes: vec![],
                specific_flight: vec![],
                summary: "".into(),
                safety_notes: "".into(),
            },
            "admin",
        )
        .await
        .unwrap();
        let input = MaintenanceInput {
            performed_on: "2026-12-10".into(),
            detail: "プロペラ交換".into(),
            reason: "損傷".into(),
            place: "工場".into(),
            engineer: "admin".into(),
            notes: "".into(),
            supersedes: None,
        };
        let m = s.create_maintenance(1, &input, "admin").await.unwrap();
        assert_eq!(m.total_minutes, 2);
        let fixed = s
            .create_maintenance(
                1,
                &MaintenanceInput {
                    supersedes: Some(m.id),
                    ..input.clone()
                },
                "admin",
            )
            .await
            .unwrap();
        let list = s.list_maintenance(1, None, None).await.unwrap();
        assert_eq!(list.iter().map(|r| r.id).collect::<Vec<_>>(), vec![fixed.id]);
        assert_eq!(s.maintenance(m.id).await.unwrap().unwrap().sysid, 1);
        assert!(s.maintenance_is_superseded(m.id).await.unwrap());
        assert!(!s.maintenance_is_superseded(fixed.id).await.unwrap());
        assert!(s.maintenance(999).await.unwrap().is_none());
        assert!(s
            .list_maintenance(1, Some("2026-12-11"), None)
            .await
            .unwrap()
            .is_empty());
        assert!(s
            .create_maintenance(
                1,
                &MaintenanceInput {
                    performed_on: "bad".into(),
                    ..input
                },
                "admin"
            )
            .await
            .is_err());
    }
}
