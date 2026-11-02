//! `roi_targets` / `roi_control`: ten ROI presets and the control parameters per
//! vehicle. Absent rows read as the defaults.

use rgcs_core::{default_roi_targets, RoiControl, RoiControlMode, RoiTarget, SysId, ROI_SLOT_COUNT};
use sqlx::Row;

use crate::{now_iso, Result, Store};

fn mode_str(m: RoiControlMode) -> &'static str {
    match m {
        RoiControlMode::Rate => "rate",
        RoiControlMode::Angle => "angle",
    }
}

fn parse_mode(s: &str) -> RoiControlMode {
    if s == "angle" {
        RoiControlMode::Angle
    } else {
        RoiControlMode::Rate
    }
}

impl Store {
    /// Always 10 rows in slot order; missing rows read as `RoiTarget::empty(n)`.
    pub async fn roi_targets(&self, sysid: SysId) -> Result<Vec<RoiTarget>> {
        let rows = sqlx::query("SELECT id, name, lat, lon, alt_msl FROM roi_targets WHERE sysid = ?1")
            .bind(i64::from(sysid))
            .fetch_all(&self.pool)
            .await?;
        let mut slots = default_roi_targets();
        for r in rows {
            let t = RoiTarget {
                id: r.get("id"),
                name: r.get("name"),
                lat: r.get("lat"),
                lon: r.get("lon"),
                alt_msl: r.get("alt_msl"),
            };
            if let Some(slot) = slots.iter_mut().find(|s| s.id == t.id) {
                *slot = t;
            }
        }
        debug_assert_eq!(slots.len(), ROI_SLOT_COUNT);
        Ok(slots)
    }

    /// Replaces all 10 in one transaction (caller validated).
    pub async fn put_roi_targets(&self, sysid: SysId, targets: &[RoiTarget]) -> Result<()> {
        let now = now_iso();
        let mut tx = self.pool.begin().await?;
        for t in targets {
            sqlx::query(
                "INSERT INTO roi_targets (sysid, id, name, lat, lon, alt_msl, updated_at) \
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) \
                 ON CONFLICT(sysid, id) DO UPDATE SET name = excluded.name, lat = excluded.lat, \
                 lon = excluded.lon, alt_msl = excluded.alt_msl, updated_at = excluded.updated_at",
            )
            .bind(i64::from(sysid))
            .bind(&t.id)
            .bind(&t.name)
            .bind(t.lat)
            .bind(t.lon)
            .bind(t.alt_msl)
            .bind(&now)
            .execute(&mut *tx)
            .await?;
        }
        tx.commit().await?;
        Ok(())
    }

    /// The stored control parameters, or the defaults when none were saved yet. A `rate_hz`
    /// below the 1 Hz floor (saved before it existed) loads clamped.
    pub async fn roi_control(&self, sysid: SysId) -> Result<RoiControl> {
        let row = sqlx::query("SELECT * FROM roi_control WHERE sysid = ?1")
            .bind(i64::from(sysid))
            .fetch_optional(&self.pool)
            .await?;
        let Some(r) = row else {
            return Ok(RoiControl::default());
        };
        Ok(RoiControl {
            control_mode: parse_mode(&r.get::<String, _>("control_mode")),
            rate_hz: r.get("rate_hz"),
            target_rate_hz: r.get("target_rate_hz"),
            smoothing_tau_s: r.get("smoothing_tau_s"),
            deadband_deg: r.get("deadband_deg"),
            pid_kp: r.get("pid_kp"),
            pid_ki: r.get("pid_ki"),
            pid_kd: r.get("pid_kd"),
            max_speed: r.get("max_speed"),
            yaw_offset_deg: r.get("yaw_offset_deg"),
        }
        .clamp_rate())
    }

    pub async fn put_roi_control(&self, sysid: SysId, c: &RoiControl) -> Result<()> {
        sqlx::query(
            "INSERT INTO roi_control (sysid, control_mode, rate_hz, target_rate_hz, smoothing_tau_s, \
             deadband_deg, pid_kp, pid_ki, pid_kd, max_speed, yaw_offset_deg, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12) \
             ON CONFLICT(sysid) DO UPDATE SET control_mode = excluded.control_mode, \
             rate_hz = excluded.rate_hz, target_rate_hz = excluded.target_rate_hz, \
             smoothing_tau_s = excluded.smoothing_tau_s, deadband_deg = excluded.deadband_deg, \
             pid_kp = excluded.pid_kp, pid_ki = excluded.pid_ki, pid_kd = excluded.pid_kd, \
             max_speed = excluded.max_speed, yaw_offset_deg = excluded.yaw_offset_deg, \
             updated_at = excluded.updated_at",
        )
        .bind(i64::from(sysid))
        .bind(mode_str(c.control_mode))
        .bind(c.rate_hz)
        .bind(c.target_rate_hz)
        .bind(c.smoothing_tau_s)
        .bind(c.deadband_deg)
        .bind(c.pid_kp)
        .bind(c.pid_ki)
        .bind(c.pid_kd)
        .bind(c.max_speed)
        .bind(c.yaw_offset_deg)
        .bind(now_iso())
        .execute(&self.pool)
        .await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use crate::Store;
    use rgcs_core::{default_roi_targets, RoiControl, RoiControlMode, RoiTarget};

    #[tokio::test]
    async fn unknown_vehicle_reads_ten_empty_slots() {
        let s = Store::open_memory().await.unwrap();
        assert_eq!(s.roi_targets(7).await.unwrap(), default_roi_targets());
        assert_eq!(s.roi_control(7).await.unwrap(), RoiControl::default());
    }

    fn with_slot3() -> Vec<RoiTarget> {
        let mut t = default_roi_targets();
        t[2] = RoiTarget {
            id: "roi_3".into(),
            name: "送電塔 A".into(),
            lat: 35.479883,
            lon: 138.48829,
            alt_msl: 412.0,
        };
        t
    }

    #[tokio::test]
    async fn targets_round_trip_and_replace() {
        let s = Store::open_memory().await.unwrap();
        let t = with_slot3();
        s.put_roi_targets(1, &t).await.unwrap();
        assert_eq!(s.roi_targets(1).await.unwrap(), t);
        s.put_roi_targets(1, &default_roi_targets()).await.unwrap();
        assert_eq!(s.roi_targets(1).await.unwrap()[2], RoiTarget::empty(3));
    }

    #[tokio::test]
    async fn targets_are_per_vehicle() {
        let s = Store::open_memory().await.unwrap();
        s.put_roi_targets(1, &with_slot3()).await.unwrap();
        assert_eq!(s.roi_targets(2).await.unwrap(), default_roi_targets());
        let c = RoiControl {
            pid_kp: 1.5,
            ..RoiControl::default()
        };
        s.put_roi_control(1, &c).await.unwrap();
        assert_eq!(s.roi_control(2).await.unwrap(), RoiControl::default());
    }

    #[tokio::test]
    async fn control_round_trip() {
        let s = Store::open_memory().await.unwrap();
        let c = RoiControl {
            control_mode: RoiControlMode::Angle,
            pid_kp: 1.5,
            max_speed: 40.0,
            ..RoiControl::default()
        };
        s.put_roi_control(1, &c).await.unwrap();
        assert_eq!(s.roi_control(1).await.unwrap(), c);
        let c2 = RoiControl {
            pid_kp: 3.0,
            yaw_offset_deg: -12.5,
            ..c
        };
        s.put_roi_control(1, &c2).await.unwrap();
        assert_eq!(s.roi_control(1).await.unwrap(), c2);
    }

    /// I6: rows saved before the 1 Hz floor load clamped, not as a 20 s control period.
    #[tokio::test]
    async fn control_below_rate_floor_loads_clamped() {
        let s = Store::open_memory().await.unwrap();
        let c = RoiControl {
            rate_hz: 0.05,
            ..RoiControl::default()
        };
        s.put_roi_control(1, &c).await.unwrap();
        let loaded = s.roi_control(1).await.unwrap();
        assert_eq!(loaded.rate_hz, RoiControl::RATE_HZ_MIN);
        assert!(loaded.validate().is_ok());
    }

    #[tokio::test]
    async fn slot_order_is_numeric() {
        let s = Store::open_memory().await.unwrap();
        s.put_roi_targets(1, &default_roi_targets()).await.unwrap();
        let ids: Vec<String> = s
            .roi_targets(1)
            .await
            .unwrap()
            .into_iter()
            .map(|t| t.id)
            .collect();
        let want: Vec<String> = (1..=10).map(|n| format!("roi_{n}")).collect();
        assert_eq!(ids, want);
        assert_eq!(ids[9], "roi_10");
    }
}
