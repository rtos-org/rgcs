//! `messages` (migration 0005): the persistent message log behind the footer and the history
//! sheet. Ids are AUTOINCREMENT so they never repeat across restarts.

use rgcs_core::{ackable, LogEntry, MessageSource, Severity, SysId};
use sqlx::Row;

use crate::{Result, Store, StoreError};

#[derive(Debug, Clone)]
pub struct NewMessage {
    pub ts: u64,
    pub sysid: Option<SysId>,
    pub source: MessageSource,
    pub severity: Severity,
    /// MAV_SEVERITY for STATUSTEXT.
    pub raw_severity: Option<u8>,
    pub text: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SeverityFilter {
    All,
    /// Warnings and errors only.
    Alerts,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AckOutcome {
    Acked(LogEntry),
    /// Already acknowledged: the first acknowledgement stands.
    Already(LogEntry),
    NotAckable,
    NotFound,
}

fn entry_of(r: &sqlx::sqlite::SqliteRow) -> Result<LogEntry> {
    let source = MessageSource::parse(&r.get::<String, _>("source"))
        .ok_or_else(|| StoreError::Invalid("message source".into()))?;
    let severity = Severity::parse(&r.get::<String, _>("severity"))
        .ok_or_else(|| StoreError::Invalid("message severity".into()))?;
    Ok(LogEntry {
        id: r.get("id"),
        ts: r.get::<i64, _>("ts").max(0) as u64,
        sysid: r.get::<Option<i64>, _>("sysid").map(|v| v as SysId),
        source,
        severity,
        text: r.get("text"),
        ackable: ackable(source, severity),
        acked_by: r.get("acked_by"),
        acked_at: r.get::<Option<i64>, _>("acked_at").map(|v| v.max(0) as u64),
    })
}

/// `text` with the LIKE wildcards and the escape character itself escaped by `\\`.
fn like_escaped(text: &str) -> String {
    text.chars()
        .flat_map(|c| match c {
            '%' | '_' | '\\' => vec!['\\', c],
            _ => vec![c],
        })
        .collect()
}

impl Store {
    pub async fn record_message(&self, m: &NewMessage) -> Result<LogEntry> {
        let res = sqlx::query(
            "INSERT INTO messages (ts, sysid, source, severity, raw_severity, text) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        )
        .bind(m.ts as i64)
        .bind(m.sysid.map(i64::from))
        .bind(m.source.as_str())
        .bind(m.severity.as_str())
        .bind(m.raw_severity.map(i64::from))
        .bind(&m.text)
        .execute(&self.pool)
        .await?;
        self.message(res.last_insert_rowid())
            .await?
            .ok_or_else(|| StoreError::Invalid("message vanished".into()))
    }

    pub async fn message(&self, id: i64) -> Result<Option<LogEntry>> {
        let row = sqlx::query("SELECT * FROM messages WHERE id = ?1")
            .bind(id)
            .fetch_optional(&self.pool)
            .await?;
        row.as_ref().map(entry_of).transpose()
    }

    /// Newest first; `since` excludes ids ≤ since; `limit` rows at most.
    pub async fn messages(
        &self,
        sysid: Option<SysId>,
        since: Option<i64>,
        filter: SeverityFilter,
        limit: u32,
    ) -> Result<Vec<LogEntry>> {
        let rows = sqlx::query(
            "SELECT * FROM messages WHERE (?1 IS NULL OR sysid = ?1) AND (?2 IS NULL OR id > ?2) \
             AND (?3 = 0 OR severity IN ('warn', 'error')) ORDER BY id DESC LIMIT ?4",
        )
        .bind(sysid.map(i64::from))
        .bind(since)
        .bind(i64::from(filter == SeverityFilter::Alerts))
        .bind(i64::from(limit))
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(entry_of).collect()
    }

    /// Rows whose text contains `query` (case-insensitive for ASCII; `%`, `_` and `\\` match
    /// literally), newest first; `since` keeps rows with `ts >= since` (unix ms).
    pub async fn search_messages(
        &self,
        query: &str,
        sysid: Option<SysId>,
        since: Option<i64>,
        limit: u32,
    ) -> Result<Vec<LogEntry>> {
        let rows = sqlx::query(
            "SELECT * FROM messages WHERE text LIKE ?1 ESCAPE '\\' AND (?2 IS NULL OR sysid = ?2) \
             AND (?3 IS NULL OR ts >= ?3) ORDER BY id DESC LIMIT ?4",
        )
        .bind(format!("%{}%", like_escaped(query)))
        .bind(sysid.map(i64::from))
        .bind(since)
        .bind(i64::from(limit))
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(entry_of).collect()
    }

    /// Acknowledges an alert of `sysid`; idempotent (the first acknowledgement stands).
    pub async fn ack_message(&self, sysid: SysId, id: i64, by: &str, at: u64) -> Result<AckOutcome> {
        let Some(e) = self.message(id).await? else {
            return Ok(AckOutcome::NotFound);
        };
        if e.sysid != Some(sysid) {
            return Ok(AckOutcome::NotFound);
        }
        if !e.ackable {
            return Ok(AckOutcome::NotAckable);
        }
        if e.acked_by.is_some() {
            return Ok(AckOutcome::Already(e));
        }
        // The guarded UPDATE decides the winner: a concurrent acknowledgement that lost the
        // race sees 0 rows and reports the first one (one audit row per acknowledgement).
        let res = sqlx::query(
            "UPDATE messages SET acked_by = ?2, acked_at = ?3 WHERE id = ?1 AND acked_by IS NULL",
        )
        .bind(id)
        .bind(by)
        .bind(at as i64)
        .execute(&self.pool)
        .await?;
        let e = self
            .message(id)
            .await?
            .ok_or_else(|| StoreError::Invalid("message vanished".into()))?;
        Ok(if res.rows_affected() == 1 {
            AckOutcome::Acked(e)
        } else {
            AckOutcome::Already(e)
        })
    }

    /// Keeps the newest `keep` rows.
    pub async fn prune_messages(&self, keep: u32) -> Result<u64> {
        let res = sqlx::query(
            "DELETE FROM messages WHERE id NOT IN (SELECT id FROM messages ORDER BY id DESC LIMIT ?1)",
        )
        .bind(i64::from(keep))
        .execute(&self.pool)
        .await?;
        Ok(res.rows_affected())
    }
}

#[cfg(test)]
mod tests {
    use rgcs_core::{MessageSource, Severity};

    use crate::messages::{AckOutcome, NewMessage, SeverityFilter};
    use crate::Store;

    fn msg(sysid: Option<u8>, source: MessageSource, severity: Severity, text: &str) -> NewMessage {
        NewMessage {
            ts: 1_000,
            sysid,
            source,
            severity,
            raw_severity: None,
            text: text.into(),
        }
    }

    #[tokio::test]
    async fn records_and_lists_newest_first() {
        let s = Store::open_memory().await.unwrap();
        let a = s
            .record_message(&msg(Some(1), MessageSource::Vehicle, Severity::Warn, "PreArm"))
            .await
            .unwrap();
        let b = s
            .record_message(&msg(None, MessageSource::Command, Severity::Ok, "arm ok"))
            .await
            .unwrap();
        assert!(b.id > a.id);
        assert!(a.ackable && !b.ackable);
        let all = s.messages(None, None, SeverityFilter::All, 500).await.unwrap();
        assert_eq!(all.iter().map(|e| e.id).collect::<Vec<_>>(), vec![b.id, a.id]);
        let alerts = s.messages(None, None, SeverityFilter::Alerts, 500).await.unwrap();
        assert_eq!(alerts.len(), 1);
        assert_eq!(
            s.messages(Some(1), None, SeverityFilter::All, 500)
                .await
                .unwrap()
                .len(),
            1
        );
        assert_eq!(
            s.messages(None, Some(a.id), SeverityFilter::All, 500)
                .await
                .unwrap()
                .len(),
            1,
            "since excludes older ids"
        );
        assert_eq!(
            s.messages(None, None, SeverityFilter::All, 1).await.unwrap()[0].id,
            b.id
        );
    }

    #[tokio::test]
    async fn search_is_a_case_insensitive_escaped_substring() {
        let s = Store::open_memory().await.unwrap();
        let seed = [
            (Some(3), 1_000, "PreArm: GPS not healthy"),
            (Some(1), 2_000, "EKF variance"),
            (None, 3_000, "100%_done"),
        ];
        for (sysid, ts, text) in seed {
            let m = NewMessage {
                ts,
                ..msg(sysid, MessageSource::Vehicle, Severity::Warn, text)
            };
            s.record_message(&m).await.unwrap();
        }
        let texts = |rows: Vec<rgcs_core::LogEntry>| rows.into_iter().map(|e| e.text).collect::<Vec<_>>();
        assert_eq!(
            texts(s.search_messages("prearm", None, None, 30).await.unwrap()),
            vec!["PreArm: GPS not healthy"]
        );
        assert_eq!(
            texts(s.search_messages("%", None, None, 30).await.unwrap()),
            vec!["100%_done"]
        );
        assert_eq!(
            texts(s.search_messages("_", None, None, 30).await.unwrap()),
            vec!["100%_done"]
        );
        assert!(s.search_messages("\\", None, None, 30).await.unwrap().is_empty());
        assert_eq!(
            texts(s.search_messages("e", Some(1), None, 30).await.unwrap()),
            vec!["EKF variance"]
        );
        assert_eq!(
            texts(s.search_messages("e", None, Some(2_000), 30).await.unwrap()),
            vec!["100%_done", "EKF variance"],
            "newest first, ts >= since"
        );
        assert_eq!(s.search_messages("e", None, None, 1).await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn messages_are_pruned_to_the_cap() {
        let s = Store::open_memory().await.unwrap();
        for i in 0..120 {
            s.record_message(&msg(
                Some(1),
                MessageSource::Vehicle,
                Severity::Info,
                &format!("m{i}"),
            ))
            .await
            .unwrap();
        }
        s.prune_messages(100).await.unwrap();
        let all = s.messages(None, None, SeverityFilter::All, 500).await.unwrap();
        assert_eq!(all.len(), 100);
        assert_eq!(all[0].text, "m119", "newest kept");
    }

    #[tokio::test]
    async fn ack_rules_in_the_store() {
        let s = Store::open_memory().await.unwrap();
        let warn = s
            .record_message(&msg(Some(1), MessageSource::Vehicle, Severity::Warn, "PreArm"))
            .await
            .unwrap();
        let info = s
            .record_message(&msg(Some(1), MessageSource::Vehicle, Severity::Info, "EKF"))
            .await
            .unwrap();
        match s.ack_message(1, warn.id, "admin", 5_000).await.unwrap() {
            AckOutcome::Acked(e) => {
                assert_eq!((e.acked_by.as_deref(), e.acked_at), (Some("admin"), Some(5_000)))
            }
            other => panic!("{other:?}"),
        }
        match s.ack_message(1, warn.id, "op", 9_000).await.unwrap() {
            AckOutcome::Already(e) => {
                assert_eq!((e.acked_by.as_deref(), e.acked_at), (Some("admin"), Some(5_000)))
            }
            other => panic!("{other:?}"),
        }
        assert!(matches!(
            s.ack_message(1, info.id, "admin", 1).await.unwrap(),
            AckOutcome::NotAckable
        ));
        assert!(matches!(
            s.ack_message(2, warn.id, "admin", 1).await.unwrap(),
            AckOutcome::NotFound
        ));
        assert!(matches!(
            s.ack_message(1, 999, "admin", 1).await.unwrap(),
            AckOutcome::NotFound
        ));
    }

    #[tokio::test]
    async fn ids_and_acks_survive_a_restart() {
        let dir = std::env::temp_dir().join(format!("rgcs-msg-{}", uuid::Uuid::new_v4().simple()));
        let path = dir.join("rgcs.db");
        let first = {
            let s = Store::open(&path).await.unwrap();
            let e = s
                .record_message(&msg(Some(1), MessageSource::Vehicle, Severity::Error, "crash"))
                .await
                .unwrap();
            s.ack_message(1, e.id, "admin", 7).await.unwrap();
            e.id
        };
        let s = Store::open(&path).await.unwrap();
        let all = s.messages(None, None, SeverityFilter::All, 500).await.unwrap();
        assert_eq!((all[0].id, all[0].acked_by.as_deref()), (first, Some("admin")));
        let next = s
            .record_message(&msg(Some(1), MessageSource::Vehicle, Severity::Info, "x"))
            .await
            .unwrap();
        assert!(next.id > first);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn concurrent_acks_have_one_winner() {
        let s = Store::open_memory().await.unwrap();
        let warn = s
            .record_message(&msg(Some(1), MessageSource::Vehicle, Severity::Warn, "PreArm"))
            .await
            .unwrap();
        let tasks: Vec<_> = (0..8u64)
            .map(|i| {
                let s = s.clone();
                tokio::spawn(async move {
                    s.ack_message(1, warn.id, &format!("op{i}"), 10 + i)
                        .await
                        .unwrap()
                })
            })
            .collect();
        let mut outcomes = Vec::new();
        for t in tasks {
            outcomes.push(t.await.unwrap());
        }
        let acked = outcomes
            .iter()
            .filter(|o| matches!(o, AckOutcome::Acked(_)))
            .count();
        assert_eq!(acked, 1, "{outcomes:?}");
    }
}
