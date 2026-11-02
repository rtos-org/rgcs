//! ArduPilot messages → [`VehicleState`] updates. Every function returns a new state.

use mavlink::dialects::ardupilotmega::{
    MavMessage, MavModeFlag, MavVtolState, PositionTargetTypemask, ATTITUDE_DATA, EXTENDED_SYS_STATE_DATA,
    GLOBAL_POSITION_INT_DATA, GPS_RAW_INT_DATA, HEARTBEAT_DATA, HOME_POSITION_DATA,
    NAV_CONTROLLER_OUTPUT_DATA, POSITION_TARGET_GLOBAL_INT_DATA, SYS_STATUS_DATA, VFR_HUD_DATA,
};
use rgcs_core::{Attitude, Battery, GeoPoint, Gps, NavInfo, VehicleKind, VehicleState};

use crate::modes::{is_vtol_type, mode_name, vehicle_kind};

const HDG_UNKNOWN: u16 = u16::MAX;
const U16_UNKNOWN: u16 = u16::MAX;

/// Apply one message; `None` when the message carries nothing the UI shows.
pub fn apply(state: &VehicleState, msg: &MavMessage) -> Option<VehicleState> {
    match msg {
        MavMessage::HEARTBEAT(d) => Some(apply_heartbeat(state, d)),
        MavMessage::GLOBAL_POSITION_INT(d) => Some(apply_global_position(state, d)),
        MavMessage::SYS_STATUS(d) => Some(apply_sys_status(state, d)),
        MavMessage::VFR_HUD(d) => Some(apply_vfr_hud(state, d)),
        MavMessage::GPS_RAW_INT(d) => Some(apply_gps_raw(state, d)),
        MavMessage::NAV_CONTROLLER_OUTPUT(d) => Some(apply_nav(state, d)),
        MavMessage::POSITION_TARGET_GLOBAL_INT(d) => Some(apply_position_target(state, d)),
        MavMessage::HOME_POSITION(d) => Some(apply_home(state, d)),
        MavMessage::ATTITUDE(d) => Some(apply_attitude(state, d)),
        MavMessage::EXTENDED_SYS_STATE(d) => Some(apply_extended_sys_state(state, d)),
        _ => None,
    }
}

/// Radians → degrees in 0.1° steps: finer changes would only resend the state at 10 Hz.
fn tenth_deg(rad: f32) -> f32 {
    (rad.to_degrees() * 10.0).round() / 10.0
}

pub fn apply_attitude(state: &VehicleState, a: &ATTITUDE_DATA) -> VehicleState {
    VehicleState {
        attitude: Some(Attitude {
            roll: tenth_deg(a.roll),
            pitch: tenth_deg(a.pitch),
        }),
        ..state.clone()
    }
}

/// A QuadPlane's HEARTBEAT says FIXED_WING; its vtol_state is the one place it shows.
/// ArduCopter reports MC as well: only a plane that hovers counts.
pub fn apply_extended_sys_state(state: &VehicleState, d: &EXTENDED_SYS_STATE_DATA) -> VehicleState {
    VehicleState {
        vtol: state.kind == VehicleKind::Plane && d.vtol_state != MavVtolState::MAV_VTOL_STATE_UNDEFINED,
        ..state.clone()
    }
}

pub fn apply_heartbeat(state: &VehicleState, hb: &HEARTBEAT_DATA) -> VehicleState {
    let kind = vehicle_kind(hb.mavtype);
    VehicleState {
        kind,
        vtol: kind == VehicleKind::Plane && (state.vtol || is_vtol_type(hb.mavtype)),
        mode: mode_name(kind, hb.custom_mode),
        armed: hb.base_mode.contains(MavModeFlag::MAV_MODE_FLAG_SAFETY_ARMED),
        ..state.clone()
    }
}

pub fn apply_global_position(state: &VehicleState, p: &GLOBAL_POSITION_INT_DATA) -> VehicleState {
    let hdg = (p.hdg != HDG_UNKNOWN).then(|| p.hdg as f32 / 100.0);
    VehicleState {
        lat: p.lat as f64 / 1e7,
        lon: p.lon as f64 / 1e7,
        alt_msl: p.alt as f32 / 1000.0,
        alt_rel: p.relative_alt as f32 / 1000.0,
        hdg,
        cog: course_over_ground(p.vx, p.vy),
        ..state.clone()
    }
}

/// Below this ground speed the velocity direction is noise.
const COG_MIN_MS: f32 = 0.5;

/// Degrees clockwise from north from the NED velocity (cm/s).
fn course_over_ground(vx: i16, vy: i16) -> Option<f32> {
    let (n, e) = (vx as f32 / 100.0, vy as f32 / 100.0);
    (n.hypot(e) >= COG_MIN_MS).then(|| e.atan2(n).to_degrees().rem_euclid(360.0))
}

pub fn apply_nav(state: &VehicleState, d: &NAV_CONTROLLER_OUTPUT_DATA) -> VehicleState {
    let nav = NavInfo {
        target_bearing: (d.target_bearing as f32).rem_euclid(360.0),
        wp_dist: u32::from(d.wp_dist),
    };
    VehicleState {
        nav: Some(nav),
        ..state.clone()
    }
}

pub fn apply_position_target(state: &VehicleState, d: &POSITION_TARGET_GLOBAL_INT_DATA) -> VehicleState {
    let ignored = PositionTargetTypemask::POSITION_TARGET_TYPEMASK_X_IGNORE
        | PositionTargetTypemask::POSITION_TARGET_TYPEMASK_Y_IGNORE;
    let valid = !d.type_mask.intersects(ignored) && !(d.lat_int == 0 && d.lon_int == 0);
    let target = valid.then(|| GeoPoint {
        lat: d.lat_int as f64 / 1e7,
        lon: d.lon_int as f64 / 1e7,
        alt: d.alt,
    });
    VehicleState {
        target,
        ..state.clone()
    }
}

pub fn apply_home(state: &VehicleState, d: &HOME_POSITION_DATA) -> VehicleState {
    let home = GeoPoint {
        lat: d.latitude as f64 / 1e7,
        lon: d.longitude as f64 / 1e7,
        alt: d.altitude as f32 / 1000.0,
    };
    VehicleState {
        home: Some(home),
        ..state.clone()
    }
}

pub fn apply_sys_status(state: &VehicleState, s: &SYS_STATUS_DATA) -> VehicleState {
    let pct = (s.battery_remaining >= 0).then_some(s.battery_remaining as u8);
    let volt = if s.voltage_battery == U16_UNKNOWN {
        state.battery.volt
    } else {
        s.voltage_battery as f32 / 1000.0
    };
    let current = (s.current_battery >= 0).then(|| s.current_battery as f32 / 100.0);
    VehicleState {
        battery: Battery { pct, volt, current },
        ..state.clone()
    }
}

pub fn apply_vfr_hud(state: &VehicleState, h: &VFR_HUD_DATA) -> VehicleState {
    VehicleState {
        ground_speed: h.groundspeed,
        climb: h.climb,
        ..state.clone()
    }
}

pub fn apply_gps_raw(state: &VehicleState, g: &GPS_RAW_INT_DATA) -> VehicleState {
    let hdop = (g.eph != U16_UNKNOWN).then(|| g.eph as f32 / 100.0);
    let fix = g.fix_type as u8;
    VehicleState {
        gps: Gps {
            fix,
            sats: g.satellites_visible,
            hdop,
        },
        ..state.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use mavlink::dialects::ardupilotmega::{
        GpsFixType, MavAutopilot, MavType, PositionTargetTypemask, HOME_POSITION_DATA,
        NAV_CONTROLLER_OUTPUT_DATA, POSITION_TARGET_GLOBAL_INT_DATA,
    };
    use rgcs_core::{GeoPoint, NavInfo};

    #[test]
    fn cog_from_velocity() {
        let gp = |vx: i16, vy: i16| GLOBAL_POSITION_INT_DATA {
            vx,
            vy,
            hdg: u16::MAX,
            ..GLOBAL_POSITION_INT_DATA::DEFAULT
        };
        assert_eq!(apply_global_position(&base(), &gp(300, 0)).cog, Some(0.0));
        assert_eq!(apply_global_position(&base(), &gp(0, 300)).cog, Some(90.0));
        assert_eq!(apply_global_position(&base(), &gp(-300, 0)).cog, Some(180.0));
        assert_eq!(apply_global_position(&base(), &gp(0, -300)).cog, Some(270.0));
        assert_eq!(
            apply_global_position(&base(), &gp(30, 20)).cog,
            None,
            "< 0.5 m/s: no course"
        );
    }

    #[test]
    fn nav_controller_output_sets_bearing_and_distance() {
        let msg = MavMessage::NAV_CONTROLLER_OUTPUT(NAV_CONTROLLER_OUTPUT_DATA {
            target_bearing: -45,
            wp_dist: 120,
            ..NAV_CONTROLLER_OUTPUT_DATA::DEFAULT
        });
        let s = apply(&base(), &msg).expect("applied");
        assert_eq!(
            s.nav,
            Some(NavInfo {
                target_bearing: 315.0,
                wp_dist: 120
            })
        );
    }

    #[test]
    fn position_target_ignored_when_position_masked_or_zero() {
        let pt = |lat_int: i32, lon_int: i32, type_mask: PositionTargetTypemask| {
            MavMessage::POSITION_TARGET_GLOBAL_INT(POSITION_TARGET_GLOBAL_INT_DATA {
                lat_int,
                lon_int,
                alt: 50.0,
                type_mask,
                ..POSITION_TARGET_GLOBAL_INT_DATA::DEFAULT
            })
        };
        let s = apply(
            &base(),
            &pt(354_818_830, 1_384_802_900, PositionTargetTypemask::empty()),
        )
        .unwrap();
        assert_eq!(
            s.target,
            Some(GeoPoint {
                lat: 35.481883,
                lon: 138.48029,
                alt: 50.0
            })
        );
        let masked = apply(
            &s,
            &pt(
                354_818_830,
                1_384_802_900,
                PositionTargetTypemask::POSITION_TARGET_TYPEMASK_X_IGNORE,
            ),
        )
        .unwrap();
        assert_eq!(masked.target, None);
        assert_eq!(
            apply(&s, &pt(0, 0, PositionTargetTypemask::empty()))
                .unwrap()
                .target,
            None
        );
    }

    #[test]
    fn home_position_sets_home() {
        let msg = MavMessage::HOME_POSITION(HOME_POSITION_DATA {
            latitude: 354_818_830,
            longitude: 1_384_802_900,
            altitude: 400_500,
            ..HOME_POSITION_DATA::DEFAULT
        });
        assert_eq!(
            apply(&base(), &msg).unwrap().home,
            Some(GeoPoint {
                lat: 35.481883,
                lon: 138.48029,
                alt: 400.5
            })
        );
    }

    fn base() -> VehicleState {
        VehicleState::new(1, "UAV-01")
    }

    fn plane_heartbeat(mavtype: MavType) -> MavMessage {
        MavMessage::HEARTBEAT(HEARTBEAT_DATA {
            mavtype,
            autopilot: MavAutopilot::MAV_AUTOPILOT_ARDUPILOTMEGA,
            ..HEARTBEAT_DATA::DEFAULT
        })
    }

    fn extended(vtol_state: MavVtolState) -> MavMessage {
        MavMessage::EXTENDED_SYS_STATE(EXTENDED_SYS_STATE_DATA {
            vtol_state,
            ..EXTENDED_SYS_STATE_DATA::DEFAULT
        })
    }

    #[test]
    fn extended_sys_state_tells_a_quadplane_from_a_plain_plane() {
        // A QuadPlane's HEARTBEAT says FIXED_WING; only its vtol_state gives it away.
        let plane = VehicleState {
            kind: rgcs_core::VehicleKind::Plane,
            ..base()
        };
        let qp = apply(&plane, &extended(MavVtolState::MAV_VTOL_STATE_MC)).expect("vtol is shown");
        assert!(qp.vtol);
        let fw = apply(&qp, &extended(MavVtolState::MAV_VTOL_STATE_FW)).unwrap();
        assert!(fw.vtol, "flying as a plane is still a VTOL");
        let plain = apply(&qp, &extended(MavVtolState::MAV_VTOL_STATE_UNDEFINED)).unwrap();
        assert!(!plain.vtol);
    }

    #[test]
    fn a_copter_hovering_is_not_a_vtol_plane() {
        // ArduCopter reports vtol_state MC too; only a plane that hovers is a VTOL.
        let copter = VehicleState {
            kind: rgcs_core::VehicleKind::Copter,
            ..base()
        };
        assert!(
            !apply(&copter, &extended(MavVtolState::MAV_VTOL_STATE_MC))
                .unwrap()
                .vtol
        );
        let was_vtol = VehicleState { vtol: true, ..base() };
        assert!(
            !apply(&was_vtol, &plane_heartbeat(MavType::MAV_TYPE_QUADROTOR))
                .unwrap()
                .vtol
        );
    }

    #[test]
    fn a_vtol_mav_type_marks_vtol_and_a_fixed_wing_heartbeat_keeps_what_is_known() {
        let tilt = apply(&base(), &plane_heartbeat(MavType::MAV_TYPE_VTOL_TILTROTOR)).unwrap();
        assert!(tilt.vtol);
        assert_eq!(tilt.kind, rgcs_core::VehicleKind::Plane);
        let qp = VehicleState { vtol: true, ..base() };
        assert!(
            apply(&qp, &plane_heartbeat(MavType::MAV_TYPE_FIXED_WING))
                .unwrap()
                .vtol
        );
        assert!(
            !apply(&base(), &plane_heartbeat(MavType::MAV_TYPE_FIXED_WING))
                .unwrap()
                .vtol
        );
    }

    #[test]
    fn heartbeat_sets_kind_mode_and_armed() {
        let hb = HEARTBEAT_DATA {
            custom_mode: 3,
            mavtype: MavType::MAV_TYPE_QUADROTOR,
            autopilot: MavAutopilot::MAV_AUTOPILOT_ARDUPILOTMEGA,
            base_mode: MavModeFlag::MAV_MODE_FLAG_SAFETY_ARMED
                | MavModeFlag::MAV_MODE_FLAG_CUSTOM_MODE_ENABLED,
            ..HEARTBEAT_DATA::DEFAULT
        };
        let s = apply(&base(), &MavMessage::HEARTBEAT(hb)).unwrap();
        assert_eq!(s.kind, rgcs_core::VehicleKind::Copter);
        assert_eq!(s.mode, "AUTO");
        assert!(s.armed);
    }

    #[test]
    fn global_position_converts_units_like_the_python_app() {
        let p = GLOBAL_POSITION_INT_DATA {
            lat: 350_000_000,
            lon: 1_390_000_000,
            alt: 12_345,
            relative_alt: 80_000,
            hdg: 9_000,
            ..GLOBAL_POSITION_INT_DATA::DEFAULT
        };
        let s = apply_global_position(&base(), &p);
        assert!((s.lat - 35.0).abs() < 1e-9 && (s.lon - 139.0).abs() < 1e-9);
        assert!((s.alt_msl - 12.345).abs() < 1e-4);
        assert!((s.alt_rel - 80.0).abs() < 1e-4);
        assert_eq!(s.hdg, Some(90.0));
    }

    #[test]
    fn attitude_gives_roll_and_pitch_in_tenths_of_a_degree() {
        let a = ATTITUDE_DATA {
            roll: std::f32::consts::FRAC_PI_6, // 30.0°
            pitch: -0.0873,                    // -5.0°
            ..ATTITUDE_DATA::DEFAULT
        };
        let s = apply(&base(), &MavMessage::ATTITUDE(a)).expect("attitude is shown");
        assert_eq!(
            s.attitude,
            Some(rgcs_core::Attitude {
                roll: 30.0,
                pitch: -5.0
            })
        );
    }

    #[test]
    fn unknown_heading_is_none() {
        let p = GLOBAL_POSITION_INT_DATA {
            hdg: 65_535,
            ..GLOBAL_POSITION_INT_DATA::DEFAULT
        };
        assert_eq!(apply_global_position(&base(), &p).hdg, None);
    }

    #[test]
    fn sys_status_battery() {
        let s = SYS_STATUS_DATA {
            voltage_battery: 22_800,
            current_battery: 1_250,
            battery_remaining: 62,
            ..SYS_STATUS_DATA::DEFAULT
        };
        let b = apply_sys_status(&base(), &s).battery;
        assert_eq!(
            b,
            Battery {
                pct: Some(62),
                volt: 22.8,
                current: Some(12.5)
            }
        );
        let unknown = SYS_STATUS_DATA {
            voltage_battery: 65_535,
            current_battery: -1,
            battery_remaining: -1,
            ..s
        };
        let b = apply_sys_status(&base(), &unknown).battery;
        assert_eq!(
            b,
            Battery {
                pct: None,
                volt: 0.0,
                current: None
            }
        );
    }

    #[test]
    fn vfr_hud_and_gps_raw() {
        let s = apply_vfr_hud(
            &base(),
            &VFR_HUD_DATA {
                groundspeed: 8.1,
                climb: -0.4,
                ..VFR_HUD_DATA::DEFAULT
            },
        );
        assert_eq!((s.ground_speed, s.climb), (8.1, -0.4));
        let g = GPS_RAW_INT_DATA {
            eph: 120,
            satellites_visible: 14,
            fix_type: GpsFixType::GPS_FIX_TYPE_3D_FIX,
            ..GPS_RAW_INT_DATA::DEFAULT
        };
        assert_eq!(
            apply_gps_raw(&base(), &g).gps,
            Gps {
                fix: 3,
                sats: 14,
                hdop: Some(1.2)
            }
        );
    }

    #[test]
    fn unrelated_messages_are_ignored() {
        assert!(apply(&base(), &MavMessage::SYSTEM_TIME(Default::default())).is_none());
    }
}
