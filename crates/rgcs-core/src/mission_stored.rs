//! What ArduPilot reads back for a mission item it accepted. AP_Mission packs every item into a
//! small `Mission_Command` (`mavlink_int_to_mission_cmd`) and rebuilds the MAVLink item from it
//! (`mission_cmd_to_mavlink_int`): a param it has no room for comes back as 0, an integer field
//! comes back truncated and some fields come back as a flag or a constant. The upload check
//! compares the read-back with this prediction, and the planner warns when a param the operator
//! set would not survive (`param_ignored`).
//!
//! `AP_Mission.cpp:N` refers to ArduPilot master e96bd9053e, libraries/AP_Mission/AP_Mission.cpp
//! (`mavlink_int_to_mission_cmd` from :1075, `mission_cmd_to_mavlink_int` from :1700); field
//! types are the `Mission_Command` content structs in AP_Mission.h.
//!
//! The params are already float32 (the MISSION_ITEM_INT type), so a float field comes back as
//! sent. C's float → integer conversion truncates toward zero; out-of-range values are undefined
//! behaviour there and are clamped here. A command not modelled below reads back as sent.

use crate::mission::{Finding, MissionItem, StoredParam};
use crate::vehicle::VehicleKind;

/// How one field survives storage.
#[derive(Debug, Clone, Copy, PartialEq)]
enum Keep {
    /// Not stored: read back as 0.
    Zero,
    /// Stored as a float: read back as sent.
    Float,
    /// Stored in an integer with this range.
    Int(f64, f64),
    /// Read back as this value whatever was sent.
    Const(f32),
}

const Z: Keep = Keep::Zero;
const F: Keep = Keep::Float;
const U8: Keep = Keep::Int(0.0, 255.0);
const I8: Keep = Keep::Int(-128.0, 127.0);
const U16: Keep = Keep::Int(0.0, 65_535.0);
const I16: Keep = Keep::Int(-32_768.0, 32_767.0);
/// A command whose only stored param is `p1` (uint16_t `cmd.p1`).
const P1: [Keep; 4] = [U16, Z, Z, Z];
const NO_XYZ: [Keep; 3] = [Z, Z, Z];

type Packer = fn([f32; 4], bool) -> [f32; 4];

enum Rule {
    /// Each param, and for a command without a location x / y / z, stored on its own.
    Fields([Keep; 4], [Keep; 3]),
    /// Params packed together into `cmd.p1` and the location flags (`bool`: ArduPlane build).
    Packed(Packer),
}

/// `AP_Mission::stored_in_location` (AP_Mission.cpp:908): x / y / z are a position, kept as
/// sent (lat/lon as 1e-7 degrees, alt as centimetres; compared with tolerances by the caller).
pub fn stored_in_location(command: u16) -> bool {
    matches!(
        command,
        16..=19 | 21 | 22 | 30 | 31 | 36 | 82 | 84 | 85 | 92 | 94 | 179 | 188 | 189 | 191 | 195 | 201
            | 5000..=5004 | 5100
    )
}

/// The command's name and storage rule, `None` when it is not modelled.
fn rule(command: u16) -> Option<(&'static str, Rule)> {
    use Rule::{Fields, Packed};
    let r = match command {
        16 => ("NAV_WAYPOINT", Packed(waypoint)),
        17 => ("NAV_LOITER_UNLIM", Packed(loiter_unlim)),
        18 => ("NAV_LOITER_TURNS", Packed(loiter_turns)),
        19 => ("NAV_LOITER_TIME", Packed(loiter_time)),
        // :1213 / :1761 nothing stored
        20 => ("NAV_RETURN_TO_LAUNCH", Fields([Z; 4], NO_XYZ)),
        21 => ("NAV_LAND", Packed(land)),
        // :1223 / :1769 p1 = minimum pitch
        22 => ("NAV_TAKEOFF", Fields(P1, NO_XYZ)),
        // :1227 / :1773 p1 = climb / descend
        30 => ("NAV_CONTINUE_AND_CHANGE_ALT", Fields(P1, NO_XYZ)),
        31 => ("NAV_LOITER_TO_ALT", Packed(loiter_to_alt)),
        36 => ("NAV_ARC_WAYPOINT", Packed(arc_waypoint)),
        // :1245 / :1793 p1 = delay (ArduPlane rejects the command)
        82 => ("NAV_SPLINE_WAYPOINT", Fields(P1, NO_XYZ)),
        // :1411 / :1963 nothing stored
        84 => ("NAV_VTOL_TAKEOFF", Fields([Z; 4], NO_XYZ)),
        // :1414 / :1966 p1 = options
        85 => ("NAV_VTOL_LAND", Fields(P1, NO_XYZ)),
        // :1253 / :1797 p1 = on / off
        92 => ("NAV_GUIDED_ENABLE", Fields(P1, NO_XYZ)),
        // :1257 / :1801 float seconds, int8_t hour / min / sec
        93 => ("NAV_DELAY", Fields([F, I8, I8, I8], NO_XYZ)),
        // :1264 / :1808 float seconds
        112 => ("CONDITION_DELAY", Fields([F, Z, Z, Z], NO_XYZ)),
        // :1268 / :1812 float metres
        114 => ("CONDITION_DISTANCE", Fields([F, Z, Z, Z], NO_XYZ)),
        // :1272 / :1816 float angle, float rate, int8_t direction, uint8_t relative
        115 => ("CONDITION_YAW", Fields([F, F, I8, U8], NO_XYZ)),
        // :1279 / :1823 uint16_t target, int16_t repeat
        177 => ("DO_JUMP", Fields([U16, I16, Z, Z], NO_XYZ)),
        // :1289 / :1833 uint8_t speed type, float speed, float throttle
        178 => ("DO_CHANGE_SPEED", Fields([U8, F, F, Z], NO_XYZ)),
        // :1295 / :1839 p1 = use current location
        179 => ("DO_SET_HOME", Fields(P1, NO_XYZ)),
        // :1299 / :1843 uint8_t relay, uint8_t state
        181 => ("DO_SET_RELAY", Fields([U8, U8, Z, Z], NO_XYZ)),
        // :1304 / :1848 uint8_t relay, int16_t count, float cycle time
        182 => ("DO_REPEAT_RELAY", Fields([U8, I16, F, Z], NO_XYZ)),
        // :1310 / :1854 uint8_t channel, uint16_t pwm
        183 => ("DO_SET_SERVO", Fields([U8, U16, Z, Z], NO_XYZ)),
        // :1315 / :1859 uint8_t channel, uint16_t pwm, int16_t count, float cycle time
        184 => ("DO_REPEAT_SERVO", Fields([U8, U16, I16, F], NO_XYZ)),
        // :1322 / :1866 nothing stored
        188 => ("DO_RETURN_PATH_START", Fields([Z; 4], NO_XYZ)),
        189 => ("DO_LAND_START", Fields([Z; 4], NO_XYZ)),
        // :1326 / :1870 nothing stored
        191 => ("DO_GO_AROUND", Fields([Z; 4], NO_XYZ)),
        // :1486 / :2032, :1422 / :1953 p1
        193 => ("DO_PAUSE_CONTINUE", Fields(P1, NO_XYZ)),
        194 => ("DO_SET_REVERSE", Fields(P1, NO_XYZ)),
        // :1329 / :1873 p1 = gimbal device id
        195 => ("DO_SET_ROI_LOCATION", Fields(P1, NO_XYZ)),
        197 => ("DO_SET_ROI_NONE", Fields(P1, NO_XYZ)),
        // :1334 / :1878 p1 = ROI mode
        201 => ("DO_SET_ROI", Fields(P1, NO_XYZ)),
        // :1338 / :1882 uint8_t mode, uint16_t shutter, uint8_t aperture, uint16_t ISO,
        // x uint8_t exposure, y uint8_t command id, z float engine cut-off
        202 => ("DO_DIGICAM_CONFIGURE", Fields([U8, U16, U8, U16], [U8, U8, F])),
        // :1348 / :1892 uint8_t session, uint8_t zoom, int8_t zoom step, uint8_t focus lock,
        // x uint8_t shooting command, y uint8_t command id
        203 => ("DO_DIGICAM_CONTROL", Fields([U8, U8, I8, U8], [U8, U8, Z])),
        // :1357 / :1901 float pitch / roll / yaw; z reads back MAV_MOUNT_MODE_MAVLINK_TARGETING
        205 => ("DO_MOUNT_CONTROL", Fields([F, F, F, Z], [Z, Z, Keep::Const(2.0)])),
        // :1364 / :1908 float metres, uint8_t trigger now, uint8_t camera id
        206 => ("DO_SET_CAM_TRIGG_DIST", Fields([F, Z, U8, U8], NO_XYZ)),
        // :1370 / :1914, :1379 / :1918, :1383 / :1931 p1
        207 => ("DO_FENCE_ENABLE", Fields(P1, NO_XYZ)),
        208 => ("DO_PARACHUTE", Fields(P1, NO_XYZ)),
        210 => ("DO_INVERTED_FLIGHT", Fields(P1, NO_XYZ)),
        // :1388 / :1936 uint8_t gripper, uint8_t action
        211 => ("DO_GRIPPER", Fields([U8, U8, Z, Z], NO_XYZ)),
        // :1401 / :1949, :1452 / :2002, :1456 / :1922 p1
        212 => ("DO_AUTOTUNE_ENABLE", Fields(P1, NO_XYZ)),
        215 => ("DO_SET_RESUME_REPEAT_DIST", Fields(P1, NO_XYZ)),
        216 => ("DO_SPRAYER", Fields(P1, NO_XYZ)),
        // :1374 / :1926 uint16_t function, uint8_t switch position
        218 => ("DO_AUX_FUNCTION", Fields([U16, U8, Z, Z], NO_XYZ)),
        // :1490 / :2036 int8_t pitch, int16_t yaw, int8_t pitch rate, int8_t yaw rate,
        // x uint8_t flags, z uint8_t gimbal id
        1000 => (
            "DO_GIMBAL_MANAGER_PITCHYAW",
            Fields([I8, I16, I8, I8], [U8, Z, U8]),
        ),
        // :1418 / :1970 uint8_t target state
        3000 => ("DO_VTOL_TRANSITION", Fields([U8, Z, Z, Z], NO_XYZ)),
        _ => return None,
    };
    Some(r)
}

/// C float → integer conversion (toward zero), clamped to the field's range.
fn int(v: f32, lo: f64, hi: f64) -> f32 {
    (v as f64).trunc().clamp(lo, hi) as f32
}

fn u16_of(v: f32) -> f32 {
    int(v, 0.0, 65_535.0)
}

fn param(keep: Keep, v: f32) -> f32 {
    match keep {
        Keep::Zero => 0.0,
        Keep::Float => v,
        Keep::Int(lo, hi) => int(v, lo, hi),
        Keep::Const(c) => c,
    }
}

/// x / y travel as int32 for a command without a location (RGCS rounds them) and are narrowed
/// to the field's integer type, which wraps.
fn xy(keep: Keep, v: f64) -> f64 {
    match keep {
        Keep::Int(lo, hi) => {
            let wire = v.round().clamp(i32::MIN as f64, i32::MAX as f64) as i64;
            let (lo, span) = (lo as i64, (hi - lo) as i64 + 1);
            ((wire - lo).rem_euclid(span) + lo) as f64
        }
        other => f64::from(param(other, v as f32)),
    }
}

/// `is_negative` (AP_Math.h): at or below -FLT_EPSILON.
fn negative(v: f32) -> bool {
    v <= -f32::EPSILON
}

/// `loiter_xtrack = param4 > 0`, read back as 0 / 1.
fn xtrack(v: f32) -> f32 {
    if v > 0.0 {
        1.0
    } else {
        0.0
    }
}

/// :1148 / :1717 ArduPlane packs acceptance (param2) and pass-by (param3) radii as bytes of p1
/// and drops the delay; every other build keeps only the delay (param1) in p1.
fn waypoint(p: [f32; 4], plane: bool) -> [f32; 4] {
    if plane {
        [0.0, int(p[1], 0.0, 255.0), int(p[2], 0.0, 255.0), 0.0]
    } else {
        [u16_of(p[0]), 0.0, 0.0, 0.0]
    }
}

/// :1175 / :1729 p1 = |radius| (param3), its sign in `loiter_ccw`.
fn loiter_unlim(p: [f32; 4], _: bool) -> [f32; 4] {
    let r = u16_of(p[2].abs());
    [0.0, 0.0, if p[2] < 0.0 { -r } else { r }, 0.0]
}

/// :1180 / :1736 turns in the low byte of p1 (0 < N < 1 stored ×256), |radius| in the high byte
/// (over 255 m stored ÷10), direction in `loiter_ccw`, param4 as the xtrack flag.
fn loiter_turns(p: [f32; 4], _: bool) -> [f32; 4] {
    let fraction = p[0] > 0.0 && p[0] < 1.0;
    let turns = int(if fraction { p[0] * 256.0 } else { p[0] }, 0.0, 255.0);
    let turns = if fraction { turns / 256.0 } else { turns };
    let abs = p[2].abs();
    let radius = if abs <= 255.0 {
        int(abs, 0.0, 255.0)
    } else {
        (f64::from(abs) * 0.1).min(255.0).trunc() as f32 * 10.0
    };
    let radius = if p[2] < 0.0 { -radius } else { radius };
    [turns, 0.0, radius, xtrack(p[3])]
}

/// :1207 / :1751 p1 = seconds; param3 reads back as ±1 (direction), param4 as the xtrack flag.
fn loiter_time(p: [f32; 4], _: bool) -> [f32; 4] {
    let dir = if p[2] < 0.0 { -1.0 } else { 1.0 };
    [u16_of(p[0]), 0.0, dir, xtrack(p[3])]
}

/// :1216 / :1764 p1 = abort altitude; param4 reads back as ±1 (deepstall yaw direction).
fn land(p: [f32; 4], _: bool) -> [f32; 4] {
    [u16_of(p[0]), 0.0, 0.0, if negative(p[3]) { -1.0 } else { 1.0 }]
}

/// :1234 / :1780 p1 = |radius| (param2), its sign in `loiter_ccw`, param4 as the xtrack flag;
/// param1 and param3 are not stored.
fn loiter_to_alt(p: [f32; 4], _: bool) -> [f32; 4] {
    let r = u16_of(p[1].abs());
    [0.0, if p[1] < 0.0 { -r } else { r }, 0.0, xtrack(p[3])]
}

/// :1240 / :1788 p1 = |angle| in whole degrees, its sign in `loiter_ccw`.
fn arc_waypoint(p: [f32; 4], _: bool) -> [f32; 4] {
    let a = u16_of(p[0].abs());
    [if negative(p[0]) { -a } else { a }, 0.0, 0.0, 0.0]
}

/// The item as ArduPilot reads it back (`plane`: an ArduPlane build, QuadPlane included).
pub fn as_stored(item: &MissionItem, plane: bool) -> MissionItem {
    let Some((_, rule)) = rule(item.command) else {
        return item.clone();
    };
    let (params, xyz) = match rule {
        Rule::Packed(pack) => (pack(item.params, plane), NO_XYZ),
        Rule::Fields(keep, xyz) => {
            let p = item.params;
            ([0, 1, 2, 3].map(|i| param(keep[i], p[i])), xyz)
        }
    };
    if stored_in_location(item.command) {
        return MissionItem {
            params,
            ..item.clone()
        };
    }
    MissionItem {
        params,
        lat: xy(xyz[0], item.lat),
        lon: xy(xyz[1], item.lon),
        alt: param(xyz[2], item.alt),
        ..item.clone()
    }
}

/// What the vehicle may read back: one form for a known airframe, both packings (ArduPlane and
/// the rest) when it is not known.
pub fn stored_forms(item: &MissionItem, kind: Option<VehicleKind>) -> Vec<MissionItem> {
    match kind {
        Some(k) => vec![as_stored(item, k == VehicleKind::Plane)],
        None => {
            let (a, b) = (as_stored(item, true), as_stored(item, false));
            if a == b {
                vec![a]
            } else {
                vec![a, b]
            }
        }
    }
}

/// params 1–4, then x / y / z (only for a command without a location).
fn slots(it: &MissionItem) -> Vec<f64> {
    let mut out: Vec<f64> = it.params.iter().map(|&v| f64::from(v)).collect();
    if !stored_in_location(it.command) {
        out.extend([it.lat, it.lon, f64::from(it.alt)]);
    }
    out
}

fn ignored_slot(it: &MissionItem, forms: &[MissionItem]) -> Vec<(usize, f64, f64)> {
    let sent = slots(it);
    let stored: Vec<Vec<f64>> = forms.iter().map(slots).collect();
    (0..sent.len())
        .filter(|&i| sent[i] != 0.0 && stored.iter().all(|s| s[i] != sent[i]))
        .map(|i| (i, sent[i], stored[0][i]))
        .collect()
}

/// `param_ignored` warnings: a non-zero param that ArduPilot (every build when `kind` is
/// unknown) would drop or change. `items` are what RGCS sends.
pub(crate) fn ignored_param_findings(items: &[MissionItem], kind: Option<VehicleKind>) -> Vec<Finding> {
    let mut out = Vec::new();
    for (i, it) in items.iter().enumerate() {
        let Some((name, _)) = rule(it.command) else {
            continue;
        };
        for (slot, sent, stored) in ignored_slot(it, &stored_forms(it, kind)) {
            let how = if stored == 0.0 {
                "is not stored by ArduPilot".to_string()
            } else {
                format!("is stored by ArduPilot as {}", stored as f32)
            };
            let mut f = Finding::warn(
                "param_ignored",
                Some((i + 1) as u16),
                format!("{name} param{} {} {how}", slot + 1, sent as f32),
            );
            f.param = Some(StoredParam {
                index: (slot + 1) as u8,
                sent: sent as f32,
                stored: stored as f32,
            });
            out.push(f);
        }
    }
    out
}

#[cfg(test)]
#[path = "mission_stored_tests.rs"]
mod tests;
