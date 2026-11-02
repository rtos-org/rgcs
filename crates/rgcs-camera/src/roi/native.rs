//! GPS ROI, Native: the gimbal manager holds the target itself, so the state
//! machine only decides when to (re)send `DO_SET_ROI_LOCATION` and `DO_SET_ROI_NONE`.

use rgcs_core::{GimbalAttitude, RoiStatus, RoiTarget};

use super::controller::{codes, VehicleFix, MAX_POSITION_AGE_MS};
use super::geo::{look_angles, to_gimbal_angles, GeoPos, LookAngles};

pub const NATIVE_RESEND_MS: u64 = 5_000;

#[derive(Debug, Clone, PartialEq)]
pub enum NativeOut {
    Point { lat: f64, lon: f64, alt_msl: f64 },
    Release,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct NativeRoi {
    target: Option<RoiTarget>,
    last_sent_ms: Option<u64>,
    error: Option<&'static str>,
}

impl NativeRoi {
    /// Activates `target` (or switches to it) and points the gimbal manager at it.
    pub fn start(&self, target: RoiTarget, now_ms: u64) -> (Self, Vec<NativeOut>) {
        let next = Self {
            target: Some(target),
            last_sent_ms: None,
            error: None,
        };
        next.resend(now_ms)
    }

    /// Releases the manager's target; nothing goes out when ROI was not active.
    pub fn stop(&self) -> (Self, Vec<NativeOut>) {
        match self.target {
            Some(_) => (Self::default(), vec![NativeOut::Release]),
            None => (self.clone(), Vec::new()),
        }
    }

    /// The active slot unset / removed releases; new coordinates are sent at once.
    pub fn retarget(&self, targets: &[RoiTarget], now_ms: u64) -> (Self, Vec<NativeOut>) {
        let Some(active) = &self.target else {
            return (self.clone(), Vec::new());
        };
        match targets.iter().find(|t| t.id == active.id) {
            Some(t) if t.is_set() && same_point(t, active) => {
                let next = Self {
                    target: Some(t.clone()),
                    ..self.clone()
                };
                (next, Vec::new())
            }
            Some(t) if t.is_set() => Self {
                target: Some(t.clone()),
                ..self.clone()
            }
            .resend(now_ms),
            _ => self.stop(),
        }
    }

    /// Re-asserts the location every `NATIVE_RESEND_MS` (an FC reboot or a mission
    /// `DO_SET_ROI` would otherwise win silently).
    pub fn tick(&self, now_ms: u64) -> (Self, Vec<NativeOut>) {
        let due = self
            .last_sent_ms
            .is_none_or(|last| now_ms.saturating_sub(last) >= NATIVE_RESEND_MS);
        if due {
            self.resend(now_ms)
        } else {
            (self.clone(), Vec::new())
        }
    }

    /// Points at the active target now (start, retarget, reconnect); nothing while idle.
    pub fn resend(&self, now_ms: u64) -> (Self, Vec<NativeOut>) {
        let Some(t) = &self.target else {
            return (self.clone(), Vec::new());
        };
        let out = NativeOut::Point {
            lat: t.lat,
            lon: t.lon,
            alt_msl: t.alt_msl,
        };
        let next = Self {
            last_sent_ms: Some(now_ms),
            ..self.clone()
        };
        (next, vec![out])
    }

    /// The outcome of the last `Point`: a refused or unacked location shows `send_failed`.
    pub fn sent(&self, ok: bool) -> Self {
        Self {
            error: (!ok).then_some(codes::SEND_FAILED),
            ..self.clone()
        }
    }

    pub fn is_active(&self) -> bool {
        self.target.is_some()
    }

    /// Display-only geometry (the manager aims by itself); empty while idle.
    pub fn status(&self, fix: Option<&VehicleFix>, gimbal: Option<&GimbalAttitude>) -> RoiStatus {
        let Some(t) = &self.target else {
            return RoiStatus::default();
        };
        let (look, geo_error) = look_from(t, fix);
        let cmd = look
            .zip(fix.and_then(|f| f.hdg))
            .map(|(l, hdg)| to_gimbal_angles(&l, hdg, 0.0));
        RoiStatus {
            active_target: Some(t.id.clone()),
            mode: None,
            bearing_deg: look.map(|l| l.bearing_deg),
            elevation_deg: look.map(|l| l.elevation_deg),
            distance_m: look.map(|l| l.distance_m),
            yaw_cmd_deg: cmd.map(|c| c.yaw_deg),
            pitch_cmd_deg: cmd.map(|c| c.pitch_deg),
            gimbal_yaw_deg: gimbal.map(|g| f64::from(g.yaw)),
            gimbal_pitch_deg: gimbal.map(|g| f64::from(g.pitch)),
            speed_yaw: None,
            speed_pitch: None,
            error: self.error.or(geo_error).map(str::to_owned),
        }
    }
}

/// Look angles from a fresh fix, else the reason there are none; heading only affects the
/// body-relative command.
fn look_from(t: &RoiTarget, fix: Option<&VehicleFix>) -> (Option<LookAngles>, Option<&'static str>) {
    let Some(f) = fix else {
        return (None, Some(codes::NO_POSITION));
    };
    if f.age_ms > MAX_POSITION_AGE_MS {
        return (None, Some(codes::POSITION_STALE));
    }
    let own = GeoPos {
        lat_deg: f.lat,
        lon_deg: f.lon,
        alt_m: f.alt_msl,
    };
    let target = GeoPos {
        lat_deg: t.lat,
        lon_deg: t.lon,
        alt_m: t.alt_msl,
    };
    let look = look_angles(&own, &target);
    (Some(look), f.hdg.is_none().then_some(codes::HEADING_UNKNOWN))
}

fn same_point(a: &RoiTarget, b: &RoiTarget) -> bool {
    a.lat == b.lat && a.lon == b.lon && a.alt_msl == b.alt_msl
}

#[cfg(test)]
#[path = "native_tests.rs"]
mod tests;
