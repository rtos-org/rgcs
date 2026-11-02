//! `overlay_areas`: the rectangles whose tiles the server fetched for a plugin's `area` overlay
//!. Rows are scoped by `(plugin_id, overlay_id)`.

use rgcs_core::{AreaStatus, OverlayArea};
use sqlx::Row;

use crate::{unix_ms, Result, Store};

/// `(south, west, north, east)` in degrees.
pub type Rect = (f64, f64, f64, f64);

fn opt_ms(r: &sqlx::sqlite::SqliteRow, col: &str) -> Option<u64> {
    r.get::<Option<i64>, _>(col).map(|v| v.max(0) as u64)
}

fn count(r: &sqlx::sqlite::SqliteRow, col: &str) -> u64 {
    r.get::<i64, _>(col).max(0) as u64
}

fn row_to_area(r: &sqlx::sqlite::SqliteRow) -> OverlayArea {
    OverlayArea {
        id: r.get("id"),
        plugin_id: r.get("plugin_id"),
        overlay_id: r.get("overlay_id"),
        name: r.get("name"),
        south: r.get("south"),
        west: r.get("west"),
        north: r.get("north"),
        east: r.get("east"),
        status: AreaStatus::parse(&r.get::<String, _>("status")),
        tiles_total: count(r, "tiles_total"),
        tiles_ok: count(r, "tiles_ok"),
        tiles_failed: count(r, "tiles_failed"),
        fetched_at: opt_ms(r, "fetched_at"),
        data_modified: opt_ms(r, "data_modified"),
        last_error: r.get("last_error"),
        created_at: count(r, "created_at"),
    }
}

impl Store {
    /// The areas of one overlay, oldest first.
    pub async fn list_overlay_areas(&self, plugin: &str, overlay: &str) -> Result<Vec<OverlayArea>> {
        let rows =
            sqlx::query("SELECT * FROM overlay_areas WHERE plugin_id = ?1 AND overlay_id = ?2 ORDER BY id")
                .bind(plugin)
                .bind(overlay)
                .fetch_all(&self.pool)
                .await?;
        Ok(rows.iter().map(row_to_area).collect())
    }

    pub async fn get_overlay_area(&self, id: i64) -> Result<Option<OverlayArea>> {
        let row = sqlx::query("SELECT * FROM overlay_areas WHERE id = ?1")
            .bind(id)
            .fetch_optional(&self.pool)
            .await?;
        Ok(row.as_ref().map(row_to_area))
    }

    /// A new `idle` area (the caller validated the rectangle and counted its tiles).
    pub async fn create_overlay_area(
        &self,
        (plugin, overlay): (&str, &str),
        name: &str,
        rect: Rect,
        tiles_total: u64,
    ) -> Result<OverlayArea> {
        let (south, west, north, east) = rect;
        let id: i64 = sqlx::query_scalar(
            "INSERT INTO overlay_areas \
             (plugin_id, overlay_id, name, south, west, north, east, tiles_total, created_at) \
             VALUES (?8, ?9, ?1, ?2, ?3, ?4, ?5, ?6, ?7) RETURNING id",
        )
        .bind(name)
        .bind(south)
        .bind(west)
        .bind(north)
        .bind(east)
        .bind(tiles_total as i64)
        .bind(unix_ms() as i64)
        .bind(plugin)
        .bind(overlay)
        .fetch_one(&self.pool)
        .await?;
        Ok(self.get_overlay_area(id).await?.expect("row just inserted"))
    }

    /// Claims the area for a fetch: `false` when it is already fetching or does not exist.
    /// Counters and the error start over; the data date is kept.
    pub async fn begin_area_fetch(&self, id: i64, tiles_total: u64) -> Result<bool> {
        let done = sqlx::query(
            "UPDATE overlay_areas SET status = 'fetching', tiles_total = ?2, tiles_ok = 0, \
             tiles_failed = 0, last_error = NULL WHERE id = ?1 AND status != 'fetching'",
        )
        .bind(id)
        .bind(tiles_total as i64)
        .execute(&self.pool)
        .await?;
        Ok(done.rows_affected() == 1)
    }

    /// Progress of a running fetch: counters, the newest data date, the latest error code.
    pub async fn area_progress(
        &self,
        id: i64,
        ok: u64,
        failed: u64,
        data_modified: Option<u64>,
        last_error: Option<&str>,
    ) -> Result<()> {
        sqlx::query(
            "UPDATE overlay_areas SET tiles_ok = ?2, tiles_failed = ?3, \
             data_modified = CASE WHEN ?4 IS NULL THEN data_modified \
               WHEN data_modified IS NULL OR ?4 > data_modified THEN ?4 ELSE data_modified END, \
             last_error = COALESCE(?5, last_error) WHERE id = ?1",
        )
        .bind(id)
        .bind(ok as i64)
        .bind(failed as i64)
        .bind(data_modified.map(|v| v as i64))
        .bind(last_error)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn finish_area_fetch(&self, id: i64, status: AreaStatus, fetched_at: u64) -> Result<()> {
        sqlx::query("UPDATE overlay_areas SET status = ?2, fetched_at = ?3 WHERE id = ?1")
            .bind(id)
            .bind(status.as_str())
            .bind(fetched_at as i64)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    /// Removes an area that is not fetching; `false` when none was removed.
    pub async fn delete_overlay_area(&self, id: i64) -> Result<bool> {
        let done = sqlx::query("DELETE FROM overlay_areas WHERE id = ?1 AND status != 'fetching'")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(done.rows_affected() == 1)
    }

    /// Boot: a row still `fetching` was cut off by a restart. It becomes `partial` when some
    /// tiles arrived, `idle` otherwise, with `last_error = "interrupted"`. Returns the count.
    pub async fn reset_interrupted_area_fetches(&self) -> Result<u64> {
        let done = sqlx::query(
            "UPDATE overlay_areas SET status = CASE WHEN tiles_ok > 0 THEN 'partial' ELSE 'idle' END, \
             last_error = 'interrupted' WHERE status = 'fetching'",
        )
        .execute(&self.pool)
        .await?;
        Ok(done.rows_affected())
    }
}

#[cfg(test)]
mod tests {
    use rgcs_core::AreaStatus;

    use crate::Store;

    const RECT: (f64, f64, f64, f64) = (33.6, 135.85, 33.7, 135.95);
    const PO: (&str, &str) = ("p", "o");

    #[tokio::test]
    async fn areas_are_scoped_by_plugin_and_overlay() {
        let s = Store::open_memory().await.unwrap();
        let a = s.create_overlay_area(PO, "a", RECT, 1).await.unwrap();
        assert_eq!((a.plugin_id.as_str(), a.overlay_id.as_str()), PO);
        s.create_overlay_area(("p", "other"), "b", RECT, 1).await.unwrap();
        s.create_overlay_area(("q", "o"), "c", RECT, 1).await.unwrap();
        let names = |rows: Vec<rgcs_core::OverlayArea>| rows.into_iter().map(|a| a.name).collect::<Vec<_>>();
        assert_eq!(names(s.list_overlay_areas("p", "o").await.unwrap()), ["a"]);
        assert_eq!(names(s.list_overlay_areas("q", "o").await.unwrap()), ["c"]);
        assert!(s.list_overlay_areas("x", "o").await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn the_lte_table_is_gone() {
        let s = Store::open_memory().await.unwrap();
        let n: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sqlite_master WHERE name = 'lte_areas'")
            .fetch_one(&s.pool)
            .await
            .unwrap();
        assert_eq!(n, 0);
    }

    #[tokio::test]
    async fn create_list_get_delete() {
        let s = Store::open_memory().await.unwrap();
        assert!(s.list_overlay_areas("p", "o").await.unwrap().is_empty());
        let a = s.create_overlay_area(PO, "那智勝浦", RECT, 120).await.unwrap();
        assert_eq!(
            (a.name.as_str(), a.status, a.tiles_total),
            ("那智勝浦", AreaStatus::Idle, 120)
        );
        assert_eq!((a.south, a.west, a.north, a.east), RECT);
        assert!(a.created_at > 1_700_000_000_000);
        assert!(a.fetched_at.is_none() && a.data_modified.is_none() && a.last_error.is_none());
        s.create_overlay_area(PO, "b", RECT, 5).await.unwrap();
        let ids: Vec<_> = s
            .list_overlay_areas("p", "o")
            .await
            .unwrap()
            .iter()
            .map(|a| a.id)
            .collect();
        assert_eq!(ids, vec![a.id, a.id + 1]);
        assert_eq!(s.get_overlay_area(a.id).await.unwrap(), Some(a.clone()));
        assert!(s.delete_overlay_area(a.id).await.unwrap());
        assert!(!s.delete_overlay_area(a.id).await.unwrap());
        assert_eq!(s.get_overlay_area(a.id).await.unwrap(), None);
    }

    #[tokio::test]
    async fn fetch_lifecycle_and_busy_rules() {
        let s = Store::open_memory().await.unwrap();
        let a = s.create_overlay_area(PO, "a", RECT, 100).await.unwrap();
        assert!(s.begin_area_fetch(a.id, 100).await.unwrap());
        assert!(
            !s.begin_area_fetch(a.id, 100).await.unwrap(),
            "busy while fetching"
        );
        assert!(!s.begin_area_fetch(999, 1).await.unwrap(), "unknown id");
        assert!(
            !s.delete_overlay_area(a.id).await.unwrap(),
            "no delete while fetching"
        );
        s.area_progress(a.id, 10, 1, Some(2_000), Some("http_404"))
            .await
            .unwrap();
        s.area_progress(a.id, 20, 1, Some(1_000), None).await.unwrap();
        let mid = s.get_overlay_area(a.id).await.unwrap().unwrap();
        assert_eq!(
            (mid.status, mid.tiles_ok, mid.tiles_failed),
            (AreaStatus::Fetching, 20, 1)
        );
        assert_eq!(mid.data_modified, Some(2_000), "keeps the newest date");
        assert_eq!(mid.last_error.as_deref(), Some("http_404"));
        s.finish_area_fetch(a.id, AreaStatus::Partial, 5_000)
            .await
            .unwrap();
        let done = s.get_overlay_area(a.id).await.unwrap().unwrap();
        assert_eq!((done.status, done.fetched_at), (AreaStatus::Partial, Some(5_000)));
        // A refresh starts over but keeps the data date.
        assert!(s.begin_area_fetch(a.id, 100).await.unwrap());
        let again = s.get_overlay_area(a.id).await.unwrap().unwrap();
        assert_eq!(
            (again.tiles_ok, again.tiles_failed, again.last_error),
            (0, 0, None)
        );
        assert_eq!(again.data_modified, Some(2_000));
    }

    #[tokio::test]
    async fn interrupted_fetches_are_reset_on_boot() {
        let s = Store::open_memory().await.unwrap();
        let none = s.create_overlay_area(PO, "none", RECT, 10).await.unwrap();
        let some = s.create_overlay_area(PO, "some", RECT, 10).await.unwrap();
        let done = s.create_overlay_area(PO, "done", RECT, 10).await.unwrap();
        for a in [&none, &some, &done] {
            s.begin_area_fetch(a.id, 10).await.unwrap();
        }
        s.area_progress(some.id, 3, 0, None, None).await.unwrap();
        s.finish_area_fetch(done.id, AreaStatus::Ready, 1).await.unwrap();
        assert_eq!(s.reset_interrupted_area_fetches().await.unwrap(), 2);
        let status = |id| {
            let s = s.clone();
            async move { s.get_overlay_area(id).await.unwrap().unwrap() }
        };
        let n = status(none.id).await;
        assert_eq!(
            (n.status, n.last_error.as_deref()),
            (AreaStatus::Idle, Some("interrupted"))
        );
        assert_eq!(status(some.id).await.status, AreaStatus::Partial);
        assert_eq!(status(done.id).await.status, AreaStatus::Ready);
    }
}
