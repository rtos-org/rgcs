//! Calibration traffic from the flight controller: accelerometer position
//! requests, compass calibration progress / reports and raw RC input.

use mavlink::dialects::ardupilotmega::{MavCmd, MavMessage, RC_CHANNELS_DATA};
use rgcs_core::CalibFrame;

pub fn calib_frame(msg: &MavMessage) -> Option<CalibFrame> {
    Some(match msg {
        MavMessage::COMMAND_LONG(c) if c.command == MavCmd::MAV_CMD_ACCELCAL_VEHICLE_POS => {
            CalibFrame::AccelPos(c.param1 as u32)
        }
        MavMessage::MAG_CAL_PROGRESS(p) => CalibFrame::MagProgress {
            id: p.compass_id,
            pct: p.completion_pct,
        },
        MavMessage::MAG_CAL_REPORT(r) => CalibFrame::MagReport {
            id: r.compass_id,
            status: num_traits::ToPrimitive::to_u8(&r.cal_status).unwrap_or(0),
            fitness: r.fitness,
        },
        MavMessage::RC_CHANNELS(rc) => CalibFrame::RcChannels(rc_values(rc)),
        _ => return None,
    })
}

fn rc_values(rc: &RC_CHANNELS_DATA) -> Vec<u16> {
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
    all[..usize::from(rc.chancount).min(all.len())].to_vec()
}

#[cfg(test)]
mod tests {
    use super::*;
    use mavlink::dialects::ardupilotmega::{
        MagCalStatus, MavCmd, COMMAND_LONG_DATA, MAG_CAL_PROGRESS_DATA, MAG_CAL_REPORT_DATA, RC_CHANNELS_DATA,
    };

    #[test]
    fn accelcal_position_requests_are_decoded_other_commands_are_not() {
        let ask = |command| {
            MavMessage::COMMAND_LONG(COMMAND_LONG_DATA {
                command,
                param1: 3.0,
                ..COMMAND_LONG_DATA::DEFAULT
            })
        };
        assert_eq!(
            calib_frame(&ask(MavCmd::MAV_CMD_ACCELCAL_VEHICLE_POS)),
            Some(CalibFrame::AccelPos(3))
        );
        assert_eq!(calib_frame(&ask(MavCmd::MAV_CMD_NAV_WAYPOINT)), None);
        let success = MavMessage::COMMAND_LONG(COMMAND_LONG_DATA {
            command: MavCmd::MAV_CMD_ACCELCAL_VEHICLE_POS,
            param1: 16_777_215.0,
            ..COMMAND_LONG_DATA::DEFAULT
        });
        assert_eq!(calib_frame(&success), Some(CalibFrame::AccelPos(16_777_215)));
    }

    #[test]
    fn compass_progress_and_reports_are_decoded() {
        let p = MavMessage::MAG_CAL_PROGRESS(MAG_CAL_PROGRESS_DATA {
            compass_id: 1,
            completion_pct: 42,
            ..MAG_CAL_PROGRESS_DATA::DEFAULT
        });
        assert_eq!(calib_frame(&p), Some(CalibFrame::MagProgress { id: 1, pct: 42 }));
        let r = MavMessage::MAG_CAL_REPORT(MAG_CAL_REPORT_DATA {
            compass_id: 0,
            cal_status: MagCalStatus::MAG_CAL_SUCCESS,
            fitness: 9.5,
            ..MAG_CAL_REPORT_DATA::DEFAULT
        });
        assert_eq!(
            calib_frame(&r),
            Some(CalibFrame::MagReport {
                id: 0,
                status: 4,
                fitness: 9.5
            })
        );
    }

    #[test]
    fn rc_channels_keep_only_the_reported_count() {
        let rc = MavMessage::RC_CHANNELS(RC_CHANNELS_DATA {
            chan1_raw: 1100,
            chan2_raw: 1500,
            chan3_raw: 1900,
            chan4_raw: 1234,
            chancount: 3,
            ..RC_CHANNELS_DATA::DEFAULT
        });
        assert_eq!(
            calib_frame(&rc),
            Some(CalibFrame::RcChannels(vec![1100, 1500, 1900]))
        );
    }
}
