//! `MissionHub`: routes Mission Protocol frames from the link to the running transaction,
//! serialises one transaction per vehicle, turns `MISSION_CURRENT` into `mission_progress`
//! frames and remembers the mission each vehicle is known to carry.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex as StdMutex};
use std::time::{Duration, Instant};

use mavlink::dialects::ardupilotmega::MavMissionType;
use rgcs_core::{Mission, MissionProgress, ServerMessage, SysId, TransferPhase, UploadReport, VehicleKind};

use crate::transfer::Reporter;
use rgcs_mavlink::{MissionFrame, Outgoing};
use rgcs_mission::{Done, Download, ProtocolError, Upload};
use tokio::sync::{broadcast, mpsc};

const FRAME_CAPACITY: usize = 256;
/// How often the transfer loops check their deadlines (a timeout lands up to one tick late).
pub const TICK: Duration = Duration::from_millis(250);
const RESEND_EVERY: Duration = Duration::from_secs(1);
const LAT_LON_EPS: f64 = 1e-7;
/// ArduPilot stores altitudes in centimetres.
const ALT_EPS: f32 = 0.011;

#[derive(Debug, thiserror::Error)]
pub enum MissionError {
    #[error("another mission transaction is running for this vehicle")]
    Busy,
    #[error("the vehicle did not answer in time")]
    Timeout,
    #[error("the vehicle rejected the mission: {0}")]
    Rejected(String),
    #[error("link is not running")]
    LinkClosed,
    #[error("{0}")]
    Invalid(String),
}

#[derive(Clone)]
pub struct MissionHub {
    frames: broadcast::Sender<(SysId, MissionFrame)>,
    busy: Arc<StdMutex<HashSet<SysId>>>,
    progress: Arc<StdMutex<HashMap<SysId, MissionProgress>>>,
    known: Arc<StdMutex<HashMap<SysId, Mission>>>,
    tx: broadcast::Sender<ServerMessage>,
    /// The RGCS SYSID transfers answer to (read when a transfer starts).
    gcs: rgcs_core::GcsId,
}

/// Releases the per-vehicle transaction slot however the transaction ends.
struct BusyGuard {
    busy: Arc<StdMutex<HashSet<SysId>>>,
    sysid: SysId,
}

impl Drop for BusyGuard {
    fn drop(&mut self) {
        if let Ok(mut b) = self.busy.lock() {
            b.remove(&self.sysid);
        }
    }
}

/// `got` is what ArduPilot reads back for `sent`: params as AP_Mission stores them
/// ([`rgcs_core::as_stored`]) or exactly as sent (a firmware that keeps more is not a mismatch),
/// positions within the storage resolution. Frames only matter for
/// items that carry a position: ArduPilot stores none for RTL / DO_* items and reads them back
/// as MAV_FRAME_GLOBAL.
fn items_match(
    sent: &rgcs_core::MissionItem,
    got: &rgcs_core::MissionItem,
    kind: Option<VehicleKind>,
) -> bool {
    close(sent, got) || rgcs_core::stored_forms(sent, kind).iter().any(|a| close(a, got))
}

fn close(a: &rgcs_core::MissionItem, b: &rgcs_core::MissionItem) -> bool {
    a.command == b.command
        && (!a.has_position() || a.frame == b.frame)
        && a.params == b.params
        && (a.lat - b.lat).abs() <= LAT_LON_EPS
        && (a.lon - b.lon).abs() <= LAT_LON_EPS
        && (a.alt - b.alt).abs() <= ALT_EPS
}

/// 1-based sequences where the read-back differs from what a `kind` vehicle stores (`None`:
/// either packing); length differences count every extra seq.
pub fn mismatches(sent: &Mission, got: &Mission, kind: Option<VehicleKind>) -> Vec<u16> {
    let n = sent.items.len().max(got.items.len());
    (0..n)
        .filter(|&i| match (sent.items.get(i), got.items.get(i)) {
            (Some(a), Some(b)) => !items_match(a, b, kind),
            _ => true,
        })
        .map(|i| (i + 1) as u16)
        .collect()
}

impl MissionHub {
    /// A mission transfer is in progress for some vehicle (the GCS SYSID must not change then).
    pub fn any_busy(&self) -> bool {
        !self.busy.lock().expect("busy mutex").is_empty()
    }

    pub fn new(tx: broadcast::Sender<ServerMessage>, gcs: rgcs_core::GcsId) -> Self {
        let (frames, _) = broadcast::channel(FRAME_CAPACITY);
        Self {
            frames,
            busy: Arc::default(),
            progress: Arc::default(),
            known: Arc::default(),
            tx,
            gcs,
        }
    }

    /// Called for every `RouterEvent::Mission`.
    pub fn on_frame(&self, sysid: SysId, frame: MissionFrame) {
        if let MissionFrame::Current(c) = &frame {
            self.on_current(sysid, c.seq, c.total);
        }
        let _ = self.frames.send((sysid, frame));
    }

    fn on_current(&self, sysid: SysId, seq: u16, wire_total: u16) {
        let known_total = self
            .known
            .lock()
            .ok()
            .and_then(|k| k.get(&sysid).map(|m| m.items.len() as u16));
        let total = known_total.or((wire_total > 0).then_some(wire_total));
        let next = MissionProgress { seq, total };
        let changed = match self.progress.lock() {
            Ok(mut p) => p.insert(sysid, next) != Some(next),
            Err(_) => false,
        };
        if changed {
            let _ = self.tx.send(ServerMessage::MissionProgress {
                sysid,
                progress: next,
            });
        }
    }

    pub fn progress(&self, sysid: SysId) -> Option<MissionProgress> {
        self.progress.lock().ok().and_then(|p| p.get(&sysid).copied())
    }

    pub fn known(&self, sysid: SysId) -> Option<Mission> {
        self.known.lock().ok().and_then(|k| k.get(&sysid).cloned())
    }

    /// Re-broadcasts every known progress once a second so late-joining clients catch up.
    pub async fn resend_loop(self) {
        let mut tick = tokio::time::interval(RESEND_EVERY);
        tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            tick.tick().await;
            let snapshot: Vec<(SysId, MissionProgress)> = self
                .progress
                .lock()
                .map(|p| p.iter().map(|(s, v)| (*s, *v)).collect())
                .unwrap_or_default();
            for (sysid, progress) in snapshot {
                let _ = self.tx.send(ServerMessage::MissionProgress { sysid, progress });
            }
        }
    }

    fn acquire(&self, sysid: SysId) -> Result<BusyGuard, MissionError> {
        let mut busy = self.busy.lock().map_err(|_| MissionError::Busy)?;
        if !busy.insert(sysid) {
            return Err(MissionError::Busy);
        }
        Ok(BusyGuard {
            busy: self.busy.clone(),
            sysid,
        })
    }

    /// Writes the mission, reads it back and compares with what ArduPilot stores for `kind`
    /// (`None`: either packing). Holds the vehicle's transaction slot.
    pub async fn upload(
        &self,
        sysid: SysId,
        component: u8,
        mission: &Mission,
        kind: Option<VehicleKind>,
        outgoing: &mpsc::Sender<Outgoing>,
    ) -> Result<UploadReport, MissionError> {
        let _guard = self.acquire(sysid)?;
        let mut rx = self.frames.subscribe();
        let started = Instant::now();
        let gcs = self.gcs.get();
        let (up, out) = Upload::start(sysid, component, mission, 0)
            .map_err(|e: ProtocolError| MissionError::Invalid(e.to_string()))?;
        let up = up.for_gcs(gcs);
        let total = mission.items.len() as u16 + 1;
        let report = Reporter::new(self.tx.clone(), sysid, total);
        report.send(TransferPhase::Write, 0);
        let written = async {
            send_all(outgoing, out).await?;
            run_upload(up, &mut rx, sysid, outgoing, started, &report).await?;
            report.send(TransferPhase::Verify, 0);
            let (dl, out) = Download::start(sysid, component, started.elapsed().as_millis() as u64);
            run_download(
                dl.for_gcs(gcs),
                out,
                sysid,
                &mut rx,
                outgoing,
                started,
                Some(&report),
            )
            .await
        }
        .await;
        let got = match written {
            Ok(got) => got,
            Err(e) => {
                report.send(TransferPhase::Failed, 0);
                return Err(e);
            }
        };
        report.send(TransferPhase::Done, total);
        let mismatched = mismatches(mission, &got, kind);
        let verified = mismatched.is_empty();
        if verified {
            self.remember(sysid, mission);
        }
        Ok(UploadReport {
            items: mission.items.len() as u32,
            verified,
            mismatched,
            findings: Vec::new(),
        })
    }

    /// Writes a fence or rally list (no home slot), reads it back and returns the read-back
    /// items with the 1-based positions that differ. Holds the vehicle's transaction slot.
    pub async fn write_list(
        &self,
        sysid: SysId,
        component: u8,
        items: Vec<rgcs_core::MissionItem>,
        mission_type: MavMissionType,
        outgoing: &mpsc::Sender<Outgoing>,
    ) -> Result<(Vec<rgcs_core::MissionItem>, Vec<u16>), MissionError> {
        let _guard = self.acquire(sysid)?;
        let mut rx = self.frames.subscribe();
        let started = Instant::now();
        let gcs = self.gcs.get();
        let sent = list_mission(items);
        let (up, out) = Upload::start_typed(sysid, component, &sent, mission_type, 0)
            .map_err(|e: ProtocolError| MissionError::Invalid(e.to_string()))?;
        send_all(outgoing, out).await?;
        let quiet = Reporter::new(broadcast::channel(1).0, sysid, 0);
        run_upload(up.for_gcs(gcs), &mut rx, sysid, outgoing, started, &quiet).await?;
        let (dl, out) = Download::start_typed(
            sysid,
            component,
            mission_type,
            started.elapsed().as_millis() as u64,
        );
        let got = run_download(dl.for_gcs(gcs), out, sysid, &mut rx, outgoing, started, None).await?;
        // Fence and rally items are not AP_Mission commands: compared as sent.
        let mismatched = mismatches(&sent, &got, None);
        Ok((got.items, mismatched))
    }

    /// Reads a fence or rally list. Holds the vehicle's transaction slot.
    pub async fn read_list(
        &self,
        sysid: SysId,
        component: u8,
        mission_type: MavMissionType,
        outgoing: &mpsc::Sender<Outgoing>,
    ) -> Result<Vec<rgcs_core::MissionItem>, MissionError> {
        let _guard = self.acquire(sysid)?;
        let mut rx = self.frames.subscribe();
        let (dl, out) = Download::start_typed(sysid, component, mission_type, 0);
        let got = run_download(
            dl.for_gcs(self.gcs.get()),
            out,
            sysid,
            &mut rx,
            outgoing,
            Instant::now(),
            None,
        )
        .await?;
        Ok(got.items)
    }

    /// Reads the vehicle's mission. Holds the vehicle's transaction slot.
    pub async fn download(
        &self,
        sysid: SysId,
        component: u8,
        outgoing: &mpsc::Sender<Outgoing>,
    ) -> Result<Mission, MissionError> {
        let _guard = self.acquire(sysid)?;
        let mut rx = self.frames.subscribe();
        let (dl, out) = Download::start(sysid, component, 0);
        let got = run_download(
            dl.for_gcs(self.gcs.get()),
            out,
            sysid,
            &mut rx,
            outgoing,
            Instant::now(),
            None,
        )
        .await?;
        self.remember(sysid, &got);
        Ok(Mission {
            sysid: Some(sysid),
            ..got
        })
    }

    fn remember(&self, sysid: SysId, mission: &Mission) {
        if let Ok(mut k) = self.known.lock() {
            k.insert(
                sysid,
                Mission {
                    sysid: Some(sysid),
                    ..mission.clone()
                },
            );
        }
    }
}

/// A bare carrier for a fence / rally list (the protocol moves `Mission`s).
fn list_mission(items: Vec<rgcs_core::MissionItem>) -> Mission {
    Mission {
        id: None,
        name: String::new(),
        sysid: None,
        default_alt: 0.0,
        default_frame: rgcs_core::MissionFrame::Rel,
        speed: 0.0,
        home: None,
        items,
        fence: Vec::new(),
        rally: Vec::new(),
        surveys: Vec::new(),
    }
}

async fn send_all(
    outgoing: &mpsc::Sender<Outgoing>,
    msgs: Vec<mavlink::dialects::ardupilotmega::MavMessage>,
) -> Result<(), MissionError> {
    for message in msgs {
        outgoing
            .send(Outgoing { message })
            .await
            .map_err(|_| MissionError::LinkClosed)?;
    }
    Ok(())
}

fn done_to_error(done: Done) -> MissionError {
    match done {
        Done::Ok => unreachable!("Ok is handled by the caller"),
        Done::Timeout => MissionError::Timeout,
        Done::Rejected(r) => MissionError::Rejected(format!("{r:?}")),
    }
}

async fn run_upload(
    mut up: Upload,
    rx: &mut broadcast::Receiver<(SysId, MissionFrame)>,
    sysid: SysId,
    outgoing: &mpsc::Sender<Outgoing>,
    started: Instant,
    report: &Reporter,
) -> Result<(), MissionError> {
    let mut tick = tokio::time::interval(TICK);
    loop {
        let (next, out, done) = tokio::select! {
            frame = rx.recv() => match frame {
                Ok((s, frame)) if s == sysid => {
                    report.on_write_frame(&frame);
                    up.on_message(&frame.into_message(), started.elapsed().as_millis() as u64)
                }
                Ok(_) | Err(broadcast::error::RecvError::Lagged(_)) => (up, Vec::new(), None),
                Err(broadcast::error::RecvError::Closed) => return Err(MissionError::LinkClosed),
            },
            _ = tick.tick() => up.on_tick(started.elapsed().as_millis() as u64),
        };
        up = next;
        send_all(outgoing, out).await?;
        match done {
            Some(Done::Ok) => return Ok(()),
            Some(other) => return Err(done_to_error(other)),
            None => {}
        }
    }
}

async fn run_download(
    mut dl: Download,
    out: Vec<mavlink::dialects::ardupilotmega::MavMessage>,
    sysid: SysId,
    rx: &mut broadcast::Receiver<(SysId, MissionFrame)>,
    outgoing: &mpsc::Sender<Outgoing>,
    started: Instant,
    report: Option<&Reporter>,
) -> Result<Mission, MissionError> {
    send_all(outgoing, out).await?;
    let mut tick = tokio::time::interval(TICK);
    loop {
        let (next, out, result) = tokio::select! {
            frame = rx.recv() => match frame {
                Ok((s, frame)) if s == sysid => {
                    if let Some(r) = report {
                        r.on_read_frame(&frame);
                    }
                    dl.on_message(&frame.into_message(), started.elapsed().as_millis() as u64)
                }
                Ok(_) | Err(broadcast::error::RecvError::Lagged(_)) => (dl, Vec::new(), None),
                Err(broadcast::error::RecvError::Closed) => return Err(MissionError::LinkClosed),
            },
            _ = tick.tick() => dl.on_tick(started.elapsed().as_millis() as u64),
        };
        dl = next;
        send_all(outgoing, out).await?;
        match result {
            Some(Ok(mission)) => return Ok(mission),
            Some(Err(done)) => return Err(done_to_error(done)),
            None => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rgcs_core::demo20;

    #[test]
    fn frame_of_non_positional_items_is_not_compared() {
        // ArduPilot stores no frame for RTL / DO_* items and reads them back as MAV_FRAME_GLOBAL.
        let a = demo20();
        let mut b = a.clone();
        b.items[19].frame = rgcs_core::MissionFrame::Abs;
        assert!(
            mismatches(&a, &b, None).is_empty(),
            "{:?}",
            mismatches(&a, &b, None)
        );
        b.items[1].frame = rgcs_core::MissionFrame::Abs;
        assert_eq!(
            mismatches(&a, &b, None),
            vec![2],
            "positional items still compare the frame"
        );
    }

    #[test]
    fn centimetre_altitude_rounding_is_not_a_mismatch() {
        let mut a = demo20();
        a.items[2].alt = 30.123;
        let mut b = a.clone();
        b.items[2].alt = 30.12;
        assert!(mismatches(&a, &b, None).is_empty());
        b.items[2].alt = 30.2;
        assert_eq!(mismatches(&a, &b, None), vec![3]);
    }

    #[test]
    fn mismatches_report_changed_and_missing_sequences() {
        let a = demo20();
        let mut b = a.clone();
        b.items[2].alt += 1.0;
        b.items.truncate(19);
        assert_eq!(mismatches(&a, &b, None), vec![3, 20]);
        assert!(mismatches(&a, &a, None).is_empty());
    }

    use rgcs_core::{MissionFrame, MissionItem};

    /// (command, rel frame, params, lat, lon, alt).
    type Row = (u16, bool, [f32; 4], f64, f64, f32);

    /// Saved plan 12 (QuadPlane, absolute altitudes).
    #[rustfmt::skip]
    const PLAN_12: &[Row] = &[
        (84, true, [0.0, 0.0, 0.0, 0.0], 0.0, 0.0, 30.0),
        (16, false, [0.0, 0.0, 0.0, 0.0], 33.669_836_3, 135.901_157_8, 210.0),
        (16, false, [0.0, 0.0, 0.0, 0.0], 33.671_604_2, 135.898_497_1, 230.0),
        (16, false, [0.0, 0.0, 0.0, 0.0], 33.670_336_3, 135.898_239_6, 240.0),
        (16, false, [0.0, 0.0, 0.0, 0.0], 33.669_639_8, 135.900_943_3, 220.0),
        (16, false, [0.0, 0.0, 0.0, 0.0], 33.665_371_6, 135.907_498_6, 184.0),
        (16, false, [0.0, 0.0, 0.0, 0.0], 33.665_621_7, 135.909_075_7, 161.0),
        (16, false, [0.0, 5.0, 0.0, 0.0], 33.666_746_8, 135.909_762_4, 204.0),
        (16, false, [0.0, 5.0, 0.0, 0.0], 33.668_675_5, 135.907_595_2, 185.0),
        (16, false, [0.0, 5.0, 0.0, 0.0], 33.670_086_3, 135.904_870_0, 196.0),
        (16, false, [0.0, 0.0, 0.0, 0.0], 33.671_068_5, 135.903_067_6, 219.0),
        (16, false, [0.0, 5.0, 0.0, 0.0], 33.673_023_9, 135.899_044_3, 210.0),
        (16, false, [0.0, 5.0, 0.0, 0.0], 33.670_854_2, 135.898_325_4, 218.0),
        (16, false, [0.0, 5.0, 0.0, 0.0], 33.667_675_4, 135.903_303_6, 201.0),
        (16, false, [0.0, 5.0, 0.0, 0.0], 33.663_746_5, 135.908_196_0, 185.0),
        (16, false, [0.0, 5.0, 0.0, 0.0], 33.661_389_0, 135.909_740_9, 181.0),
        (16, false, [0.0, 0.0, 0.0, 0.0], 33.659_906_6, 135.911_618_5, 182.0),
        (16, false, [0.0, 0.0, 0.0, 0.0], 33.656_209_5, 135.913_828_6, 135.0),
        (16, false, [0.0, 0.0, 0.0, 0.0], 33.654_932_4, 135.914_257_8, 129.0),
        (16, false, [0.0, 0.0, 0.0, 0.0], 33.652_851_6, 135.916_800_5, 120.0),
        (16, false, [0.0, 0.0, 0.0, 0.0], 33.651_637_0, 135.920_276_6, 120.0),
        (16, false, [0.0, 0.0, 0.0, 0.0], 33.651_226_2, 135.922_401_0, 150.0),
        (16, false, [0.0, 0.0, 0.0, 0.0], 33.651_404_8, 135.924_353_6, 180.0),
        (16, false, [0.0, 0.0, 0.0, 0.0], 33.650_261_6, 135.924_375_1, 180.0),
        (16, false, [0.0, 0.0, 0.0, 0.0], 33.651_244_0, 135.922_401_0, 130.0),
        (16, false, [0.0, 0.0, 0.0, 0.0], 33.651_565_4, 135.920_319_6, 122.0),
        (16, false, [0.0, 0.0, 0.0, 0.0], 33.652_923_0, 135.916_800_5, 134.0),
        (16, false, [0.0, 0.0, 0.0, 0.0], 33.654_834_2, 135.914_257_8, 128.0),
        (16, false, [0.0, 0.0, 0.0, 0.0], 33.654_066_2, 135.911_393_2, 153.0),
        (16, false, [0.0, 0.0, 0.0, 0.0], 33.652_637_2, 135.910_234_5, 181.0),
        (16, false, [0.0, 5.0, 0.0, 0.0], 33.653_117_0, 135.906_822_0, 208.0),
        (16, false, [0.0, 5.0, 0.0, 0.0], 33.654_486_0, 135.899_886_0, 307.0),
        (31, false, [100.0, 0.0, 0.0, 0.0], 33.654_486_0, 135.899_886_0, 560.0),
        (16, false, [0.0, 0.0, 0.0, 0.0], 33.654_485_9, 135.897_907_0, 560.0),
        (16, false, [0.0, 0.0, 0.0, 0.0], 33.655_557_6, 135.896_394_3, 560.0),
        (18, false, [1.0, 0.0, 100.0, 0.0], 33.657_459_7, 135.893_626_2, 560.0),
        (16, false, [0.0, 0.0, 0.0, 0.0], 33.655_566_5, 135.896_394_3, 560.0),
        (16, false, [0.0, 0.0, 0.0, 0.0], 33.654_468_0, 135.897_896_3, 560.0),
        (31, false, [100.0, 0.0, 0.0, 0.0], 33.654_530_6, 135.899_848_9, 307.0),
        (16, false, [0.0, 0.0, 0.0, 0.0], 33.662_282_0, 135.905_342_1, 233.0),
        (16, false, [0.0, 0.0, 0.0, 0.0], 33.664_353_7, 135.907_788_3, 198.0),
        (16, true, [0.0, 0.0, 0.0, 0.0], 33.666_210_9, 135.905_771_3, 30.0),
        (85, true, [0.0, 0.0, 0.0, 0.0], 33.668_202_3, 135.904_130_0, 0.0),
    ];

    fn plan_12() -> Mission {
        let items = PLAN_12
            .iter()
            .map(|&(command, rel, params, lat, lon, alt)| MissionItem {
                command,
                frame: if rel { MissionFrame::Rel } else { MissionFrame::Abs },
                params,
                lat,
                lon,
                alt,
                autocontinue: true,
            })
            .collect();
        Mission { items, ..demo20() }
    }

    #[test]
    fn plan_12_read_back_from_arduplane_is_verified() {
        // ArduPlane stores LOITER_TO_ALT's radius from param2 and drops param1 (seq 33 and 39)
        let sent = plan_12();
        let mut got = sent.clone();
        got.items[32].params = [0.0; 4];
        got.items[38].params = [0.0; 4];
        assert_eq!(sent.items[32].params[0], 100.0);
        assert!(
            mismatches(&sent, &got, Some(VehicleKind::Plane)).is_empty(),
            "{:?}",
            mismatches(&sent, &got, Some(VehicleKind::Plane))
        );
        assert!(mismatches(&sent, &got, None).is_empty());
    }

    #[test]
    fn a_real_difference_is_still_a_mismatch() {
        let sent = plan_12();
        let mut got = sent.clone();
        assert!(
            mismatches(&sent, &got, Some(VehicleKind::Plane)).is_empty(),
            "an exact echo"
        );
        got.items[38].params = [0.0; 4]; // what ArduPlane stores
        got.items[32].params = [0.0, 80.0, 0.0, 0.0]; // a radius nobody sent
        got.items[35].params[2] = -100.0; // loiter direction flipped
        got.items[7].params[1] = 0.0; // acceptance radius lost
        got.items[9].alt += 1.0;
        assert_eq!(
            mismatches(&sent, &got, Some(VehicleKind::Plane)),
            vec![8, 10, 33, 36]
        );
    }

    #[test]
    fn float32_params_compare_equal_after_the_wire() {
        // JSON numbers become f32 once (the MISSION_ITEM_INT param type): no further rounding
        let mut sent = demo20();
        sent.items.insert(1, item_from_json(r#"[1, 8.3, 33.333333, 0]"#));
        let got = sent.clone();
        assert!(mismatches(&sent, &got, Some(VehicleKind::Copter)).is_empty());
        let mut off = got.clone();
        off.items[1].params[1] = f32::from_bits(8.3f32.to_bits() + 1);
        assert_eq!(mismatches(&sent, &off, Some(VehicleKind::Copter)), vec![2]);
    }

    fn item_from_json(params: &str) -> MissionItem {
        serde_json::from_str(&format!(
            r#"{{"command":178,"frame":"rel","params":{params},"lat":0,"lon":0,"alt":0,"autocontinue":true}}"#
        ))
        .unwrap()
    }
}
