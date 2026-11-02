//! `param_history`: append-only record of every parameter write and whether
//! the read-back matched.

use rgcs_core::{ParamHistoryEntry, SysId};
use sqlx::Row;

use crate::{now_iso, Result, Store};

#[derive(Debug, Clone)]
pub struct ParamHistoryInput<'a> {
    pub operator: &'a str,
    pub sysid: SysId,
    pub name: &'a str,
    pub old_value: Option<f32>,
    pub new_value: f32,
    pub verified: bool,
}

impl Store {
    pub async fn record_param(&self, e: ParamHistoryInput<'_>) -> Result<i64> {
        let res = sqlx::query(
            "INSERT INTO param_history (ts, operator, sysid, name, old_value, new_value, verified) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        )
        .bind(now_iso())
        .bind(e.operator)
        .bind(i64::from(e.sysid))
        .bind(e.name)
        .bind(e.old_value.map(f64::from))
        .bind(f64::from(e.new_value))
        .bind(i64::from(e.verified))
        .execute(&self.pool)
        .await?;
        Ok(res.last_insert_rowid())
    }

    /// Newest first, optionally for one vehicle.
    pub async fn recent_params(&self, sysid: Option<SysId>, limit: u32) -> Result<Vec<ParamHistoryEntry>> {
        let rows = sqlx::query(
            "SELECT id, ts, operator, sysid, name, old_value, new_value, verified FROM param_history \
             WHERE (?1 IS NULL OR sysid = ?1) ORDER BY id DESC LIMIT ?2",
        )
        .bind(sysid.map(i64::from))
        .bind(i64::from(limit))
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|r| ParamHistoryEntry {
                id: r.get("id"),
                ts: r.get("ts"),
                operator: r.get("operator"),
                sysid: r.get::<i64, _>("sysid") as SysId,
                name: r.get("name"),
                old_value: r.get::<Option<f64>, _>("old_value").map(|v| v as f32),
                new_value: r.get::<f64, _>("new_value") as f32,
                verified: r.get::<i64, _>("verified") != 0,
            })
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use crate::Store;

    #[tokio::test]
    async fn records_and_lists_newest_first() {
        let s = Store::open_memory().await.unwrap();
        s.record_param(super::ParamHistoryInput {
            operator: "admin",
            sysid: 1,
            name: "FENCE_ALT_MAX",
            old_value: Some(100.0),
            new_value: 150.0,
            verified: true,
        })
        .await
        .unwrap();
        s.record_param(super::ParamHistoryInput {
            operator: "admin",
            sysid: 2,
            name: "WPNAV_SPEED",
            old_value: None,
            new_value: 800.0,
            verified: false,
        })
        .await
        .unwrap();
        let all = s.recent_params(None, 10).await.unwrap();
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].name, "WPNAV_SPEED");
        assert!(!all[0].verified);
        assert_eq!(all[0].old_value, None);
        let one = s.recent_params(Some(1), 10).await.unwrap();
        assert_eq!(one.len(), 1);
        assert_eq!(
            (
                one[0].name.as_str(),
                one[0].old_value,
                one[0].new_value,
                one[0].verified
            ),
            ("FENCE_ALT_MAX", Some(100.0), 150.0, true)
        );
        assert!(!one[0].ts.is_empty());
    }
}
