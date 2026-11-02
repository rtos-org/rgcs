//! `missions`: saved mission plans; items and home are JSON of the core types.

use rgcs_core::{Home, Mission, MissionFrame, MissionItem, MissionSummaryRow, SysId};
use sqlx::Row;

use crate::{Result, Store, StoreError};

fn frame_str(f: MissionFrame) -> &'static str {
    match f {
        MissionFrame::Rel => "rel",
        MissionFrame::Abs => "abs",
        MissionFrame::Ter => "ter",
    }
}

fn parse_frame(s: &str) -> MissionFrame {
    match s {
        "abs" => MissionFrame::Abs,
        "ter" => MissionFrame::Ter,
        _ => MissionFrame::Rel,
    }
}

fn unix_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn json_err(e: serde_json::Error) -> StoreError {
    StoreError::Invalid(format!("mission json: {e}"))
}

fn row_to_mission(r: &sqlx::sqlite::SqliteRow) -> Result<Mission> {
    let items: Vec<MissionItem> = serde_json::from_str(&r.get::<String, _>("items")).map_err(json_err)?;
    let home: Option<Home> = match r.get::<Option<String>, _>("home") {
        Some(h) => Some(serde_json::from_str(&h).map_err(json_err)?),
        None => None,
    };
    Ok(Mission {
        id: Some(r.get::<i64, _>("id")),
        name: r.get("name"),
        sysid: r.get::<Option<i64>, _>("sysid").map(|v| v as SysId),
        default_alt: r.get::<f64, _>("default_alt") as f32,
        default_frame: parse_frame(&r.get::<String, _>("default_frame")),
        speed: r.get::<f64, _>("speed") as f32,
        home,
        items,
        fence: serde_json::from_str(&r.get::<String, _>("fence")).map_err(json_err)?,
        rally: serde_json::from_str(&r.get::<String, _>("rally")).map_err(json_err)?,
        surveys: serde_json::from_str(&r.get::<String, _>("surveys")).map_err(json_err)?,
    })
}

impl Store {
    pub async fn list_missions(&self) -> Result<Vec<MissionSummaryRow>> {
        let rows = sqlx::query(
            "SELECT id, name, sysid, items, updated_at FROM missions ORDER BY updated_at DESC, id DESC",
        )
        .fetch_all(&self.pool)
        .await?;
        rows.iter()
            .map(|r| {
                let items: Vec<MissionItem> =
                    serde_json::from_str(&r.get::<String, _>("items")).map_err(json_err)?;
                Ok(MissionSummaryRow {
                    id: r.get("id"),
                    name: r.get("name"),
                    sysid: r.get::<Option<i64>, _>("sysid").map(|v| v as SysId),
                    item_count: items.len() as u32,
                    updated_at: r.get::<i64, _>("updated_at") as u64,
                })
            })
            .collect()
    }

    pub async fn get_mission(&self, id: i64) -> Result<Option<Mission>> {
        let row = sqlx::query("SELECT * FROM missions WHERE id = ?1")
            .bind(id)
            .fetch_optional(&self.pool)
            .await?;
        row.as_ref().map(row_to_mission).transpose()
    }

    /// The mission with its `updated_at` (ms), read together so the version matches the content.
    pub async fn get_mission_versioned(&self, id: i64) -> Result<Option<(Mission, u64)>> {
        let row = sqlx::query("SELECT * FROM missions WHERE id = ?1")
            .bind(id)
            .fetch_optional(&self.pool)
            .await?;
        row.as_ref()
            .map(|r| Ok((row_to_mission(r)?, r.get::<i64, _>("updated_at") as u64)))
            .transpose()
    }

    /// Inserts and returns the mission with its new id.
    pub async fn create_mission(&self, m: &Mission, created_by: &str) -> Result<Mission> {
        let now = unix_ms();
        let home = m
            .home
            .as_ref()
            .map(serde_json::to_string)
            .transpose()
            .map_err(json_err)?;
        let items = serde_json::to_string(&m.items).map_err(json_err)?;
        let fence = serde_json::to_string(&m.fence).map_err(json_err)?;
        let rally = serde_json::to_string(&m.rally).map_err(json_err)?;
        let surveys = serde_json::to_string(&m.surveys).map_err(json_err)?;
        let id = sqlx::query(
            "INSERT INTO missions (name, sysid, default_alt, default_frame, speed, home, items, created_by, created_at, updated_at, fence, rally, surveys) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9, ?10, ?11, ?12)",
        )
        .bind(&m.name)
        .bind(m.sysid.map(i64::from))
        .bind(m.default_alt as f64)
        .bind(frame_str(m.default_frame))
        .bind(m.speed as f64)
        .bind(home)
        .bind(items)
        .bind(created_by)
        .bind(now)
        .bind(fence)
        .bind(rally)
        .bind(surveys)
        .execute(&self.pool)
        .await?
        .last_insert_rowid();
        Ok(Mission {
            id: Some(id),
            ..m.clone()
        })
    }

    /// `None` when no mission has this id.
    pub async fn update_mission(&self, id: i64, m: &Mission) -> Result<Option<Mission>> {
        let home = m
            .home
            .as_ref()
            .map(serde_json::to_string)
            .transpose()
            .map_err(json_err)?;
        let items = serde_json::to_string(&m.items).map_err(json_err)?;
        let fence = serde_json::to_string(&m.fence).map_err(json_err)?;
        let rally = serde_json::to_string(&m.rally).map_err(json_err)?;
        let surveys = serde_json::to_string(&m.surveys).map_err(json_err)?;
        let changed = sqlx::query(
            "UPDATE missions SET name = ?2, sysid = ?3, default_alt = ?4, default_frame = ?5, speed = ?6, home = ?7, items = ?8, updated_at = ?9, fence = ?10, rally = ?11, surveys = ?12 \
             WHERE id = ?1",
        )
        .bind(id)
        .bind(&m.name)
        .bind(m.sysid.map(i64::from))
        .bind(m.default_alt as f64)
        .bind(frame_str(m.default_frame))
        .bind(m.speed as f64)
        .bind(home)
        .bind(items)
        .bind(unix_ms())
        .bind(fence)
        .bind(rally)
        .bind(surveys)
        .execute(&self.pool)
        .await?
        .rows_affected();
        if changed == 0 {
            return Ok(None);
        }
        Ok(Some(Mission {
            id: Some(id),
            ..m.clone()
        }))
    }

    pub async fn delete_mission(&self, id: i64) -> Result<bool> {
        let changed = sqlx::query("DELETE FROM missions WHERE id = ?1")
            .bind(id)
            .execute(&self.pool)
            .await?
            .rows_affected();
        Ok(changed > 0)
    }
}

#[cfg(test)]
mod tests {
    use rgcs_core::{demo20, MissionFrame};

    use crate::Store;

    #[tokio::test]
    async fn create_list_get_update_delete_round_trip() {
        let s = Store::open_memory().await.unwrap();
        assert!(s.list_missions().await.unwrap().is_empty());
        let created = s.create_mission(&demo20(), "admin").await.unwrap();
        assert_eq!(created.id, Some(1));
        assert_eq!(created.items.len(), 20);
        let rows = s.list_missions().await.unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(
            (rows[0].id, rows[0].item_count, rows[0].name.as_str()),
            (1, 20, "demo20")
        );
        assert!(rows[0].updated_at > 1_700_000_000_000);
        let mut renamed = created.clone();
        renamed.name = "renamed".into();
        renamed.default_frame = MissionFrame::Abs;
        let updated = s.update_mission(1, &renamed).await.unwrap().expect("exists");
        assert_eq!(updated.name, "renamed");
        let got = s.get_mission(1).await.unwrap().expect("exists");
        assert_eq!(got.default_frame, MissionFrame::Abs);
        assert_eq!(got.home, demo20().home);
        assert!(s.update_mission(99, &renamed).await.unwrap().is_none());
        assert!(s.delete_mission(1).await.unwrap());
        assert!(!s.delete_mission(1).await.unwrap());
        assert!(s.get_mission(1).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn fence_and_rally_are_saved_with_the_mission() {
        use rgcs_core::{FenceZone, LatLon, RallyPoint};
        let s = Store::open_memory().await.unwrap();
        let mut m = demo20();
        m.fence = vec![FenceZone::Circle {
            inclusion: true,
            center: LatLon {
                lat: 36.25,
                lon: 137.63,
            },
            radius: 300.0,
        }];
        m.rally = vec![RallyPoint {
            lat: 36.251,
            lon: 137.631,
            alt: 60.0,
        }];
        let created = s.create_mission(&m, "admin").await.unwrap();
        let got = s.get_mission(created.id.unwrap()).await.unwrap().unwrap();
        assert_eq!(
            (got.fence.clone(), got.rally.clone()),
            (m.fence.clone(), m.rally.clone())
        );
        let mut cleared = got.clone();
        cleared.fence.clear();
        s.update_mission(created.id.unwrap(), &cleared).await.unwrap();
        let again = s.get_mission(created.id.unwrap()).await.unwrap().unwrap();
        assert!(again.fence.is_empty());
        assert_eq!(again.rally, m.rally);
    }
    #[tokio::test]
    async fn surveys_round_trip() {
        use rgcs_core::SurveyBlock;
        let s = Store::open_memory().await.unwrap();
        let mut m = demo20();
        let spec = serde_json::json!({"angle": 12.5, "polygon": [[36.0, 137.0]], "nested": {"a": [1, 2]}});
        m.surveys = vec![SurveyBlock {
            id: "s1".into(),
            first: 1,
            count: 4,
            spec: spec.clone(),
        }];
        let created = s.create_mission(&m, "admin").await.unwrap();
        let id = created.id.unwrap();
        let got = s.get_mission(id).await.unwrap().unwrap();
        assert_eq!(got.surveys, m.surveys);
        let mut upd = got.clone();
        upd.surveys[0].count = 5;
        s.update_mission(id, &upd).await.unwrap();
        let again = s.get_mission(id).await.unwrap().unwrap();
        assert_eq!(again.surveys[0].count, 5);
        assert_eq!(again.surveys[0].spec, spec);
    }

    /// The plan assignment board records the version that was read with the content it wrote.
    #[tokio::test]
    async fn get_mission_versioned_returns_the_updated_at() {
        let s = Store::open_memory().await.unwrap();
        assert!(s.get_mission_versioned(1).await.unwrap().is_none());
        s.create_mission(&demo20(), "admin").await.unwrap();
        let (m, version) = s.get_mission_versioned(1).await.unwrap().expect("exists");
        assert_eq!(m.items.len(), 20);
        assert_eq!(version, s.list_missions().await.unwrap()[0].updated_at);
    }

    /// Flight plans replaced briefings (migration 0014): their tables are gone, plans stay.
    #[tokio::test]
    async fn briefing_tables_are_dropped() {
        let s = Store::open_memory().await.unwrap();
        s.create_mission(&demo20(), "admin").await.unwrap();
        let names: Vec<String> = sqlx::query_scalar("SELECT name FROM sqlite_master WHERE type = 'table'")
            .fetch_all(s.pool())
            .await
            .unwrap();
        assert!(!names.iter().any(|n| n.starts_with("briefing")), "{names:?}");
        assert_eq!(s.list_missions().await.unwrap().len(), 1);
    }
}
