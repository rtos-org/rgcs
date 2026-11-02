//! Append-only audit log. There is deliberately no update or delete.

use rgcs_core::SysId;
use serde::Serialize;
use sqlx::Row;

use crate::{now_iso, Result, Store};

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct AuditEntry {
    pub id: i64,
    pub ts: String,
    pub operator: String,
    pub sysid: Option<SysId>,
    /// `vehicle` | `camera` | `settings` | `auth` | `ai`
    pub target: String,
    pub command: String,
    pub args: Option<String>,
    /// `ok` | `rejected` | `failed` | `timeout`
    pub result: String,
    pub reason: Option<String>,
}

/// What to record; `id` and `ts` are assigned by the store.
#[derive(Debug, Clone)]
pub struct AuditInput<'a> {
    pub operator: &'a str,
    pub sysid: Option<SysId>,
    pub target: &'a str,
    pub command: &'a str,
    pub args: Option<String>,
    pub result: &'a str,
    pub reason: Option<String>,
}

impl Store {
    pub async fn record_audit(&self, e: AuditInput<'_>) -> Result<i64> {
        let res = sqlx::query(
            "INSERT INTO audit_log (ts, operator, sysid, target, command, args, result, reason) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        )
        .bind(now_iso())
        .bind(e.operator)
        .bind(e.sysid.map(i64::from))
        .bind(e.target)
        .bind(e.command)
        .bind(e.args)
        .bind(e.result)
        .bind(e.reason)
        .execute(&self.pool)
        .await?;
        Ok(res.last_insert_rowid())
    }

    /// Newest first.
    pub async fn recent_audit(&self, limit: u32) -> Result<Vec<AuditEntry>> {
        let rows = sqlx::query(
            "SELECT id, ts, operator, sysid, target, command, args, result, reason FROM audit_log \
             ORDER BY id DESC LIMIT ?1",
        )
        .bind(i64::from(limit))
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|r| AuditEntry {
                id: r.get("id"),
                ts: r.get("ts"),
                operator: r.get("operator"),
                sysid: r.get::<Option<i64>, _>("sysid").map(|v| v as SysId),
                target: r.get("target"),
                command: r.get("command"),
                args: r.get("args"),
                result: r.get("result"),
                reason: r.get("reason"),
            })
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn records_and_lists_newest_first() {
        let s = Store::open_memory().await.unwrap();
        let base = AuditInput {
            operator: "admin",
            sysid: Some(1),
            target: "vehicle",
            command: "arm",
            args: None,
            result: "ok",
            reason: None,
        };
        s.record_audit(base.clone()).await.unwrap();
        s.record_audit(AuditInput {
            command: "rtl",
            result: "rejected",
            reason: Some("confirm_required".into()),
            ..base
        })
        .await
        .unwrap();
        let list = s.recent_audit(10).await.unwrap();
        assert_eq!(list.len(), 2);
        assert_eq!(list[0].command, "rtl");
        assert_eq!(list[0].reason.as_deref(), Some("confirm_required"));
        assert_eq!(list[1].sysid, Some(1));
        assert!(!list[1].ts.is_empty());
    }
}
