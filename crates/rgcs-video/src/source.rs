//! Which source the UI should play: MT11 while its RTSP answers.

//! Which source the UI should play: MT11 while its RTSP answers.

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;

use rgcs_core::{VideoSource, VideoSourceMode, VideoSourceStatus};
use tokio::sync::watch;
use tokio::task::JoinHandle;

/// MediaMTX path the relay forwards to (one vehicle per Pi in the standalone build).
pub const WHEP_PATH: &str = "mt11";
/// Consecutive failed probes before an auto source is abandoned.
pub const FAIL_THRESHOLD: u32 = 2;

pub type ProbeFn = Arc<dyn Fn(String) -> Pin<Box<dyn Future<Output = bool> + Send>> + Send + Sync>;

#[derive(Debug, Clone, Copy)]
pub struct Timings {
    pub check: Duration,
    pub rescan: Duration,
    pub timeout: Duration,
}

impl Default for Timings {
    fn default() -> Self {
        Self {
            check: Duration::from_secs(3),
            rescan: Duration::from_secs(15),
            timeout: Duration::from_secs(2),
        }
    }
}

pub fn initial_status(mode: VideoSourceMode) -> VideoSourceStatus {
    VideoSourceStatus {
        mode,
        source: if mode == VideoSourceMode::Mt11 {
            VideoSource::Mt11
        } else {
            VideoSource::None
        },
        scanning: mode == VideoSourceMode::Auto,
        probe_ok: false,
        whep_path: WHEP_PATH.into(),
    }
}

/// Pure transition: a live auto source survives one failed probe, not two; forced MT11 stays.
pub fn next_status(prev: &VideoSourceStatus, probe_ok: bool, consecutive_failures: u32) -> VideoSourceStatus {
    let base = VideoSourceStatus {
        probe_ok,
        whep_path: WHEP_PATH.into(),
        ..prev.clone()
    };
    match prev.mode {
        VideoSourceMode::Mt11 => VideoSourceStatus {
            source: VideoSource::Mt11,
            scanning: false,
            ..base
        },
        VideoSourceMode::Auto if probe_ok => VideoSourceStatus {
            source: VideoSource::Mt11,
            scanning: false,
            ..base
        },
        VideoSourceMode::Auto
            if prev.source == VideoSource::Mt11 && consecutive_failures < FAIL_THRESHOLD =>
        {
            VideoSourceStatus {
                source: VideoSource::Mt11,
                scanning: false,
                ..base
            }
        }
        VideoSourceMode::Auto => VideoSourceStatus {
            source: VideoSource::None,
            scanning: true,
            ..base
        },
    }
}

pub struct SourceMonitor {
    mode: watch::Sender<VideoSourceMode>,
    task: JoinHandle<()>,
}

impl SourceMonitor {
    pub fn spawn(
        rtsp_url: String,
        mode: VideoSourceMode,
        probe: ProbeFn,
        timings: Timings,
    ) -> (Self, watch::Receiver<VideoSourceStatus>) {
        let (status_tx, status_rx) = watch::channel(initial_status(mode));
        let (mode_tx, mut mode_rx) = watch::channel(mode);
        let task = tokio::spawn(async move {
            let mut failures: u32 = 0;
            loop {
                let ok = probe(rtsp_url.clone()).await;
                failures = if ok { 0 } else { failures.saturating_add(1) };
                let prev = status_tx.borrow().clone();
                let prev = VideoSourceStatus {
                    mode: *mode_rx.borrow_and_update(),
                    ..prev
                };
                let next = next_status(&prev, ok, failures);
                status_tx.send_if_modified(|s| {
                    if *s == next {
                        false
                    } else {
                        *s = next;
                        true
                    }
                });
                let wait = if status_tx.borrow().source == VideoSource::None {
                    timings.rescan
                } else {
                    timings.check
                };
                tokio::select! {
                    _ = tokio::time::sleep(wait) => {}
                    _ = mode_rx.changed() => {}
                }
            }
        });
        (Self { mode: mode_tx, task }, status_rx)
    }

    pub fn set_mode(&self, mode: VideoSourceMode) {
        let _ = self.mode.send(mode);
    }

    pub fn stop(&self) {
        self.task.abort();
    }
}

impl Drop for SourceMonitor {
    fn drop(&mut self) {
        self.task.abort();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rgcs_core::{VideoSource, VideoSourceMode, VideoSourceStatus};

    fn auto(source: VideoSource) -> VideoSourceStatus {
        VideoSourceStatus {
            mode: VideoSourceMode::Auto,
            source,
            scanning: false,
            probe_ok: source == VideoSource::Mt11,
            whep_path: WHEP_PATH.into(),
        }
    }

    #[test]
    fn auto_switches_to_none_after_two_failures_and_back_on_success() {
        let live = auto(VideoSource::Mt11);
        let after_one = next_status(&live, false, 1);
        assert_eq!(
            after_one.source,
            VideoSource::Mt11,
            "one slow DESCRIBE does not tear down"
        );
        assert!(!after_one.probe_ok);
        let after_two = next_status(&after_one, false, 2);
        assert_eq!(after_two.source, VideoSource::None);
        assert!(after_two.scanning);
        let back = next_status(&after_two, true, 0);
        assert_eq!(back.source, VideoSource::Mt11);
        assert!(!back.scanning && back.probe_ok);
        assert_eq!(back.whep_path, "mt11");
    }

    #[test]
    fn forced_mt11_stays_mt11() {
        let forced = VideoSourceStatus {
            mode: VideoSourceMode::Mt11,
            ..auto(VideoSource::Mt11)
        };
        let s = next_status(&forced, false, 5);
        assert_eq!(s.source, VideoSource::Mt11);
        assert!(!s.probe_ok);
        assert!(!s.scanning);
    }

    async fn wait_for(
        rx: &mut watch::Receiver<VideoSourceStatus>,
        pred: impl Fn(&VideoSourceStatus) -> bool,
    ) {
        tokio::time::timeout(std::time::Duration::from_secs(2), async {
            loop {
                if pred(&rx.borrow()) {
                    return;
                }
                rx.changed().await.unwrap();
            }
        })
        .await
        .expect("status predicate within 2 s");
    }

    #[tokio::test]
    async fn monitor_publishes_status_from_the_probe() {
        let (monitor, mut rx) = SourceMonitor::spawn(
            "rtsp://127.0.0.1:1/video1".into(),
            VideoSourceMode::Auto,
            std::sync::Arc::new(|_url: String| Box::pin(async { false })),
            Timings {
                check: std::time::Duration::from_millis(20),
                rescan: std::time::Duration::from_millis(20),
                timeout: std::time::Duration::from_millis(20),
            },
        );
        wait_for(&mut rx, |s| s.source == VideoSource::None && s.scanning).await;
        monitor.set_mode(VideoSourceMode::Mt11);
        wait_for(&mut rx, |s| {
            s.mode == VideoSourceMode::Mt11 && s.source == VideoSource::Mt11 && !s.scanning
        })
        .await;
        monitor.stop();
    }
}
