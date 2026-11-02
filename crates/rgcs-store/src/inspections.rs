//! Inspection templates and runs (様式 2). A run snapshots the template's
//! items so later template edits never change a saved record.

use rgcs_core::{
    InspectionItem, InspectionResult, InspectionResultRow, InspectionRun, InspectionRunInput,
    InspectionTemplate, InspectionTemplateInput, SysId,
};
use sqlx::Row;

use crate::{unix_ms, Result, Store, StoreError};

fn template_header(r: &sqlx::sqlite::SqliteRow, items: Vec<InspectionItem>) -> InspectionTemplate {
    InspectionTemplate {
        id: r.get("id"),
        name: r.get("name"),
        version: r.get::<i64, _>("version").max(0) as u32,
        items,
        updated_at: r.get::<i64, _>("updated_at").max(0) as u64,
    }
}

fn run_header(r: &sqlx::sqlite::SqliteRow, results: Vec<InspectionResultRow>) -> InspectionRun {
    InspectionRun {
        id: r.get("id"),
        sysid: r.get::<i64, _>("sysid") as SysId,
        template_id: r.get("template_id"),
        template_name: r.get("template_name"),
        template_version: r.get::<i64, _>("template_version").max(0) as u32,
        place: r.get("place"),
        lat: r.get("lat"),
        lon: r.get("lon"),
        performed_on: r.get("performed_on"),
        inspector: r.get("inspector"),
        notes: r.get("notes"),
        has_ng: results.iter().any(|x| x.result == InspectionResult::Ng),
        results,
        supersedes: r.get("supersedes"),
        created_by: r.get("created_by"),
        created_at: r.get::<i64, _>("created_at").max(0) as u64,
    }
}

impl Store {
    async fn template_items(&self, id: i64) -> Result<Vec<InspectionItem>> {
        let rows = sqlx::query(
            "SELECT label, detail FROM inspection_template_items WHERE template_id = ?1 ORDER BY position",
        )
        .bind(id)
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .iter()
            .map(|r| InspectionItem {
                label: r.get("label"),
                detail: r.get("detail"),
            })
            .collect())
    }

    pub async fn list_templates(&self) -> Result<Vec<InspectionTemplate>> {
        let rows = sqlx::query("SELECT id, name, version, updated_at FROM inspection_templates ORDER BY id")
            .fetch_all(&self.pool)
            .await?;
        let mut out = Vec::with_capacity(rows.len());
        for r in &rows {
            let items = self.template_items(r.get("id")).await?;
            out.push(template_header(r, items));
        }
        Ok(out)
    }

    pub async fn template(&self, id: i64) -> Result<Option<InspectionTemplate>> {
        let row = sqlx::query("SELECT id, name, version, updated_at FROM inspection_templates WHERE id = ?1")
            .bind(id)
            .fetch_optional(&self.pool)
            .await?;
        match row {
            Some(r) => Ok(Some(template_header(&r, self.template_items(id).await?))),
            None => Ok(None),
        }
    }

    async fn write_items(conn: &mut sqlx::SqliteConnection, id: i64, items: &[InspectionItem]) -> Result<()> {
        sqlx::query("DELETE FROM inspection_template_items WHERE template_id = ?1")
            .bind(id)
            .execute(&mut *conn)
            .await?;
        for (i, item) in items.iter().enumerate() {
            sqlx::query("INSERT INTO inspection_template_items (template_id, position, label, detail) VALUES (?1, ?2, ?3, ?4)")
                .bind(id)
                .bind(i as i64 + 1)
                .bind(&item.label)
                .bind(&item.detail)
                .execute(&mut *conn)
                .await?;
        }
        Ok(())
    }

    pub async fn create_template(
        &self,
        input: &InspectionTemplateInput,
        by: &str,
    ) -> Result<InspectionTemplate> {
        let now = unix_ms() as i64;
        let mut tx = self.pool.begin().await?;
        let res = sqlx::query(
            "INSERT INTO inspection_templates (name, version, created_by, created_at, updated_at) VALUES (?1, 1, ?2, ?3, ?3)",
        )
        .bind(&input.name)
        .bind(by)
        .bind(now)
        .execute(&mut *tx)
        .await?;
        let id = res.last_insert_rowid();
        Self::write_items(&mut tx, id, &input.items).await?;
        tx.commit().await?;
        self.template(id)
            .await?
            .ok_or_else(|| StoreError::Invalid("template vanished".into()))
    }

    /// Replaces name and items; bumps `version`. `None` when the template does not exist.
    pub async fn update_template(
        &self,
        id: i64,
        input: &InspectionTemplateInput,
    ) -> Result<Option<InspectionTemplate>> {
        let mut tx = self.pool.begin().await?;
        let res = sqlx::query(
            "UPDATE inspection_templates SET name = ?2, version = version + 1, updated_at = ?3 WHERE id = ?1",
        )
        .bind(id)
        .bind(&input.name)
        .bind(unix_ms() as i64)
        .execute(&mut *tx)
        .await?;
        if res.rows_affected() == 0 {
            return Ok(None);
        }
        Self::write_items(&mut tx, id, &input.items).await?;
        tx.commit().await?;
        self.template(id).await
    }

    /// False when unknown; `Invalid` when it is the last template. Vehicles assigned to it fall back.
    pub async fn delete_template(&self, id: i64) -> Result<bool> {
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM inspection_templates")
            .fetch_one(&self.pool)
            .await?;
        let exists: Option<i64> = sqlx::query_scalar("SELECT id FROM inspection_templates WHERE id = ?1")
            .bind(id)
            .fetch_optional(&self.pool)
            .await?;
        if exists.is_none() {
            return Ok(false);
        }
        if count <= 1 {
            return Err(StoreError::Invalid("last template".into()));
        }
        let mut tx = self.pool.begin().await?;
        sqlx::query("UPDATE vehicles SET inspection_template_id = NULL WHERE inspection_template_id = ?1")
            .bind(id)
            .execute(&mut *tx)
            .await?;
        sqlx::query("DELETE FROM inspection_template_items WHERE template_id = ?1")
            .bind(id)
            .execute(&mut *tx)
            .await?;
        sqlx::query("DELETE FROM inspection_templates WHERE id = ?1")
            .bind(id)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        Ok(true)
    }

    /// The vehicle's assigned template, else id 1, else the lowest id.
    pub async fn template_for_vehicle(&self, sysid: SysId) -> Result<InspectionTemplate> {
        let assigned: Option<i64> =
            sqlx::query_scalar("SELECT inspection_template_id FROM vehicles WHERE sysid = ?1")
                .bind(i64::from(sysid))
                .fetch_optional(&self.pool)
                .await?
                .flatten();
        if let Some(id) = assigned {
            if let Some(t) = self.template(id).await? {
                return Ok(t);
            }
        }
        if let Some(t) = self.template(1).await? {
            return Ok(t);
        }
        self.list_templates()
            .await?
            .into_iter()
            .next()
            .ok_or_else(|| StoreError::Invalid("no inspection template".into()))
    }

    /// Saves one run; results are matched to the template's items by position (1-based).
    pub async fn create_inspection(
        &self,
        sysid: SysId,
        input: &InspectionRunInput,
        template: &InspectionTemplate,
        by: &str,
    ) -> Result<InspectionRun> {
        let n = template.items.len();
        if input.results.len() != n {
            return Err(StoreError::Invalid(format!(
                "expected {n} results, got {}",
                input.results.len()
            )));
        }
        let mut seen = vec![false; n];
        for r in &input.results {
            let idx = r.position as usize;
            if idx == 0 || idx > n || seen[idx - 1] {
                return Err(StoreError::Invalid(format!("bad result position {}", r.position)));
            }
            seen[idx - 1] = true;
        }
        let mut tx = self.pool.begin().await?;
        let res = sqlx::query(
            "INSERT INTO inspection_runs (sysid, template_id, template_name, template_version, place, lat, lon, \
             performed_on, inspector, notes, supersedes, created_by, created_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
        )
        .bind(i64::from(sysid))
        .bind(template.id)
        .bind(&template.name)
        .bind(i64::from(template.version))
        .bind(&input.place)
        .bind(input.lat)
        .bind(input.lon)
        .bind(&input.performed_on)
        .bind(&input.inspector)
        .bind(&input.notes)
        .bind(input.supersedes)
        .bind(by)
        .bind(unix_ms() as i64)
        .execute(&mut *tx)
        .await?;
        let id = res.last_insert_rowid();
        for r in &input.results {
            let item = &template.items[r.position as usize - 1];
            sqlx::query(
                "INSERT INTO inspection_results (run_id, position, label, detail, result, remark) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            )
            .bind(id)
            .bind(i64::from(r.position))
            .bind(&item.label)
            .bind(&item.detail)
            .bind(r.result.as_str())
            .bind(&r.remark)
            .execute(&mut *tx)
            .await?;
        }
        tx.commit().await?;
        self.inspection(id)
            .await?
            .ok_or_else(|| StoreError::Invalid("run vanished".into()))
    }

    async fn run_results(&self, run_id: i64) -> Result<Vec<InspectionResultRow>> {
        let rows = sqlx::query(
            "SELECT position, label, detail, result, remark FROM inspection_results WHERE run_id = ?1 ORDER BY position",
        )
        .bind(run_id)
        .fetch_all(&self.pool)
        .await?;
        rows.iter()
            .map(|r| {
                let result = InspectionResult::parse(&r.get::<String, _>("result"))
                    .ok_or_else(|| StoreError::Invalid("inspection result".into()))?;
                Ok(InspectionResultRow {
                    position: r.get::<i64, _>("position").max(0) as u32,
                    label: r.get("label"),
                    detail: r.get("detail"),
                    result,
                    remark: r.get("remark"),
                })
            })
            .collect()
    }

    pub async fn inspection(&self, id: i64) -> Result<Option<InspectionRun>> {
        let row = sqlx::query("SELECT * FROM inspection_runs WHERE id = ?1")
            .bind(id)
            .fetch_optional(&self.pool)
            .await?;
        match row {
            Some(r) => Ok(Some(run_header(&r, self.run_results(id).await?))),
            None => Ok(None),
        }
    }

    pub async fn inspection_is_superseded(&self, id: i64) -> Result<bool> {
        let v: Option<i64> =
            sqlx::query_scalar("SELECT id FROM inspection_runs WHERE supersedes = ?1 LIMIT 1")
                .bind(id)
                .fetch_optional(&self.pool)
                .await?;
        Ok(v.is_some())
    }

    /// Non-superseded runs of one vehicle, newest first, optionally within `performed_on` dates.
    pub async fn list_inspections(
        &self,
        sysid: SysId,
        from: Option<&str>,
        to: Option<&str>,
        limit: u32,
    ) -> Result<Vec<InspectionRun>> {
        let rows = sqlx::query(
            "SELECT * FROM inspection_runs WHERE sysid = ?1 \
             AND (?2 IS NULL OR performed_on >= ?2) AND (?3 IS NULL OR performed_on <= ?3) \
             AND id NOT IN (SELECT supersedes FROM inspection_runs WHERE supersedes IS NOT NULL) \
             ORDER BY created_at DESC, id DESC LIMIT ?4",
        )
        .bind(i64::from(sysid))
        .bind(from)
        .bind(to)
        .bind(i64::from(limit))
        .fetch_all(&self.pool)
        .await?;
        let mut out = Vec::with_capacity(rows.len());
        for r in &rows {
            let results = self.run_results(r.get("id")).await?;
            out.push(run_header(r, results));
        }
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use rgcs_core::{
        InspectionItem, InspectionResult, InspectionResultInput, InspectionRunInput, InspectionTemplateInput,
        VehicleRegistryInput,
    };

    use crate::{Store, StoreError};

    fn template_input(n: usize) -> InspectionTemplateInput {
        InspectionTemplateInput {
            name: "custom".into(),
            items: (1..=n)
                .map(|i| InspectionItem {
                    label: format!("item {i}"),
                    detail: format!("detail {i}"),
                })
                .collect(),
        }
    }

    fn run_input(
        template_id: i64,
        n: usize,
        ng_at: Option<u32>,
        supersedes: Option<i64>,
    ) -> InspectionRunInput {
        InspectionRunInput {
            template_id,
            place: "テスト場".into(),
            lat: Some(35.481883),
            lon: Some(138.48029),
            performed_on: "2026-12-05".into(),
            inspector: "admin".into(),
            notes: "".into(),
            results: (1..=n as u32)
                .map(|p| InspectionResultInput {
                    position: p,
                    result: if Some(p) == ng_at {
                        InspectionResult::Ng
                    } else {
                        InspectionResult::Ok
                    },
                    remark: "".into(),
                })
                .collect(),
            supersedes,
        }
    }

    fn registry(template: Option<i64>) -> VehicleRegistryInput {
        VehicleRegistryInput {
            name: "UAV-03".into(),
            registration: "".into(),
            uas_type: "".into(),
            model: "".into(),
            type_cert_no: "".into(),
            airworthiness_class: "".into(),
            airworthiness_no: "".into(),
            manufacturer: "".into(),
            serial_no: "".into(),
            initial_flight_minutes: 0,
            inspection_template_id: template,
            endurance_minutes: None,
        }
    }

    #[tokio::test]
    async fn default_template_has_the_nine_mlit_items() {
        let s = Store::open_memory().await.unwrap();
        let all = s.list_templates().await.unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!((all[0].id, all[0].version, all[0].items.len()), (1, 1, 9));
        assert_eq!(all[0].items[7].label, "操縦装置");
        assert_eq!(
            all[0].items[0].detail,
            "機器の取り付け状態(ネジ、コネクタ、ケーブル等)"
        );
    }

    #[tokio::test]
    async fn update_bumps_the_version_and_replaces_items() {
        let s = Store::open_memory().await.unwrap();
        let t = s.create_template(&template_input(3), "admin").await.unwrap();
        assert_eq!((t.version, t.items.len()), (1, 3));
        let u = s
            .update_template(t.id, &template_input(2))
            .await
            .unwrap()
            .unwrap();
        assert_eq!((u.version, u.items.len()), (2, 2));
        assert!(s
            .update_template(999, &template_input(1))
            .await
            .unwrap()
            .is_none());
    }

    #[tokio::test]
    async fn deleting_the_last_template_is_refused_and_assignment_falls_back() {
        let s = Store::open_memory().await.unwrap();
        let t = s.create_template(&template_input(2), "admin").await.unwrap();
        s.put_registry(3, &registry(Some(t.id)), "copter").await.unwrap();
        assert_eq!(s.template_for_vehicle(3).await.unwrap().id, t.id);
        assert!(s.delete_template(t.id).await.unwrap());
        assert_eq!(s.template_for_vehicle(3).await.unwrap().id, 1);
        assert!(s.registry(3, "x").await.unwrap().inspection_template_id.is_none());
        assert!(matches!(s.delete_template(1).await, Err(StoreError::Invalid(_))));
        assert!(!s.delete_template(999).await.unwrap());
    }

    #[tokio::test]
    async fn run_snapshots_the_template_and_lists_newest_first() {
        let s = Store::open_memory().await.unwrap();
        let t = s.template(1).await.unwrap().unwrap();
        let first = s
            .create_inspection(3, &run_input(1, 9, None, None), &t, "admin")
            .await
            .unwrap();
        let second = s
            .create_inspection(3, &run_input(1, 9, Some(2), Some(first.id)), &t, "admin")
            .await
            .unwrap();
        assert!(second.has_ng && !first.has_ng);
        let list = s.list_inspections(3, None, None, 10).await.unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].id, second.id);
        assert_eq!(
            list[0].results[0].detail,
            "機器の取り付け状態(ネジ、コネクタ、ケーブル等)"
        );
        assert_eq!(list[0].results[1].result, InspectionResult::Ng);
        assert_eq!(
            (list[0].template_name.as_str(), list[0].template_version),
            ("様式2 標準", 1)
        );
        assert!(s
            .list_inspections(3, Some("2026-12-06"), None, 10)
            .await
            .unwrap()
            .is_empty());
        assert_eq!(
            s.list_inspections(3, Some("2026-12-01"), Some("2026-12-05"), 10)
                .await
                .unwrap()
                .len(),
            1
        );
        assert!(s.list_inspections(4, None, None, 10).await.unwrap().is_empty());
        assert_eq!(s.inspection(first.id).await.unwrap().unwrap().supersedes, None);
        assert!(s.inspection_is_superseded(first.id).await.unwrap());
        assert!(!s.inspection_is_superseded(second.id).await.unwrap());
    }

    #[tokio::test]
    async fn run_with_wrong_result_count_is_invalid() {
        let s = Store::open_memory().await.unwrap();
        let t = s.template(1).await.unwrap().unwrap();
        assert!(matches!(
            s.create_inspection(3, &run_input(1, 8, None, None), &t, "admin")
                .await,
            Err(StoreError::Invalid(_))
        ));
    }

    async fn fail_on(s: &Store, table: &str, op: &str) {
        sqlx::query(sqlx::AssertSqlSafe(format!(
            "CREATE TRIGGER fail_{table}_{op} BEFORE {op} ON {table} BEGIN SELECT RAISE(ABORT, 'injected'); END"
        )))
        .execute(s.pool())
        .await
        .unwrap();
    }

    #[tokio::test]
    async fn failed_run_insert_leaves_no_header_row() {
        let s = Store::open_memory().await.unwrap();
        let t = s.template(1).await.unwrap().unwrap();
        fail_on(&s, "inspection_results", "INSERT").await;
        assert!(s
            .create_inspection(3, &run_input(1, 9, None, None), &t, "admin")
            .await
            .is_err());
        let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM inspection_runs")
            .fetch_one(s.pool())
            .await
            .unwrap();
        assert_eq!(n, 0, "no run without its results");
    }

    #[tokio::test]
    async fn failed_template_update_keeps_the_old_items_and_version() {
        let s = Store::open_memory().await.unwrap();
        fail_on(&s, "inspection_template_items", "INSERT").await;
        assert!(s.update_template(1, &template_input(2)).await.is_err());
        let t = s.template(1).await.unwrap().unwrap();
        assert_eq!((t.version, t.items.len(), t.name.as_str()), (1, 9, "様式2 標準"));
        assert!(s.create_template(&template_input(2), "admin").await.is_err());
        assert_eq!(
            s.list_templates().await.unwrap().len(),
            1,
            "no item-less template left behind"
        );
    }
}
