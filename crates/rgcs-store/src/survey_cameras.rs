//! Survey cameras: the shared list photogrammetry surveys are planned with.

use rgcs_core::{validate_survey_camera, SurveyCamera};
use sqlx::sqlite::SqliteRow;
use sqlx::Row;

use crate::{Result, Store, StoreError};

fn from_row(r: &SqliteRow) -> SurveyCamera {
    SurveyCamera {
        id: Some(r.get("id")),
        name: r.get("name"),
        sensor_w_mm: r.get::<f64, _>("sensor_w_mm") as f32,
        sensor_h_mm: r.get::<f64, _>("sensor_h_mm") as f32,
        image_w_px: r.get::<i64, _>("image_w_px").max(0) as u32,
        image_h_px: r.get::<i64, _>("image_h_px").max(0) as u32,
        focal_mm: r.get::<f64, _>("focal_mm") as f32,
        shutter_s: r.get::<f64, _>("shutter_s") as f32,
        min_interval_s: r.get::<f64, _>("min_interval_s") as f32,
        builtin: r.get::<i64, _>("builtin") != 0,
    }
}

fn invalid(e: String) -> StoreError {
    StoreError::Invalid(format!("survey camera: {e}"))
}

/// Result of an update or delete: the built-in row is protected.
#[derive(Debug, Clone, PartialEq)]
pub enum CameraChange<T> {
    Done(T),
    Builtin,
    NotFound,
}

impl Store {
    /// Built-ins first, then by name.
    pub async fn list_survey_cameras(&self) -> Result<Vec<SurveyCamera>> {
        let rows = sqlx::query(
            "SELECT id, name, sensor_w_mm, sensor_h_mm, image_w_px, image_h_px, focal_mm, shutter_s, \
             min_interval_s, builtin FROM survey_cameras ORDER BY builtin DESC, name, id",
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows.iter().map(from_row).collect())
    }

    async fn survey_camera_builtin(&self, id: i64) -> Result<Option<bool>> {
        let row = sqlx::query("SELECT builtin FROM survey_cameras WHERE id = ?1")
            .bind(id)
            .fetch_optional(&self.pool)
            .await?;
        Ok(row.map(|r| r.get::<i64, _>("builtin") != 0))
    }

    /// Creates a custom camera; a client-supplied `builtin` is ignored.
    pub async fn create_survey_camera(&self, c: &SurveyCamera) -> Result<SurveyCamera> {
        validate_survey_camera(c).map_err(invalid)?;
        let id = sqlx::query(
            "INSERT INTO survey_cameras \
             (name, sensor_w_mm, sensor_h_mm, image_w_px, image_h_px, focal_mm, shutter_s, min_interval_s, builtin) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 0)",
        )
        .bind(&c.name)
        .bind(f64::from(c.sensor_w_mm))
        .bind(f64::from(c.sensor_h_mm))
        .bind(i64::from(c.image_w_px))
        .bind(i64::from(c.image_h_px))
        .bind(f64::from(c.focal_mm))
        .bind(f64::from(c.shutter_s))
        .bind(f64::from(c.min_interval_s))
        .execute(&self.pool)
        .await?
        .last_insert_rowid();
        Ok(SurveyCamera {
            id: Some(id),
            builtin: false,
            ..c.clone()
        })
    }

    pub async fn update_survey_camera(
        &self,
        id: i64,
        c: &SurveyCamera,
    ) -> Result<CameraChange<SurveyCamera>> {
        validate_survey_camera(c).map_err(invalid)?;
        match self.survey_camera_builtin(id).await? {
            None => return Ok(CameraChange::NotFound),
            Some(true) => return Ok(CameraChange::Builtin),
            Some(false) => {}
        }
        sqlx::query(
            "UPDATE survey_cameras SET name = ?1, sensor_w_mm = ?2, sensor_h_mm = ?3, image_w_px = ?4, \
             image_h_px = ?5, focal_mm = ?6, shutter_s = ?7, min_interval_s = ?8 WHERE id = ?9 AND builtin = 0",
        )
        .bind(&c.name)
        .bind(f64::from(c.sensor_w_mm))
        .bind(f64::from(c.sensor_h_mm))
        .bind(i64::from(c.image_w_px))
        .bind(i64::from(c.image_h_px))
        .bind(f64::from(c.focal_mm))
        .bind(f64::from(c.shutter_s))
        .bind(f64::from(c.min_interval_s))
        .bind(id)
        .execute(&self.pool)
        .await?;
        Ok(CameraChange::Done(SurveyCamera {
            id: Some(id),
            builtin: false,
            ..c.clone()
        }))
    }

    pub async fn delete_survey_camera(&self, id: i64) -> Result<CameraChange<()>> {
        match self.survey_camera_builtin(id).await? {
            None => return Ok(CameraChange::NotFound),
            Some(true) => return Ok(CameraChange::Builtin),
            Some(false) => {}
        }
        sqlx::query("DELETE FROM survey_cameras WHERE id = ?1 AND builtin = 0")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(CameraChange::Done(()))
    }
}

#[cfg(test)]
mod tests {
    use rgcs_core::SurveyCamera;

    use super::CameraChange;
    use crate::Store;

    fn custom(name: &str) -> SurveyCamera {
        SurveyCamera {
            id: None,
            name: name.into(),
            sensor_w_mm: 13.2,
            sensor_h_mm: 8.8,
            image_w_px: 5472,
            image_h_px: 3648,
            focal_mm: 8.8,
            shutter_s: 0.0005,
            min_interval_s: 2.0,
            builtin: true,
        }
    }

    #[tokio::test]
    async fn seeded_builtin_then_custom_round_trip() {
        let s = Store::open_memory().await.unwrap();
        let list = s.list_survey_cameras().await.unwrap();
        assert_eq!(list.len(), 1);
        assert!(list[0].builtin);
        assert_eq!(list[0].name, "Sony α7R IV 35mm");
        let builtin_id = list[0].id.unwrap();

        let made = s.create_survey_camera(&custom("A")).await.unwrap();
        assert!(!made.builtin, "client builtin is ignored");
        let id = made.id.unwrap();
        let list = s.list_survey_cameras().await.unwrap();
        assert_eq!(list.len(), 2);
        assert!(list[0].builtin);
        assert_eq!(list[1], made);

        let upd = s.update_survey_camera(id, &custom("B")).await.unwrap();
        assert!(matches!(upd, CameraChange::Done(ref c) if c.name == "B" && !c.builtin));
        assert_eq!(
            s.update_survey_camera(99, &custom("B")).await.unwrap(),
            CameraChange::NotFound
        );
        assert_eq!(
            s.update_survey_camera(builtin_id, &custom("B")).await.unwrap(),
            CameraChange::Builtin
        );
        assert_eq!(
            s.delete_survey_camera(builtin_id).await.unwrap(),
            CameraChange::Builtin
        );
        assert_eq!(s.delete_survey_camera(id).await.unwrap(), CameraChange::Done(()));
        assert_eq!(s.delete_survey_camera(id).await.unwrap(), CameraChange::NotFound);
        assert_eq!(s.list_survey_cameras().await.unwrap().len(), 1);
    }
}
