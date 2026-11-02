//! `guard_decisions` (migration 0013): one row per AI 緊急介入 phase change, holding the
//! replayable decision record.

use rgcs_core::SysId;
use sqlx::Row;

use crate::{Result, Store};

/// Most rows `decisions` returns in one call.
pub const MAX_DECISIONS: u32 = 500;

#[derive(Debug, Clone)]
pub struct NewDecision<'a> {
    pub ts: u64,
    pub sysid: SysId,
    pub alert_id: &'a str,
    pub event: &'a str,
    pub phase: &'a str,
    pub level: &'a str,
    pub flight_id: Option<i64>,
    pub record: &'a str,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecisionRow {
    pub id: i64,
    pub ts: u64,
    pub sysid: SysId,
    pub alert_id: String,
    pub event: String,
    pub phase: String,
    pub level: String,
    pub flight_id: Option<i64>,
    pub record: String,
}

fn row_of(r: &sqlx::sqlite::SqliteRow) -> DecisionRow {
    DecisionRow {
        id: r.get("id"),
        ts: r.get::<i64, _>("ts").max(0) as u64,
        sysid: r.get::<i64, _>("sysid") as SysId,
        alert_id: r.get("alert_id"),
        event: r.get("event"),
        phase: r.get("phase"),
        level: r.get("level"),
        flight_id: r.get("flight_id"),
        record: r.get("record"),
    }
}

impl Store {
    pub async fn record_decision(&self, d: NewDecision<'_>) -> Result<i64> {
        let res = sqlx::query(
            "INSERT INTO guard_decisions (ts, sysid, alert_id, event, phase, level, flight_id, record) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        )
        .bind(d.ts as i64)
        .bind(i64::from(d.sysid))
        .bind(d.alert_id)
        .bind(d.event)
        .bind(d.phase)
        .bind(d.level)
        .bind(d.flight_id)
        .bind(d.record)
        .execute(&self.pool)
        .await?;
        Ok(res.last_insert_rowid())
    }

    /// Newest first; `limit` is clamped to 1..=`MAX_DECISIONS`.
    pub async fn decisions(&self, sysid: Option<SysId>, limit: u32) -> Result<Vec<DecisionRow>> {
        let limit = i64::from(limit.clamp(1, MAX_DECISIONS));
        let rows = sqlx::query(
            "SELECT * FROM guard_decisions WHERE (?1 IS NULL OR sysid = ?1) \
             ORDER BY ts DESC, id DESC LIMIT ?2",
        )
        .bind(sysid.map(i64::from))
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.iter().map(row_of).collect())
    }

    /// Keeps the newest `keep` rows; returns how many were deleted.
    pub async fn prune_decisions(&self, keep: u32) -> Result<u64> {
        let res = sqlx::query(
            "DELETE FROM guard_decisions WHERE id NOT IN \
             (SELECT id FROM guard_decisions ORDER BY ts DESC, id DESC LIMIT ?1)",
        )
        .bind(i64::from(keep))
        .execute(&self.pool)
        .await?;
        Ok(res.rows_affected())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn new<'a>(ts: u64, sysid: SysId, event: &'a str, record: &'a str) -> NewDecision<'a> {
        NewDecision {
            ts,
            sysid,
            alert_id: "a-1",
            event,
            phase: "alerting",
            level: "l1",
            flight_id: Some(7),
            record,
        }
    }

    #[tokio::test]
    async fn fresh_db_migrates_and_ids_count_up() {
        let s = Store::open_memory().await.unwrap();
        assert_eq!(
            s.record_decision(new(10, 1, "toilet_bowl", "{}")).await.unwrap(),
            1
        );
        assert_eq!(
            s.record_decision(new(20, 1, "toilet_bowl", "{}")).await.unwrap(),
            2
        );
    }

    #[tokio::test]
    async fn decisions_filter_by_sysid_newest_first() {
        let s = Store::open_memory().await.unwrap();
        s.record_decision(new(10, 3, "toilet_bowl", "{\"n\":1}"))
            .await
            .unwrap();
        s.record_decision(new(15, 4, "toilet_bowl", "{}")).await.unwrap();
        s.record_decision(new(20, 3, "toilet_bowl", "{\"n\":2}"))
            .await
            .unwrap();
        let rows = s.decisions(Some(3), 10).await.unwrap();
        assert_eq!(rows.iter().map(|r| r.ts).collect::<Vec<_>>(), vec![20, 10]);
        assert!(rows.iter().all(|r| r.sysid == 3));
        assert_eq!(rows[0].record, "{\"n\":2}");
        assert_eq!(rows[0].flight_id, Some(7));
        assert_eq!(s.decisions(None, 10).await.unwrap().len(), 3);
        assert_eq!(s.decisions(None, 2).await.unwrap().len(), 2);
    }

    #[tokio::test]
    async fn decisions_limit_is_clamped() {
        let s = Store::open_memory().await.unwrap();
        s.record_decision(new(10, 1, "toilet_bowl", "{}")).await.unwrap();
        assert_eq!(s.decisions(None, 0).await.unwrap().len(), 1);
        assert_eq!(s.decisions(None, u32::MAX).await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn unknown_event_or_level_is_rejected() {
        let s = Store::open_memory().await.unwrap();
        assert!(s.record_decision(new(10, 1, "wall", "{}")).await.is_err());
        let mut d = new(10, 1, "toilet_bowl", "{}");
        d.level = "l9";
        assert!(s.record_decision(d).await.is_err());
    }

    #[tokio::test]
    async fn prune_keeps_the_newest_rows() {
        let s = Store::open_memory().await.unwrap();
        for ts in 1..=5 {
            s.record_decision(new(ts, 1, "toilet_bowl", "{}")).await.unwrap();
        }
        assert_eq!(s.prune_decisions(2).await.unwrap(), 3);
        let rows = s.decisions(None, 10).await.unwrap();
        assert_eq!(rows.iter().map(|r| r.ts).collect::<Vec<_>>(), vec![5, 4]);
        assert_eq!(s.prune_decisions(2).await.unwrap(), 0);
    }
}
