//! `plan_assignments`: one row per vehicle with its assigned plan and the last plan written.

use rgcs_core::{Assignment, SysId, Written};
use sqlx::Row;

use crate::{unix_ms, Result, Store, StoreError};

fn row_to_assignment(r: &sqlx::sqlite::SqliteRow) -> Assignment {
    let written = r.get::<Option<i64>, _>("written_plan_id").map(|plan_id| Written {
        plan_id,
        plan_updated_at: r.get::<Option<i64>, _>("written_plan_updated_at").unwrap_or(0) as u64,
        at: r.get::<Option<i64>, _>("written_at").unwrap_or(0) as u64,
        by: r.get::<Option<String>, _>("written_by").unwrap_or_default(),
    });
    Assignment {
        sysid: r.get::<i64, _>("sysid") as SysId,
        plan_id: r.get("plan_id"),
        assigned_by: r.get("assigned_by"),
        assigned_at: r.get::<Option<i64>, _>("assigned_at").map(|v| v as u64),
        written,
    }
}

impl Store {
    /// Every vehicle row, sysid ascending.
    pub async fn list_assignments(&self) -> Result<Vec<Assignment>> {
        let rows = sqlx::query("SELECT * FROM plan_assignments ORDER BY sysid")
            .fetch_all(&self.pool)
            .await?;
        Ok(rows.iter().map(row_to_assignment).collect())
    }

    async fn get_assignment(&self, sysid: SysId) -> Result<Assignment> {
        let row = sqlx::query("SELECT * FROM plan_assignments WHERE sysid = ?1")
            .bind(i64::from(sysid))
            .fetch_one(&self.pool)
            .await?;
        Ok(row_to_assignment(&row))
    }

    /// Assigns `plan_id` (or nothing) to the vehicle, keeping its written record.
    /// An unknown plan is `StoreError::NotFound`.
    pub async fn set_assignment(&self, sysid: SysId, plan_id: Option<i64>, by: &str) -> Result<Assignment> {
        if let Some(id) = plan_id {
            let exists: Option<i64> = sqlx::query_scalar("SELECT id FROM missions WHERE id = ?1")
                .bind(id)
                .fetch_optional(&self.pool)
                .await?;
            if exists.is_none() {
                return Err(StoreError::NotFound(format!("plan {id}")));
            }
        }
        sqlx::query(
            "INSERT INTO plan_assignments (sysid, plan_id, assigned_by, assigned_at) VALUES (?1, ?2, ?3, ?4) \
             ON CONFLICT(sysid) DO UPDATE SET plan_id = ?2, assigned_by = ?3, assigned_at = ?4",
        )
        .bind(i64::from(sysid))
        .bind(plan_id)
        .bind(by)
        .bind(unix_ms() as i64)
        .execute(&self.pool)
        .await?;
        self.get_assignment(sysid).await
    }

    /// Records that plan `plan_id` at version `plan_updated_at` was written to the vehicle.
    pub async fn record_written(
        &self,
        sysid: SysId,
        plan_id: i64,
        plan_updated_at: u64,
        by: &str,
    ) -> Result<Assignment> {
        self.upsert_written(
            sysid,
            Some(plan_id),
            Some(plan_updated_at as i64),
            Some(unix_ms() as i64),
            Some(by),
        )
        .await
    }

    /// Forgets what was written to the vehicle (its mission changed outside a saved plan).
    pub async fn clear_written(&self, sysid: SysId) -> Result<Assignment> {
        self.upsert_written(sysid, None, None, None, None).await
    }

    async fn upsert_written(
        &self,
        sysid: SysId,
        plan_id: Option<i64>,
        plan_updated_at: Option<i64>,
        at: Option<i64>,
        by: Option<&str>,
    ) -> Result<Assignment> {
        sqlx::query(
            "INSERT INTO plan_assignments (sysid, written_plan_id, written_plan_updated_at, written_at, written_by) \
             VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(sysid) DO UPDATE SET written_plan_id = ?2, \
             written_plan_updated_at = ?3, written_at = ?4, written_by = ?5",
        )
        .bind(i64::from(sysid))
        .bind(plan_id)
        .bind(plan_updated_at)
        .bind(at)
        .bind(by)
        .execute(&self.pool)
        .await?;
        self.get_assignment(sysid).await
    }
}

#[cfg(test)]
mod tests {
    use rgcs_core::demo20;

    use crate::{Store, StoreError};

    async fn store_with_plan() -> Store {
        let s = Store::open_memory().await.unwrap();
        s.create_mission(&demo20(), "admin").await.unwrap();
        s
    }

    #[tokio::test]
    async fn set_list_round_trip() {
        let s = store_with_plan().await;
        assert!(s.list_assignments().await.unwrap().is_empty());
        let a = s.set_assignment(3, Some(1), "admin").await.unwrap();
        assert_eq!((a.sysid, a.plan_id), (3, Some(1)));
        assert_eq!(a.assigned_by.as_deref(), Some("admin"));
        assert!(a.assigned_at.unwrap() > 1_700_000_000_000);
        assert!(a.written.is_none());
        s.set_assignment(2, Some(1), "ops").await.unwrap();
        let rows = s.list_assignments().await.unwrap();
        let ids: Vec<_> = rows.iter().map(|r| (r.sysid, r.plan_id)).collect();
        assert_eq!(ids, vec![(2, Some(1)), (3, Some(1))]);
        let cleared = s.set_assignment(2, None, "admin").await.unwrap();
        assert_eq!(
            (cleared.plan_id, cleared.assigned_by.as_deref()),
            (None, Some("admin"))
        );
        assert_eq!(s.list_assignments().await.unwrap()[0].plan_id, None);
    }

    #[tokio::test]
    async fn deleting_a_plan_unassigns_it() {
        let s = store_with_plan().await;
        s.set_assignment(2, Some(1), "admin").await.unwrap();
        s.record_written(2, 1, 1234, "admin").await.unwrap();
        assert!(s.delete_mission(1).await.unwrap());
        let rows = s.list_assignments().await.unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].plan_id, None);
        let w = rows[0].written.as_ref().expect("written is history");
        assert_eq!((w.plan_id, w.plan_updated_at), (1, 1234));
    }

    #[tokio::test]
    async fn record_and_clear_written() {
        let s = store_with_plan().await;
        s.set_assignment(2, Some(1), "admin").await.unwrap();
        let a = s.record_written(2, 1, 1234, "pilot").await.unwrap();
        let w = a.written.expect("recorded");
        assert_eq!((w.plan_id, w.plan_updated_at, w.by.as_str()), (1, 1234, "pilot"));
        assert!(w.at > 1_700_000_000_000);
        assert_eq!(a.plan_id, Some(1));
        let c = s.clear_written(2).await.unwrap();
        assert!(c.written.is_none());
        assert_eq!(c.plan_id, Some(1));
        // A vehicle with no row yet gets one.
        let fresh = s.record_written(5, 1, 99, "pilot").await.unwrap();
        assert_eq!((fresh.plan_id, fresh.written.map(|w| w.plan_id)), (None, Some(1)));
        assert!(s.clear_written(6).await.unwrap().written.is_none());
    }

    #[tokio::test]
    async fn unknown_plan_is_not_found() {
        let s = store_with_plan().await;
        let e = s.set_assignment(2, Some(99), "admin").await.unwrap_err();
        assert!(matches!(e, StoreError::NotFound(_)), "{e:?}");
        assert!(s.list_assignments().await.unwrap().is_empty());
    }
}
