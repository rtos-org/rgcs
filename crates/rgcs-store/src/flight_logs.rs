//! Stored DataFlash logs (`flight_logs`): one row per `.bin` under `data_dir/logs/<sysid>/`.

use rgcs_core::{FlightLog, LogSource, SysId};
use sqlx::Row;

use crate::{unix_ms, Result, Store};

fn log_of(r: &sqlx::sqlite::SqliteRow) -> FlightLog {
    FlightLog {
        id: r.get("id"),
        sysid: r.get::<i64, _>("sysid") as SysId,
        flight_id: r.get("flight_id"),
        fc_log_id: r.get::<Option<i64>, _>("fc_log_id").map(|v| v.max(0) as u32),
        filename: r.get("filename"),
        size: r.get::<i64, _>("size").max(0) as u64,
        source: if r.get::<String, _>("source") == "upload" {
            LogSource::Upload
        } else {
            LogSource::Mavlink
        },
        fetched_at: r.get::<i64, _>("fetched_at").max(0) as u64,
        created_by: r.get("created_by"),
    }
}

impl Store {
    #[allow(clippy::too_many_arguments)]
    pub async fn add_log(
        &self,
        sysid: SysId,
        flight_id: Option<i64>,
        fc_log_id: Option<u32>,
        filename: &str,
        size: u64,
        source: LogSource,
        by: &str,
    ) -> Result<FlightLog> {
        let res = sqlx::query(
            "INSERT INTO flight_logs (sysid, flight_id, fc_log_id, filename, size, source, fetched_at, created_by) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        )
        .bind(i64::from(sysid))
        .bind(flight_id)
        .bind(fc_log_id.map(i64::from))
        .bind(filename)
        .bind(size as i64)
        .bind(source.as_str())
        .bind(unix_ms() as i64)
        .bind(by)
        .execute(&self.pool)
        .await?;
        let row = sqlx::query("SELECT * FROM flight_logs WHERE id = ?1")
            .bind(res.last_insert_rowid())
            .fetch_one(&self.pool)
            .await?;
        Ok(log_of(&row))
    }

    /// Newest first.
    pub async fn list_logs(&self, sysid: SysId) -> Result<Vec<FlightLog>> {
        let rows = sqlx::query("SELECT * FROM flight_logs WHERE sysid = ?1 ORDER BY id DESC")
            .bind(i64::from(sysid))
            .fetch_all(&self.pool)
            .await?;
        Ok(rows.iter().map(log_of).collect())
    }

    pub async fn log(&self, id: i64) -> Result<Option<FlightLog>> {
        let row = sqlx::query("SELECT * FROM flight_logs WHERE id = ?1")
            .bind(id)
            .fetch_optional(&self.pool)
            .await?;
        Ok(row.as_ref().map(log_of))
    }

    /// (Re)attaches a log to a flight, or detaches it with `None`. False when unknown.
    pub async fn attach_log(&self, id: i64, flight_id: Option<i64>) -> Result<bool> {
        let res = sqlx::query("UPDATE flight_logs SET flight_id = ?2 WHERE id = ?1")
            .bind(id)
            .bind(flight_id)
            .execute(&self.pool)
            .await?;
        Ok(res.rows_affected() == 1)
    }
}

#[cfg(test)]
mod tests {
    use rgcs_core::{FlightInput, LogSource};

    use crate::Store;

    #[tokio::test]
    async fn logs_attach_and_list_newest_first() {
        let s = Store::open_memory().await.unwrap();
        let a = s
            .add_log(
                1,
                None,
                Some(7),
                "7_1700000000.bin",
                10_240,
                LogSource::Mavlink,
                "admin",
            )
            .await
            .unwrap();
        let b = s
            .add_log(1, None, None, "upload.bin", 300, LogSource::Upload, "admin")
            .await
            .unwrap();
        let list = s.list_logs(1).await.unwrap();
        assert_eq!(list.iter().map(|l| l.id).collect::<Vec<_>>(), vec![b.id, a.id]);
        assert_eq!(
            (list[1].fc_log_id, list[1].size, list[1].source),
            (Some(7), 10_240, LogSource::Mavlink)
        );
        let flight = s
            .create_flight(
                1,
                &FlightInput {
                    pilot: "a".into(),
                    pilot_license: "".into(),
                    takeoff_at: 1_796_050_800_000,
                    landed_at: 1_796_050_800_000 + 1,
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
        assert!(s.attach_log(a.id, Some(flight.id)).await.unwrap());
        assert_eq!(s.log(a.id).await.unwrap().unwrap().flight_id, Some(flight.id));
        assert!(
            s.attach_log(a.id, Some(999)).await.is_err(),
            "unknown flight is refused by the FK"
        );
        assert!(s.attach_log(a.id, None).await.unwrap());
        assert_eq!(s.log(a.id).await.unwrap().unwrap().flight_id, None);
        assert!(!s.attach_log(999, None).await.unwrap());
        assert!(s.list_logs(2).await.unwrap().is_empty());
    }
}
