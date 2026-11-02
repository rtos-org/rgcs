//! Calibration / motor-test runs: ArduPilot keeps no dates, RGCS does.

use rgcs_core::{CalibKind, CalibRecord, SysId};
use sqlx::Row;

use crate::{unix_ms, Result, Store, StoreError};

impl Store {
    pub async fn record_calibration(
        &self,
        sysid: SysId,
        kind: CalibKind,
        ok: bool,
        operator: &str,
        detail: Option<&str>,
    ) -> Result<()> {
        sqlx::query("INSERT INTO calibrations (sysid, kind, ok, at, operator, detail) VALUES (?1, ?2, ?3, ?4, ?5, ?6)")
            .bind(i64::from(sysid))
            .bind(kind.as_str())
            .bind(ok)
            .bind(unix_ms() as i64)
            .bind(operator)
            .bind(detail)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    /// The latest run of each kind for a vehicle.
    pub async fn latest_calibrations(&self, sysid: SysId) -> Result<Vec<CalibRecord>> {
        let rows = sqlx::query(
            "SELECT kind, ok, at, operator, detail FROM calibrations WHERE id IN \
             (SELECT MAX(id) FROM calibrations WHERE sysid = ?1 GROUP BY kind)",
        )
        .bind(i64::from(sysid))
        .fetch_all(&self.pool)
        .await?;
        rows.iter()
            .map(|r| {
                let kind: String = r.get("kind");
                Ok(CalibRecord {
                    kind: CalibKind::parse(&kind)
                        .ok_or_else(|| StoreError::Invalid(format!("calibration kind {kind}")))?,
                    ok: r.get("ok"),
                    at: r.get::<i64, _>("at").max(0) as u64,
                    operator: r.get("operator"),
                    detail: r.get("detail"),
                })
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn the_latest_run_of_each_kind_is_listed_per_vehicle() {
        let s = Store::open_memory().await.unwrap();
        s.record_calibration(1, CalibKind::Compass, false, "op1", Some("compass_failed"))
            .await
            .unwrap();
        s.record_calibration(1, CalibKind::Compass, true, "op2", None)
            .await
            .unwrap();
        s.record_calibration(1, CalibKind::Level, true, "op1", None)
            .await
            .unwrap();
        s.record_calibration(2, CalibKind::Accel, true, "op1", None)
            .await
            .unwrap();
        let mut list = s.latest_calibrations(1).await.unwrap();
        list.sort_by_key(|r| r.kind.as_str());
        assert_eq!(list.len(), 2);
        assert_eq!(
            (list[0].kind, list[0].ok, list[0].operator.as_str()),
            (CalibKind::Compass, true, "op2")
        );
        assert_eq!(list[1].kind, CalibKind::Level);
        assert!(list[0].at > 0);
        assert_eq!(s.latest_calibrations(3).await.unwrap(), vec![]);
    }
}
