//! One source monitor per vehicle with a camera; status changes are broadcast as `video_source`.

use std::collections::HashMap;
use std::sync::Arc;

use rgcs_core::{
    CameraKind, CameraProfile, ServerMessage, SysId, VideoSourceEntry, VideoSourceMode, VideoSourceStatus,
};
use rgcs_store::Store;
use rgcs_video::{initial_status, probe_rtsp, ProbeFn, SourceMonitor, Timings};
use tokio::sync::{broadcast, watch, Mutex};
use tokio::task::JoinHandle;

enum Entry {
    /// No camera configured: a fixed status.
    Static(VideoSourceStatus),
    Live {
        monitor: SourceMonitor,
        status: watch::Receiver<VideoSourceStatus>,
        forwarder: JoinHandle<()>,
    },
}

#[derive(Clone)]
pub struct VideoHub {
    store: Store,
    tx: broadcast::Sender<ServerMessage>,
    timings: Timings,
    entries: Arc<Mutex<HashMap<SysId, Entry>>>,
}

impl VideoHub {
    pub fn new(store: Store, tx: broadcast::Sender<ServerMessage>, timings: Timings) -> Self {
        Self {
            store,
            tx,
            timings,
            entries: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    async fn profile(&self, sysid: SysId) -> CameraProfile {
        self.store
            .camera_profile(sysid)
            .await
            .unwrap_or_else(|_| CameraProfile::default_for(sysid))
    }

    fn probe_fn(&self) -> ProbeFn {
        let timeout = self.timings.timeout;
        Arc::new(move |url: String| Box::pin(async move { probe_rtsp(&url, timeout).await }))
    }

    async fn install(&self, profile: &CameraProfile) -> VideoSourceStatus {
        let sysid = profile.sysid;
        let entry = if profile.kind == CameraKind::None {
            Entry::Static(VideoSourceStatus {
                scanning: false,
                ..initial_status(profile.video_source_mode)
            })
        } else {
            let (monitor, status) = SourceMonitor::spawn(
                profile.rtsp_url_resolved(),
                profile.video_source_mode,
                self.probe_fn(),
                self.timings,
            );
            let forwarder = tokio::spawn(forward(sysid, status.clone(), self.tx.clone()));
            Entry::Live {
                monitor,
                status,
                forwarder,
            }
        };
        let current = match &entry {
            Entry::Static(s) => s.clone(),
            Entry::Live { status, .. } => status.borrow().clone(),
        };
        let mut entries = self.entries.lock().await;
        if let Some(Entry::Live {
            monitor, forwarder, ..
        }) = entries.insert(sysid, entry)
        {
            monitor.stop();
            forwarder.abort();
        }
        current
    }

    /// Every known source status (for the WebSocket snapshot).
    pub async fn snapshot(&self) -> Vec<VideoSourceEntry> {
        let entries = self.entries.lock().await;
        let mut out: Vec<VideoSourceEntry> = entries
            .iter()
            .map(|(sysid, e)| VideoSourceEntry {
                sysid: *sysid,
                status: match e {
                    Entry::Static(s) => s.clone(),
                    Entry::Live { status, .. } => status.borrow().clone(),
                },
            })
            .collect();
        out.sort_by_key(|e| e.sysid);
        out
    }

    pub async fn status(&self, sysid: SysId) -> VideoSourceStatus {
        if let Some(e) = self.entries.lock().await.get(&sysid) {
            return match e {
                Entry::Static(s) => s.clone(),
                Entry::Live { status, .. } => status.borrow().clone(),
            };
        }
        let profile = self.profile(sysid).await;
        self.install(&profile).await
    }

    pub async fn reload(&self, sysid: SysId) {
        let profile = self.profile(sysid).await;
        self.install(&profile).await;
    }

    /// Persists the mode in the profile and applies it to the running monitor.
    pub async fn set_mode(
        &self,
        sysid: SysId,
        mode: VideoSourceMode,
    ) -> Result<VideoSourceStatus, rgcs_store::StoreError> {
        let profile = CameraProfile {
            video_source_mode: mode,
            ..self.profile(sysid).await
        };
        self.store.put_camera_profile(&profile).await?;
        let mut entries = self.entries.lock().await;
        match entries.get_mut(&sysid) {
            Some(Entry::Static(s)) => {
                *s = VideoSourceStatus {
                    scanning: false,
                    ..initial_status(mode)
                };
                Ok(s.clone())
            }
            Some(Entry::Live { monitor, status, .. }) => {
                monitor.set_mode(mode);
                Ok(VideoSourceStatus {
                    mode,
                    ..status.borrow().clone()
                })
            }
            None => {
                drop(entries);
                Ok(self.install(&profile).await)
            }
        }
    }
}

async fn forward(
    sysid: SysId,
    mut rx: watch::Receiver<VideoSourceStatus>,
    tx: broadcast::Sender<ServerMessage>,
) {
    while rx.changed().await.is_ok() {
        let status = rx.borrow_and_update().clone();
        let _ = tx.send(ServerMessage::VideoSource { sysid, status });
    }
}
