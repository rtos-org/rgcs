//! Driver tests for the thermal / AI / encoding / SD / clock paths, against `SimServer`.

use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use rgcs_core::{CameraCommand, StorageStatus, TrackStatus, VideoMode};

use super::{drain, wait_until};
use crate::camera::{Camera, GpsTime, TimeSample};
use crate::siyi::client::SiyiMt11;
use crate::siyi::sim::{SimServer, Transport};
use crate::CameraError;

const GPS_US: u64 = 1_790_000_000_000_000;

struct FakeGps;

#[async_trait]
impl GpsTime for FakeGps {
    async fn sample(&self) -> Option<TimeSample> {
        Some(TimeSample {
            unix_us: GPS_US,
            age_us: 0,
        })
    }
}

async fn pair(gps: bool) -> (SiyiMt11, SimServer) {
    let sim = SimServer::start().await;
    let cam = SiyiMt11::new(sim.addr.ip().to_string().parse().unwrap(), sim.addr.port());
    let cam = if gps {
        cam.with_gps_time(Arc::new(FakeGps))
    } else {
        cam
    };
    cam.connect().await.unwrap();
    wait_until(
        &cam,
        |s| s.connected && s.video_mode.is_some() && s.stream.is_some(),
        3,
    )
    .await;
    (cam, sim)
}

fn tcp(got: &[(Transport, u8, Vec<u8>)], cmd: u8) -> Vec<Vec<u8>> {
    got.iter()
        .filter(|(t, c, _)| *t == Transport::Tcp && *c == cmd)
        .map(|(_, _, p)| p.clone())
        .collect()
}

/// Everything the sim receives during `window` (polls keep `drain` from ever going quiet).
async fn collect(sim: &mut SimServer, window: Duration) -> Vec<(Transport, u8, Vec<u8>)> {
    let deadline = tokio::time::Instant::now() + window;
    let mut out = Vec::new();
    while let Ok(Some(m)) = tokio::time::timeout_at(deadline, sim.received.recv()).await {
        out.push(m);
    }
    out
}

fn u16_at(p: &[u8], i: usize) -> u16 {
    u16::from_le_bytes([p[i], p[i + 1]])
}

async fn select_box(cam: &SiyiMt11) -> Result<(), CameraError> {
    cam.send(CameraCommand::AiSelectBox {
        x: 0.5,
        y: 0.5,
        box_px: Some(150),
    })
    .await
}

#[tokio::test]
async fn connect_polls_media() {
    let sim = SimServer::start().await;
    let mut sim = sim;
    let cam = SiyiMt11::new(sim.addr.ip().to_string().parse().unwrap(), sim.addr.port());
    cam.connect().await.unwrap();
    let s = wait_until(
        &cam,
        |s| {
            s.stream.is_some()
                && s.storage.is_some()
                && s.thermal.as_ref().is_some_and(|t| t.gain.is_some())
                && s.clock.as_ref().is_some_and(|c| c.camera_unix_us.is_some())
        },
        2,
    )
    .await;
    assert_eq!(s.stream, Some((1920, 1080)));
    assert_eq!(s.storage.unwrap().status, StorageStatus::Ok);
    let got = drain(&mut sim, 200).await;
    for (cmd, data) in [
        (0x20, vec![1]),
        (0x49, vec![]),
        (0x37, vec![]),
        (0x40, vec![]),
        (0x51, vec![1]),
        (0x5F, vec![5]),
    ] {
        assert!(tcp(&got, cmd).contains(&data), "0x{cmd:02X} {data:?} missing");
    }
    cam.disconnect().await;
}

#[tokio::test]
async fn click_track_flow() {
    let (cam, mut sim) = pair(false).await;
    drain(&mut sim, 100).await;
    select_box(&cam).await.unwrap();
    let got = drain(&mut sim, 200).await;
    let order: Vec<u8> = got
        .iter()
        .map(|(_, c, _)| *c)
        .filter(|c| [0x55, 0x56].contains(c))
        .collect();
    assert_eq!(order, vec![0x55, 0x56]);
    assert_eq!(tcp(&got, 0x55), vec![vec![1]]);
    assert_eq!(
        tcp(&got, 0x56),
        vec![vec![0x01, 0x75, 0x03, 0xD1, 0x01, 0x0B, 0x04, 0x67, 0x02]]
    );
    wait_until(
        &cam,
        |s| {
            s.track
                .as_ref()
                .is_some_and(|t| t.status == TrackStatus::Tracking)
        },
        1,
    )
    .await;
    cam.send(CameraCommand::AiCancel).await.unwrap();
    let t0 = std::time::Instant::now();
    wait_until(&cam, |s| s.track.is_none(), 2).await;
    assert!(t0.elapsed() < Duration::from_millis(1500), "{:?}", t0.elapsed());
    cam.disconnect().await;
}

#[tokio::test]
async fn click_refused_outside_rgb() {
    let (cam, _sim) = pair(false).await;
    cam.send(CameraCommand::VideoMode {
        mode: VideoMode::Thermal,
    })
    .await
    .unwrap();
    wait_until(&cam, |s| s.video_mode == Some(VideoMode::Thermal), 2).await;
    assert_eq!(select_box(&cam).await, Err(CameraError::Refused("rgb_only")));
    assert_eq!(
        cam.send(CameraCommand::AiSelectPoint { x: 0.5, y: 0.5 }).await,
        Err(CameraError::Refused("rgb_only"))
    );
    cam.disconnect().await;
}

#[tokio::test]
async fn encoding_change_refuses_clicks_until_reread() {
    let (cam, mut sim) = pair(false).await;
    cam.send(CameraCommand::Encoding {
        preset: "h264_4k".into(),
    })
    .await
    .unwrap();
    assert_eq!(
        select_box(&cam).await,
        Err(CameraError::Refused("stream_unknown"))
    );
    let got = drain(&mut sim, 100).await;
    assert_eq!(tcp(&got, 0x21), vec![vec![1, 1, 0x00, 0x0F, 0x70, 0x08, 0, 0, 0]]);
    wait_until(&cam, |s| s.stream == Some((3840, 2160)), 2).await;
    select_box(&cam).await.unwrap();
    cam.disconnect().await;
}

/// A refused 0x21 fails the command, and the old size comes back.
#[tokio::test]
async fn rejected_encoding_fails_the_command() {
    let (cam, sim) = pair(false).await;
    sim.set_reject_encoding(true);
    assert_eq!(
        cam.send(CameraCommand::Encoding {
            preset: "h264_4k".into()
        })
        .await,
        Err(CameraError::Refused("encoding_rejected"))
    );
    wait_until(&cam, |s| s.stream == Some((1920, 1080)), 1).await;
    sim.set_reject_encoding(false);
    cam.send(CameraCommand::Encoding {
        preset: "h264_4k".into(),
    })
    .await
    .unwrap();
    wait_until(&cam, |s| s.stream == Some((3840, 2160)), 2).await;
    cam.disconnect().await;
}

/// The old size a slow encoder still reports is not taken for the new one.
#[tokio::test]
async fn encoding_change_waits_for_the_requested_size() {
    let (cam, sim) = pair(false).await;
    sim.set_stale_encoding_replies(2);
    cam.send(CameraCommand::Encoding {
        preset: "h264_4k".into(),
    })
    .await
    .unwrap();
    tokio::time::sleep(Duration::from_millis(700)).await;
    assert_eq!(
        cam.state().borrow().stream,
        None,
        "the 300 ms re-read still saw 1080p"
    );
    assert_eq!(
        select_box(&cam).await,
        Err(CameraError::Refused("stream_unknown"))
    );
    wait_until(&cam, |s| s.stream == Some((3840, 2160)), 4).await;
    select_box(&cam).await.unwrap();
    cam.disconnect().await;
}

#[tokio::test]
async fn unconfirmed_encoding_change_takes_the_reported_size_after_3_s() {
    let (cam, sim) = pair(false).await;
    sim.set_stale_encoding_replies(20);
    cam.send(CameraCommand::Encoding {
        preset: "h264_4k".into(),
    })
    .await
    .unwrap();
    tokio::time::sleep(Duration::from_millis(2500)).await;
    assert_eq!(cam.state().borrow().stream, None);
    wait_until(&cam, |s| s.stream == Some((1920, 1080)), 3).await;
    cam.disconnect().await;
}

#[tokio::test]
async fn ctrl_click_picks_detection() {
    let (cam, mut sim) = pair(false).await;
    wait_until(&cam, |s| !s.candidates.is_empty(), 7).await;
    drain(&mut sim, 50).await;
    cam.send(CameraCommand::AiSelectPoint { x: 0.45, y: 0.5 })
        .await
        .unwrap();
    let got = drain(&mut sim, 200).await;
    assert_eq!(tcp(&got, 0x55), vec![vec![1]]);
    let sel = tcp(&got, 0x56);
    assert_eq!(sel.len(), 1, "{got:?}");
    let (x, y) = (u16_at(&sel[0], 1), u16_at(&sel[0], 3));
    assert_eq!(sel[0][0], 1);
    assert!(x.abs_diff(864) <= 1 && y.abs_diff(540) <= 1, "({x}, {y})");
    assert_eq!((u16_at(&sel[0], 5), u16_at(&sel[0], 7)), (0, 0));
    cam.disconnect().await;
}

#[tokio::test]
async fn ctrl_click_miss_is_refused() {
    let (cam, _sim) = pair(false).await;
    wait_until(&cam, |s| !s.candidates.is_empty(), 7).await;
    assert_eq!(
        cam.send(CameraCommand::AiSelectPoint { x: 0.05, y: 0.05 }).await,
        Err(CameraError::Refused("no_detection"))
    );
    cam.disconnect().await;
}

#[tokio::test]
async fn alt_click_requires_thermal() {
    let (cam, mut sim) = pair(false).await;
    let measure = CameraCommand::MeasurePoint { x: 0.5, y: 0.5 };
    assert_eq!(
        cam.send(measure.clone()).await,
        Err(CameraError::Refused("thermal_only"))
    );
    cam.send(CameraCommand::VideoMode {
        mode: VideoMode::Thermal,
    })
    .await
    .unwrap();
    wait_until(&cam, |s| s.video_mode == Some(VideoMode::Thermal), 2).await;
    drain(&mut sim, 50).await;
    cam.send(measure).await.unwrap();
    let s = wait_until(&cam, |s| s.thermal.as_ref().is_some_and(|t| t.point.is_some()), 1).await;
    assert_eq!(s.thermal.unwrap().point.unwrap().temp_c, 16.04);
    let got = drain(&mut sim, 100).await;
    assert!(
        tcp(&got, 0x12).contains(&vec![0xC0, 0x03, 0x1C, 0x02, 0x01]),
        "{got:?}"
    );
    cam.disconnect().await;
}

#[tokio::test]
async fn ir_switch_cancels_tracking() {
    let (cam, mut sim) = pair(false).await;
    select_box(&cam).await.unwrap();
    wait_until(&cam, |s| s.track.is_some(), 1).await;
    drain(&mut sim, 50).await;
    cam.send(CameraCommand::VideoMode {
        mode: VideoMode::Thermal,
    })
    .await
    .unwrap();
    let got = drain(&mut sim, 200).await;
    assert!(tcp(&got, 0x56).contains(&vec![0; 9]), "{got:?}");
    assert!(tcp(&got, 0x11).contains(&vec![2, 0]), "{got:?}");
    cam.disconnect().await;
}

#[tokio::test]
async fn clock_sync_with_fake_gps() {
    let (cam, mut sim) = pair(true).await;
    let s = wait_until(
        &cam,
        |s| s.clock.as_ref().is_some_and(|c| c.offset_ms.is_some()),
        2,
    )
    .await;
    let offset = s.clock.unwrap().offset_ms.unwrap();
    assert!(offset.abs() < 100.0, "offset {offset}");
    let got = drain(&mut sim, 100).await;
    let set = tcp(&got, 0x30);
    assert_eq!(set.len(), 1, "{got:?}");
    let sent = u64::from_le_bytes(set[0][..8].try_into().unwrap());
    assert!(sent.abs_diff(GPS_US) < 50_000, "sent {sent}");
    assert!(!tcp(&got, 0x40).is_empty());
    cam.send(CameraCommand::SyncClock).await.unwrap();
    let got = collect(&mut sim, Duration::from_millis(1300)).await;
    assert_eq!(tcp(&got, 0x30).len(), 1, "{got:?}");
    cam.disconnect().await;
}

#[tokio::test]
async fn sync_clock_without_source_refused() {
    let (cam, _sim) = pair(false).await;
    assert_eq!(
        cam.send(CameraCommand::SyncClock).await,
        Err(CameraError::Refused("clock_sync_off"))
    );
    cam.disconnect().await;
}

#[tokio::test]
async fn session_end_clears_media_but_keeps_storage() {
    let (cam, sim) = pair(false).await;
    wait_until(&cam, |s| s.storage.is_some(), 2).await;
    sim.stop().await;
    let s = wait_until(&cam, |s| !s.connected, 3).await;
    assert_eq!(
        (s.stream, s.encoding.is_none(), s.track.is_none()),
        (None, true, true)
    );
    assert!(s.candidates.is_empty());
    assert!(s.storage.is_some(), "storage stays");
    cam.disconnect().await;
}
