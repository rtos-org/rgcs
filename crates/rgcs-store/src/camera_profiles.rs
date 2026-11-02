//! `camera_profiles`: one row per sysid; absent rows read as the default.

use rgcs_core::{CameraKind, CameraProfile, SysId, VideoSourceMode};
use sqlx::Row;

use crate::{now_iso, Result, Store};

fn kind_str(k: CameraKind) -> &'static str {
    match k {
        CameraKind::None => "none",
        CameraKind::Mavlink => "mavlink",
        CameraKind::SiyiMt11 => "siyi_mt11",
    }
}

fn parse_kind(s: &str) -> CameraKind {
    match s {
        "mavlink" => CameraKind::Mavlink,
        "siyi_mt11" => CameraKind::SiyiMt11,
        _ => CameraKind::None,
    }
}

fn mode_str(m: VideoSourceMode) -> &'static str {
    match m {
        VideoSourceMode::Auto => "auto",
        VideoSourceMode::Mt11 => "mt11",
    }
}

impl Store {
    /// The stored profile, or the spec default when none was saved yet.
    pub async fn camera_profile(&self, sysid: SysId) -> Result<CameraProfile> {
        let row = sqlx::query("SELECT * FROM camera_profiles WHERE sysid = ?1")
            .bind(i64::from(sysid))
            .fetch_optional(&self.pool)
            .await?;
        let Some(r) = row else {
            return Ok(CameraProfile::default_for(sysid));
        };
        Ok(CameraProfile {
            sysid,
            kind: parse_kind(&r.get::<String, _>("kind")),
            host: r.get("host"),
            port: r.get::<i64, _>("port") as u16,
            rtsp_url: r.get("rtsp_url"),
            comp_id: r.get::<i64, _>("comp_id") as u8,
            video_source_mode: if r.get::<String, _>("video_source_mode") == "mt11" {
                VideoSourceMode::Mt11
            } else {
                VideoSourceMode::Auto
            },
            android_url: r.get("android_url"),
            encoding_preset: r.get("encoding_preset"),
            thermal_palette: r.get::<i64, _>("thermal_palette") as u8,
            thermal_overlay: r.get::<i64, _>("thermal_overlay") != 0,
            ai_box_px: r.get::<i64, _>("ai_box_px") as u16,
            clock_sync: r.get::<i64, _>("clock_sync") != 0,
            auto_record: r.get::<i64, _>("auto_record") != 0,
        })
    }

    /// Vehicles with a saved, non-`none` camera: these drivers are started at boot.
    pub async fn camera_profile_sysids(&self) -> Result<Vec<SysId>> {
        let rows = sqlx::query("SELECT sysid FROM camera_profiles WHERE kind != 'none' ORDER BY sysid")
            .fetch_all(&self.pool)
            .await?;
        Ok(rows
            .into_iter()
            .map(|r| r.get::<i64, _>("sysid") as SysId)
            .collect())
    }

    pub async fn put_camera_profile(&self, p: &CameraProfile) -> Result<()> {
        sqlx::query(
            "INSERT INTO camera_profiles (sysid, kind, host, port, rtsp_url, comp_id, video_source_mode, android_url, \
             encoding_preset, thermal_palette, thermal_overlay, ai_box_px, clock_sync, auto_record, updated_at) \
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15) \
             ON CONFLICT(sysid) DO UPDATE SET kind = excluded.kind, host = excluded.host, port = excluded.port, \
             rtsp_url = excluded.rtsp_url, comp_id = excluded.comp_id, video_source_mode = excluded.video_source_mode, \
             android_url = excluded.android_url, encoding_preset = excluded.encoding_preset, \
             thermal_palette = excluded.thermal_palette, thermal_overlay = excluded.thermal_overlay, \
             ai_box_px = excluded.ai_box_px, clock_sync = excluded.clock_sync, auto_record = excluded.auto_record, \
             updated_at = excluded.updated_at",
        )
        .bind(i64::from(p.sysid))
        .bind(kind_str(p.kind))
        .bind(&p.host)
        .bind(i64::from(p.port))
        .bind(&p.rtsp_url)
        .bind(i64::from(p.comp_id))
        .bind(mode_str(p.video_source_mode))
        .bind(&p.android_url)
        .bind(&p.encoding_preset)
        .bind(i64::from(p.thermal_palette))
        .bind(i64::from(p.thermal_overlay))
        .bind(i64::from(p.ai_box_px))
        .bind(i64::from(p.clock_sync))
        .bind(i64::from(p.auto_record))
        .bind(now_iso())
        .execute(&self.pool)
        .await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use crate::Store;
    use rgcs_core::{CameraKind, CameraProfile, VideoSourceMode};

    #[tokio::test]
    async fn unknown_sysid_reads_as_the_default_profile() {
        let s = Store::open_memory().await.unwrap();
        let p = s.camera_profile(7).await.unwrap();
        assert_eq!(p, CameraProfile::default_for(7));
        assert_eq!(p.kind, CameraKind::None);
        assert_eq!(p.host, "192.168.144.25");
        assert_eq!(p.port, 37260);
        assert_eq!(p.rtsp_url, "rtsp://{host}:8554/video1");
        assert_eq!(p.video_source_mode, VideoSourceMode::Auto);
        assert_eq!((p.ai_box_px, p.thermal_palette, p.auto_record), (100, 3, true));
    }

    #[tokio::test]
    async fn configured_sysids_lists_saved_non_none_profiles() {
        let s = Store::open_memory().await.unwrap();
        assert_eq!(s.camera_profile_sysids().await.unwrap(), Vec::<u8>::new());
        s.put_camera_profile(&CameraProfile {
            kind: CameraKind::SiyiMt11,
            ..CameraProfile::default_for(3)
        })
        .await
        .unwrap();
        s.put_camera_profile(&CameraProfile::default_for(1))
            .await
            .unwrap();
        s.put_camera_profile(&CameraProfile {
            kind: CameraKind::SiyiMt11,
            ..CameraProfile::default_for(2)
        })
        .await
        .unwrap();
        assert_eq!(s.camera_profile_sysids().await.unwrap(), vec![2, 3]);
    }

    #[tokio::test]
    async fn put_then_get_round_trips_and_overwrites() {
        let s = Store::open_memory().await.unwrap();
        let p = CameraProfile {
            kind: CameraKind::SiyiMt11,
            host: "10.0.0.5".into(),
            port: 4000,
            ..CameraProfile::default_for(1)
        };
        s.put_camera_profile(&p).await.unwrap();
        assert_eq!(s.camera_profile(1).await.unwrap(), p);
        let p2 = CameraProfile {
            port: 4001,
            ..p.clone()
        };
        s.put_camera_profile(&p2).await.unwrap();
        assert_eq!(s.camera_profile(1).await.unwrap().port, 4001);
    }
}
