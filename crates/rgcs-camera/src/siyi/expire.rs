//! Drops overlays the camera stopped refreshing (Python `thermal.py`, `video_routes.py` ages).

use std::time::{Duration, Instant};

use rgcs_core::{CameraState, ThermalState};

use crate::siyi::ai::{DETECTION_SHOW_MAX_AGE, TRACK_MAX_AGE};
use crate::siyi::apply::Media;
use crate::siyi::thermal::{FRAME_MAX_AGE, POINT_MAX_AGE};

/// `Some` only when something expired.
pub fn expire(state: &CameraState, media: &Media, now: Instant) -> Option<CameraState> {
    let fresh =
        |at: Option<Instant>, max: Duration| at.is_some_and(|t| now.saturating_duration_since(t) <= max);
    let track = state
        .track
        .clone()
        .filter(|_| fresh(media.track_at, TRACK_MAX_AGE));
    let candidates = if fresh(media.candidates_at, DETECTION_SHOW_MAX_AGE) {
        state.candidates.clone()
    } else {
        Vec::new()
    };
    let thermal = state.thermal.clone().map(|t| ThermalState {
        frame: t.frame.filter(|_| fresh(media.frame_at, FRAME_MAX_AGE)),
        point: t.point.filter(|_| fresh(media.point_at, POINT_MAX_AGE)),
        ..t
    });
    let next = CameraState {
        track,
        candidates,
        thermal,
        ..state.clone()
    };
    (next != *state).then_some(next)
}

/// The state after the link dropped or the driver stopped: media goes,
/// `storage` and `clock` stay so the last known values remain visible.
pub fn offline(state: &CameraState) -> CameraState {
    CameraState {
        connected: false,
        gimbal: None,
        stream: None,
        encoding: None,
        track: None,
        candidates: Vec::new(),
        thermal: state.thermal.clone().map(|t| ThermalState {
            frame: None,
            point: None,
            ..t
        }),
        ..state.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rgcs_core::{Detection, NormRect, ThermalFrame, ThermalPoint, ThermalState, TrackState, TrackStatus};

    fn full(now: Instant) -> (CameraState, Media) {
        let state = CameraState {
            connected: true,
            track: Some(TrackState {
                status: TrackStatus::Tracking,
                rect: NormRect {
                    x: 0.1,
                    y: 0.1,
                    w: 0.1,
                    h: 0.1,
                },
                target: "person".into(),
                age_ms: 0,
            }),
            candidates: vec![Detection {
                x0: 0.1,
                y0: 0.1,
                x1: 0.2,
                y1: 0.2,
                score: 0.9,
                class_id: 0,
                class_name: "person".into(),
            }],
            thermal: Some(ThermalState {
                gain: None,
                range_c: None,
                frame: Some(ThermalFrame {
                    max_c: 20.0,
                    min_c: 10.0,
                    max_xy: (1, 1),
                    min_xy: (2, 2),
                }),
                point: Some(ThermalPoint {
                    temp_c: 16.0,
                    xy: (3, 3),
                    age_ms: 0,
                }),
            }),
            ..CameraState::disconnected(30.0)
        };
        let media = Media {
            track_at: Some(now),
            candidates_at: Some(now),
            frame_at: Some(now),
            point_at: Some(now),
            ..Media::default()
        };
        (state, media)
    }

    fn ago(now: Instant, ms: u64) -> Option<Instant> {
        now.checked_sub(Duration::from_millis(ms))
    }

    #[test]
    fn expire_drops_stale_overlays() {
        let now = Instant::now() + Duration::from_secs(60);
        let (s, m) = full(now);
        assert_eq!(expire(&s, &m, now), None, "all fresh");

        let t = expire(
            &s,
            &Media {
                track_at: ago(now, 1100),
                ..m.clone()
            },
            now,
        )
        .unwrap();
        assert_eq!(t.track, None);
        assert_eq!(t.candidates.len(), 1);

        let c = expire(
            &s,
            &Media {
                candidates_at: ago(now, 600),
                ..m.clone()
            },
            now,
        )
        .unwrap();
        assert!(c.candidates.is_empty());
        assert!(c.track.is_some());

        let f = expire(
            &s,
            &Media {
                frame_at: ago(now, 3100),
                ..m.clone()
            },
            now,
        )
        .unwrap();
        assert_eq!(f.thermal.as_ref().unwrap().frame, None);
        assert!(f.thermal.as_ref().unwrap().point.is_some());

        let p = expire(
            &s,
            &Media {
                point_at: ago(now, 15_100),
                ..m.clone()
            },
            now,
        )
        .unwrap();
        assert_eq!(p.thermal.as_ref().unwrap().point, None);
        assert!(p.thermal.as_ref().unwrap().frame.is_some());
    }

    #[test]
    fn expired_state_is_stable() {
        let now = Instant::now() + Duration::from_secs(60);
        let (s, m) = full(now);
        let stale = Media {
            track_at: ago(now, 2000),
            ..m
        };
        let once = expire(&s, &stale, now).unwrap();
        assert_eq!(expire(&once, &stale, now), None);
    }

    #[test]
    fn offline_clears_media_but_keeps_storage_and_clock() {
        let now = Instant::now() + Duration::from_secs(60);
        let (s, _) = full(now);
        let s = CameraState {
            stream: Some((1920, 1080)),
            storage: Some(rgcs_core::StorageInfo {
                status: rgcs_core::StorageStatus::Ok,
                fs: "exFAT".into(),
                total_gb: 128.0,
                free_gb: 56.3,
                free_pct: Some(44.0),
            }),
            ..s
        };
        let o = offline(&s);
        assert!(!o.connected);
        assert_eq!(
            (o.stream, o.track.is_none(), o.candidates.is_empty()),
            (None, true, true)
        );
        let t = o.thermal.unwrap();
        assert_eq!((t.frame, t.point), (None, None));
        assert_eq!(o.storage, s.storage);
    }
}
