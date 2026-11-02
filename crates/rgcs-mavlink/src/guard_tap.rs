//! Guard telemetry tap: turns the messages the AI guard needs (`GLOBAL_POSITION_INT`,
//! `EKF_STATUS_REPORT`, `RC_CHANNELS`, `WIND`, `MISSION_CURRENT`, `EXTENDED_SYS_STATE`) into
//! small [`GuardFrame`]s. The link publishes them on a lossy `broadcast` channel
//! (`LinkChannels.guard`), so a slow guard drops frames instead of stalling the link.

use mavlink::dialects::ardupilotmega::{MavMessage, RC_CHANNELS_DATA};
use mavlink::MavHeader;
use rgcs_core::SysId;

/// Capacity of the guard broadcast channel (`LinkChannels.guard`).
pub const GUARD_CAPACITY: usize = 512;

/// One guard-relevant sample, with the system and component that sent it.
#[derive(Debug, Clone, PartialEq)]
pub struct GuardFrame {
    pub sysid: SysId,
    pub compid: u8,
    pub body: GuardBody,
}

#[derive(Debug, Clone, PartialEq)]
pub enum GuardBody {
    /// Degrees, m/s north / east, heading in degrees (`None` when unknown).
    Position {
        lat: f64,
        lon: f64,
        vn: f32,
        ve: f32,
        hdg: Option<f32>,
    },
    /// EKF variances and the `EKF_STATUS_FLAGS` bits.
    Ekf {
        compass_var: f32,
        pos_horiz_var: f32,
        vel_var: f32,
        flags: u16,
    },
    /// The first `chancount` raw channels (µs) and the receiver RSSI.
    Rc {
        chans: Vec<u16>,
        rssi: u8,
    },
    /// Wind direction (degrees, from) and speed (m/s) as estimated by ArduPilot.
    Wind {
        dir_deg: f32,
        speed: f32,
    },
    MissionSeq(u16),
    /// `MAV_VTOL_STATE` value.
    VtolState(u8),
}

/// `Some` only for the guard's messages, from any system / component.
pub fn tap(header: &MavHeader, msg: &MavMessage) -> Option<GuardFrame> {
    body_of(msg).map(|body| GuardFrame {
        sysid: header.system_id,
        compid: header.component_id,
        body,
    })
}

fn body_of(msg: &MavMessage) -> Option<GuardBody> {
    match msg {
        MavMessage::GLOBAL_POSITION_INT(p) => Some(GuardBody::Position {
            lat: f64::from(p.lat) / 1e7,
            lon: f64::from(p.lon) / 1e7,
            vn: f32::from(p.vx) / 100.0,
            ve: f32::from(p.vy) / 100.0,
            hdg: (p.hdg != u16::MAX).then(|| f32::from(p.hdg) / 100.0),
        }),
        MavMessage::EKF_STATUS_REPORT(e) => Some(GuardBody::Ekf {
            compass_var: e.compass_variance,
            pos_horiz_var: e.pos_horiz_variance,
            vel_var: e.velocity_variance,
            flags: e.flags.bits(),
        }),
        MavMessage::RC_CHANNELS(rc) => Some(rc_body(rc)),
        MavMessage::WIND(w) => Some(GuardBody::Wind {
            dir_deg: w.direction,
            speed: w.speed,
        }),
        MavMessage::MISSION_CURRENT(m) => Some(GuardBody::MissionSeq(m.seq)),
        MavMessage::EXTENDED_SYS_STATE(x) => Some(GuardBody::VtolState(x.vtol_state as u8)),
        _ => None,
    }
}

fn rc_body(rc: &RC_CHANNELS_DATA) -> GuardBody {
    let all = [
        rc.chan1_raw,
        rc.chan2_raw,
        rc.chan3_raw,
        rc.chan4_raw,
        rc.chan5_raw,
        rc.chan6_raw,
        rc.chan7_raw,
        rc.chan8_raw,
        rc.chan9_raw,
        rc.chan10_raw,
        rc.chan11_raw,
        rc.chan12_raw,
        rc.chan13_raw,
        rc.chan14_raw,
        rc.chan15_raw,
        rc.chan16_raw,
        rc.chan17_raw,
        rc.chan18_raw,
    ];
    let count = usize::from(rc.chancount).min(all.len());
    GuardBody::Rc {
        chans: all[..count].to_vec(),
        rssi: rc.rssi,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use mavlink::dialects::ardupilotmega::{
        EkfStatusFlags, MavVtolState, EKF_STATUS_REPORT_DATA, EXTENDED_SYS_STATE_DATA,
        GLOBAL_POSITION_INT_DATA, MISSION_CURRENT_DATA, SYSTEM_TIME_DATA, WIND_DATA,
    };

    fn header() -> MavHeader {
        MavHeader {
            system_id: 3,
            component_id: 1,
            sequence: 0,
        }
    }

    fn body(msg: MavMessage) -> Option<GuardBody> {
        tap(&header(), &msg).map(|f| {
            assert_eq!((f.sysid, f.compid), (3, 1));
            f.body
        })
    }

    #[test]
    fn global_position_int_becomes_a_position() {
        let msg = MavMessage::GLOBAL_POSITION_INT(GLOBAL_POSITION_INT_DATA {
            lat: 362_509_000,
            lon: 1_376_385_000,
            vx: 150,
            vy: -200,
            hdg: 9000,
            ..GLOBAL_POSITION_INT_DATA::DEFAULT
        });
        assert_eq!(
            body(msg),
            Some(GuardBody::Position {
                lat: 36.2509,
                lon: 137.6385,
                vn: 1.5,
                ve: -2.0,
                hdg: Some(90.0)
            })
        );
    }

    #[test]
    fn unknown_heading_is_none() {
        let msg = MavMessage::GLOBAL_POSITION_INT(GLOBAL_POSITION_INT_DATA {
            hdg: u16::MAX,
            ..GLOBAL_POSITION_INT_DATA::DEFAULT
        });
        assert!(matches!(body(msg), Some(GuardBody::Position { hdg: None, .. })));
    }

    #[test]
    fn ekf_status_report_carries_the_compass_variance() {
        let flags = EkfStatusFlags::EKF_ATTITUDE | EkfStatusFlags::EKF_POS_HORIZ_ABS;
        let msg = MavMessage::EKF_STATUS_REPORT(EKF_STATUS_REPORT_DATA {
            compass_variance: 0.62,
            pos_horiz_variance: 0.1,
            velocity_variance: 0.2,
            flags,
            ..EKF_STATUS_REPORT_DATA::DEFAULT
        });
        assert_eq!(
            body(msg),
            Some(GuardBody::Ekf {
                compass_var: 0.62,
                pos_horiz_var: 0.1,
                vel_var: 0.2,
                flags: 17
            })
        );
    }

    #[test]
    fn rc_channels_keep_chancount_channels() {
        let msg = MavMessage::RC_CHANNELS(RC_CHANNELS_DATA {
            chancount: 8,
            chan1_raw: 1500,
            chan3_raw: 1100,
            chan8_raw: 1900,
            chan9_raw: 1234,
            rssi: 200,
            ..RC_CHANNELS_DATA::DEFAULT
        });
        let Some(GuardBody::Rc { chans, rssi }) = body(msg) else {
            panic!("not an Rc body")
        };
        assert_eq!(chans.len(), 8);
        assert_eq!((chans[0], chans[2], chans[7], rssi), (1500, 1100, 1900, 200));
    }

    #[test]
    fn rc_chancount_is_capped_at_18() {
        let msg = MavMessage::RC_CHANNELS(RC_CHANNELS_DATA {
            chancount: 40,
            ..RC_CHANNELS_DATA::DEFAULT
        });
        assert!(matches!(body(msg), Some(GuardBody::Rc { chans, .. }) if chans.len() == 18));
    }

    #[test]
    fn wind_mission_current_and_vtol_state() {
        let wind = MavMessage::WIND(WIND_DATA {
            direction: 270.0,
            speed: 4.0,
            ..WIND_DATA::DEFAULT
        });
        assert_eq!(
            body(wind),
            Some(GuardBody::Wind {
                dir_deg: 270.0,
                speed: 4.0
            })
        );
        let seq = MavMessage::MISSION_CURRENT(MISSION_CURRENT_DATA {
            seq: 4,
            ..MISSION_CURRENT_DATA::DEFAULT
        });
        assert_eq!(body(seq), Some(GuardBody::MissionSeq(4)));
        let ext = MavMessage::EXTENDED_SYS_STATE(EXTENDED_SYS_STATE_DATA {
            vtol_state: MavVtolState::MAV_VTOL_STATE_MC,
            ..EXTENDED_SYS_STATE_DATA::DEFAULT
        });
        assert_eq!(body(ext), Some(GuardBody::VtolState(3)));
    }

    #[test]
    fn other_messages_are_not_tapped() {
        assert_eq!(body(MavMessage::SYSTEM_TIME(SYSTEM_TIME_DATA::DEFAULT)), None);
    }
}
