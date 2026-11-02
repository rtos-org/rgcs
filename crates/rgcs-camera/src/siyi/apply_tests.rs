use super::*;
use rgcs_core::{StorageStatus, ThermalGain, TrackStatus, VideoCodec};
use std::time::Duration;

fn frame(cmd: u8, payload: Vec<u8>) -> Frame {
    Frame { cmd, payload }
}

fn le(values: &[u16]) -> Vec<u8> {
    values.iter().flat_map(|v| v.to_le_bytes()).collect()
}

fn base() -> CameraState {
    CameraState {
        connected: true,
        ..CameraState::disconnected(30.0)
    }
}

/// Applies `f`, returning the new state (or the old one when unchanged) and media.
fn step(state: &CameraState, media: &Media, f: Frame, now: Instant) -> (CameraState, Media) {
    let (next, media) = apply_frame(state, media, &f, now, 1_000_000);
    (next.unwrap_or_else(|| state.clone()), media)
}

fn encoding_reply(stream_type: u8, w: u16, h: u16) -> Frame {
    let mut p = vec![stream_type, 1];
    p.extend(le(&[w, h, 4000]));
    p.push(30);
    frame(0x20, p)
}

#[test]
fn apply_0x20_main_only() {
    let now = Instant::now();
    let (s, _) = step(&base(), &Media::default(), encoding_reply(1, 1920, 1080), now);
    assert_eq!(s.stream, Some((1920, 1080)));
    assert_eq!(s.encoding.as_ref().unwrap().codec, VideoCodec::H264);
    let (next, _) = apply_frame(&s, &Media::default(), &encoding_reply(0, 1280, 720), now, 0);
    assert!(next.is_none(), "sub stream ignored");
}

/// A 0x0 (or 1-pixel) main-stream reply is not a resolution.
#[test]
fn apply_0x20_zero_size_keeps_the_stream_unknown() {
    let now = Instant::now();
    for (w, h) in [(0, 1080), (1920, 0), (0, 0), (1, 1080)] {
        let (s, _) = step(&base(), &Media::default(), encoding_reply(1, w, h), now);
        assert_eq!(s.stream, None, "{w}x{h}");
        assert_eq!(s.encoding, None, "{w}x{h}");
    }
    let (known, _) = step(&base(), &Media::default(), encoding_reply(1, 1920, 1080), now);
    let (s, _) = step(&known, &Media::default(), encoding_reply(1, 0, 0), now);
    assert_eq!(s.stream, Some((1920, 1080)), "a bogus reply keeps the known size");
}

/// After a 0x21 the old size is not taken for the new one.
#[test]
fn apply_0x20_waits_for_the_requested_size() {
    let t0 = Instant::now();
    let pending = Media {
        pending_encoding: Some(PendingEncoding {
            size: (3840, 2160),
            since: t0,
        }),
        ..Media::default()
    };
    let at = |ms| t0 + Duration::from_millis(ms);
    let (s, m) = step(&base(), &pending, encoding_reply(1, 1920, 1080), at(300));
    assert_eq!(s.stream, None, "old size refused while the change settles");
    assert!(m.pending_encoding.is_some());
    let (s, m) = step(&s, &m, encoding_reply(1, 3840, 2160), at(1000));
    assert_eq!(s.stream, Some((3840, 2160)));
    assert_eq!(m.pending_encoding, None, "the matching size ends the wait");
    let (s, m) = step(&base(), &pending, encoding_reply(1, 1920, 1080), at(3000));
    assert_eq!(
        s.stream,
        Some((1920, 1080)),
        "after 3 s whatever the camera reports is taken"
    );
    assert_eq!(m.pending_encoding, None);
}

/// A refused 0x21 ends the wait; the camera keeps its old size.
#[test]
fn apply_0x21_rejection_ends_the_encoding_wait() {
    let t0 = Instant::now();
    let pending = Media {
        pending_encoding: Some(PendingEncoding {
            size: (3840, 2160),
            since: t0,
        }),
        ..Media::default()
    };
    let (_, m) = step(&base(), &pending, frame(0x21, vec![1, 1]), t0);
    assert!(
        m.pending_encoding.is_some(),
        "an accepted change still waits for its size"
    );
    let (_, m) = step(&base(), &pending, frame(0x21, vec![1, 0]), t0);
    assert_eq!(m.pending_encoding, None);
    let (s, _) = step(
        &base(),
        &m,
        encoding_reply(1, 1920, 1080),
        t0 + Duration::from_millis(300),
    );
    assert_eq!(s.stream, Some((1920, 1080)));
}

#[test]
fn apply_thermal_frames() {
    let now = Instant::now();
    let m = Media::default();
    let (s, m) = step(
        &base(),
        &m,
        frame(0x14, le(&[0x086a, 0x03e6, 0x063e, 0x0020, 0x01f4, 0x0362])),
        now,
    );
    let f = s.thermal.as_ref().unwrap().frame.as_ref().unwrap();
    assert_eq!((f.max_c, f.min_c, f.max_xy), (21.54, 9.98, (1598, 32)));
    assert_eq!(m.frame_at, Some(now));
    let (s, m) = step(&s, &m, frame(0x12, le(&[1604, 960, 540])), now);
    let p = s.thermal.as_ref().unwrap().point.clone().unwrap();
    assert_eq!((p.temp_c, p.xy, p.age_ms), (16.04, (960, 540), 0));
    assert_eq!(m.point_at, Some(now));
    let (s, _) = step(&s, &m, frame(0x37, vec![1]), now);
    let t = s.thermal.unwrap();
    assert_eq!(t.gain, Some(ThermalGain::High));
    assert_eq!(t.range_c, Some((-20.0, 150.0)));
    assert!(t.frame.is_some(), "gain keeps the frame");
}

fn track(status: u8) -> Frame {
    let mut p = le(&[640, 360, 128, 72]);
    p.extend([0, status]);
    frame(0x50, p)
}

#[test]
fn apply_track_and_cancel() {
    let now = Instant::now();
    let (s, m) = step(&base(), &Media::default(), track(0), now);
    let t = s.track.clone().unwrap();
    assert_eq!(t.status, TrackStatus::Tracking);
    assert!((t.rect.x - 0.45).abs() < 1e-4 && (t.rect.w - 0.1).abs() < 1e-4);
    assert_eq!(m.track_at, Some(now));
    let (s, m) = step(&s, &m, track(2), now);
    assert_eq!(s.track.as_ref().unwrap().status, TrackStatus::Lost);
    let (s, m) = step(&s, &m, track(3), now);
    assert_eq!(s.track, None);
    assert_eq!(m.track_at, None);
}

fn candidates(pts: u64) -> Frame {
    let mut p = vec![0, 0];
    p.extend(pts.to_le_bytes());
    p.push(1);
    p.extend(le(&[0x6666, 0x6666, 0x8000, 0x9999, 0xE666]));
    p.push(0);
    frame(0x5F, p)
}

#[test]
fn apply_candidates_history() {
    let t = Instant::now();
    let (next, m) = apply_frame(&base(), &Media::default(), &frame(0x5F, vec![5, 0]), t, 0);
    assert!(next.is_none() && m.history.is_empty(), "enable ACK ignored");
    let (s, m) = step(&base(), &m, candidates(1), t);
    let (s, m) = step(&s, &m, candidates(2), t + Duration::from_secs(1));
    assert_eq!(m.history.len(), 2);
    let (s, m) = step(&s, &m, candidates(3), t + Duration::from_secs(3));
    assert_eq!(m.history.len(), 1);
    assert_eq!(m.history[0].1.pts_us, 3);
    assert_eq!(s.candidates.len(), 1);
    assert_eq!(m.candidates_at, Some(t + Duration::from_secs(3)));
    let (s, m) = (0..61u64).fold((s, m), |(s, m), i| {
        step(
            &s,
            &m,
            candidates(10 + i),
            t + Duration::from_millis(4000 + i * 16),
        )
    });
    assert_eq!(m.history.len(), 60);
    assert_eq!(m.history.last().unwrap().1.pts_us, 70);
    assert_eq!(s.candidates[0].class_name, "person");
}

#[test]
fn apply_acks() {
    let now = Instant::now();
    let (s, m) = step(&base(), &Media::default(), frame(0x56, vec![4]), now);
    assert_eq!(
        s.ai_ack.clone().unwrap(),
        rgcs_core::AiAck {
            code: "low_texture".into(),
            seq: 1
        }
    );
    let (s, m) = step(&s, &m, frame(0x56, vec![4]), now);
    assert_eq!(s.ai_ack.as_ref().unwrap().seq, 2);
    let (s, m) = step(&s, &m, frame(0x55, vec![1, 3]), now);
    assert_eq!(s.ai_ack.clone().unwrap().code, "stabilization_no_ai");
    assert_eq!(m.ack_seq, 3);
}

#[test]
fn apply_tf_and_clock() {
    let now = Instant::now();
    let mut tf = le(&[2 | 2 << 8]);
    tf.extend(le(&[12800, 5630]));
    let (s, m) = step(&base(), &Media::default(), frame(0x49, tf), now);
    let st = s.storage.clone().unwrap();
    assert_eq!(st.status, StorageStatus::Ok);
    assert_eq!(st.total_gb, 128.0);

    // A sync is in flight: the 0x40 reply completes the read-back.
    let gps = crate::clock_sync::GpsSample {
        unix_us: 1_790_000_000_000_000,
        received_at_us: 900_000,
    };
    let (clock, _) = m.clock.tick(1_000_000, true, Some(gps));
    let m = Media { clock, ..m };
    let mut p = 1_790_000_000_200_000u64.to_le_bytes().to_vec();
    p.extend(0u32.to_le_bytes());
    let (next, m) = apply_frame(&s, &m, &frame(0x40, p), now, 1_020_000);
    let c = next.unwrap().clock.unwrap();
    assert_eq!(c.camera_unix_us, Some(1_790_000_000_200_000));
    assert_eq!(c.reading_age_ms, Some(0));
    assert_eq!(m.clock_read_at, Some(now));
    assert_eq!(m.clock.status().rtt_ms, Some(20.0));
    assert_eq!(c.offset_ms, m.clock.status().offset_ms);
    assert!(c.offset_ms.is_some());
}

#[test]
fn apply_0x30_rejection_reports_a_failed_sync() {
    let now = Instant::now();
    let gps = crate::clock_sync::GpsSample {
        unix_us: 1_790_000_000_000_000,
        received_at_us: 900_000,
    };
    let (clock, _) = ClockSync::new().tick(1_000_000, true, Some(gps));
    let m = Media {
        clock,
        ..Media::default()
    };
    let (next, m2) = apply_frame(&base(), &m, &frame(0x30, vec![1]), now, 1_010_000);
    assert!(next.is_none(), "an accepted time changes nothing");
    assert_eq!(m2.clock, m.clock);
    let (next, m) = apply_frame(&base(), &m, &frame(0x30, vec![0]), now, 1_010_000);
    assert_eq!(next.unwrap().clock.unwrap().error.as_deref(), Some("rejected"));
    assert_eq!(m.clock.status().ok, Some(false));
}

#[test]
fn unknown_frames_change_nothing() {
    let (next, _) = apply_frame(
        &base(),
        &Media::default(),
        &frame(0x21, vec![1, 1]),
        Instant::now(),
        0,
    );
    assert!(next.is_none());
}

#[test]
fn clock_view_maps_sync_time_to_wall_clock() {
    let now = Instant::now();
    let gps = crate::clock_sync::GpsSample {
        unix_us: 1_790_000_000_000_000,
        received_at_us: 5_000_000,
    };
    let (clock, _) = ClockSync::new().tick(5_000_000, true, Some(gps));
    let media = Media {
        clock,
        clock_read_at: Some(now),
        ..Media::default()
    };
    let s = clock_view(
        &base(),
        &media,
        now + std::time::Duration::from_millis(1500),
        7_000_000,
        1_000_000,
    )
    .unwrap();
    let c = s.clock.clone().unwrap();
    assert_eq!(c.synced_at_unix_ms, Some(998_000));
    assert_eq!(c.reading_age_ms, Some(1500));
    assert_eq!(
        clock_view(
            &s,
            &media,
            now + std::time::Duration::from_millis(1500),
            7_000_000,
            1_000_000
        ),
        None
    );
    assert_eq!(
        clock_view(&base(), &Media::default(), now, 0, 0),
        None,
        "nothing to show yet"
    );
}
