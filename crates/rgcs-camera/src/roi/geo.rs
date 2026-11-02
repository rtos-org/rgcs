//! Geodetic helpers (port of `app/geo.py`).

pub const WGS84_A: f64 = 6378137.0;
pub const WGS84_E2: f64 = 6.69437999014e-3;

/// MT11 pitch range for 0x0E (upright mounting).
pub const PITCH_MIN_DEG: f64 = -90.0;
pub const PITCH_MAX_DEG: f64 = 30.0;

/// A geodetic point, altitude MSL.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct GeoPos {
    pub lat_deg: f64,
    pub lon_deg: f64,
    pub alt_m: f64,
}

/// Earth-frame look angles from the vehicle to the target.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct LookAngles {
    /// 0..360, clockwise from true north.
    pub bearing_deg: f64,
    /// + up, - down.
    pub elevation_deg: f64,
    /// Slant range.
    pub distance_m: f64,
    pub horizontal_m: f64,
}

/// MT11 0x0E angles, body-relative. Yaw: + = left.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct GimbalAngles {
    pub yaw_deg: f64,
    pub pitch_deg: f64,
}

/// Wrap an angle into (-180, 180].
pub fn wrap_180(deg: f64) -> f64 {
    let mut wrapped = (deg + 180.0) % 360.0;
    if wrapped <= 0.0 {
        wrapped += 360.0;
    }
    wrapped - 180.0
}

fn to_ecef(p: &GeoPos) -> (f64, f64, f64) {
    let (lat, lon) = (p.lat_deg.to_radians(), p.lon_deg.to_radians());
    let sin_lat = lat.sin();
    let n = WGS84_A / (1.0 - WGS84_E2 * sin_lat * sin_lat).sqrt();
    (
        (n + p.alt_m) * lat.cos() * lon.cos(),
        (n + p.alt_m) * lat.cos() * lon.sin(),
        (n * (1.0 - WGS84_E2) + p.alt_m) * sin_lat,
    )
}

/// Bearing / elevation / range from `own` to `target` via ECEF -> local ENU.
pub fn look_angles(own: &GeoPos, target: &GeoPos) -> LookAngles {
    let (ox, oy, oz) = to_ecef(own);
    let (tx, ty, tz) = to_ecef(target);
    let (dx, dy, dz) = (tx - ox, ty - oy, tz - oz);

    let (lat, lon) = (own.lat_deg.to_radians(), own.lon_deg.to_radians());
    let (sin_lat, cos_lat) = (lat.sin(), lat.cos());
    let (sin_lon, cos_lon) = (lon.sin(), lon.cos());
    let east = -sin_lon * dx + cos_lon * dy;
    let north = -sin_lat * cos_lon * dx - sin_lat * sin_lon * dy + cos_lat * dz;
    let up = cos_lat * cos_lon * dx + cos_lat * sin_lon * dy + sin_lat * dz;

    let horizontal = east.hypot(north);
    LookAngles {
        bearing_deg: east.atan2(north).to_degrees().rem_euclid(360.0),
        elevation_deg: up.atan2(horizontal).to_degrees(),
        distance_m: (horizontal * horizontal + up * up).sqrt(),
        horizontal_m: horizontal,
    }
}

/// Earth-frame look angles to MT11 0x0E angles (Follow mode, body-relative yaw).
pub fn to_gimbal_angles(look: &LookAngles, heading_deg: f64, yaw_offset_deg: f64) -> GimbalAngles {
    let relative = wrap_180(look.bearing_deg - heading_deg);
    GimbalAngles {
        yaw_deg: wrap_180(-relative + yaw_offset_deg),
        pitch_deg: look.elevation_deg.clamp(PITCH_MIN_DEG, PITCH_MAX_DEG),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const OWN: GeoPos = GeoPos {
        lat_deg: 35.0,
        lon_deg: 139.0,
        alt_m: 0.0,
    };

    fn offset_point(north_m: f64, east_m: f64, up_m: f64) -> GeoPos {
        let sin_lat = OWN.lat_deg.to_radians().sin();
        let meridional = WGS84_A * (1.0 - WGS84_E2) / (1.0 - WGS84_E2 * sin_lat * sin_lat).powf(1.5);
        let normal = WGS84_A / (1.0 - WGS84_E2 * sin_lat * sin_lat).sqrt();
        GeoPos {
            lat_deg: OWN.lat_deg + (north_m / meridional).to_degrees(),
            lon_deg: OWN.lon_deg + (east_m / (normal * OWN.lat_deg.to_radians().cos())).to_degrees(),
            alt_m: OWN.alt_m + up_m,
        }
    }

    fn near(a: f64, b: f64, tol: f64) {
        assert!((a - b).abs() <= tol, "{a} vs {b} (tol {tol})");
    }

    fn look(n: f64, e: f64, u: f64) -> LookAngles {
        look_angles(&OWN, &offset_point(n, e, u))
    }

    #[test]
    fn wrap_180_cases() {
        for (input, want) in [
            (0.0, 0.0),
            (180.0, 180.0),
            (-180.0, 180.0),
            (190.0, -170.0),
            (-190.0, 170.0),
            (360.0, 0.0),
            (725.0, 5.0),
        ] {
            near(wrap_180(input), want, 1e-9);
        }
    }

    #[test]
    fn look_north() {
        let l = look(1000.0, 0.0, 0.0);
        near(l.bearing_deg.min(360.0 - l.bearing_deg), 0.0, 0.05);
        near(l.horizontal_m, 1000.0, 10.0);
    }

    #[test]
    fn look_east() {
        near(look(0.0, 1000.0, 0.0).bearing_deg, 90.0, 0.05);
    }

    #[test]
    fn look_south_west() {
        near(look(-1000.0, -1000.0, 0.0).bearing_deg, 225.0, 0.02);
    }

    #[test]
    fn bearing_in_0_360() {
        near(look(1000.0, -10.0, 0.0).bearing_deg, 359.43, 0.05);
    }

    #[test]
    fn elevation_up_45() {
        let l = look(100.0, 0.0, 100.0);
        near(l.elevation_deg, 45.0, 0.2);
        near(l.distance_m, 100.0_f64.hypot(100.0), 1.5);
    }

    #[test]
    fn elevation_down_from_altitude() {
        let own = GeoPos { alt_m: 100.0, ..OWN };
        let l = look_angles(&own, &offset_point(100.0, 0.0, 0.0));
        near(l.elevation_deg, -45.0, 0.2);
    }

    #[test]
    fn straight_down() {
        let own = GeoPos { alt_m: 100.0, ..OWN };
        let l = look_angles(&own, &OWN);
        near(l.elevation_deg, -90.0, 0.01);
        near(l.horizontal_m, 0.0, 0.01);
    }

    #[test]
    fn earth_curvature_lowers_far_target() {
        near(look(10000.0, 0.0, 0.0).elevation_deg, -0.045, 0.01);
    }

    fn look_at(bearing: f64, elevation: f64) -> LookAngles {
        LookAngles {
            bearing_deg: bearing,
            elevation_deg: elevation,
            distance_m: 100.0,
            horizontal_m: 100.0,
        }
    }

    #[test]
    fn target_ahead() {
        near(
            to_gimbal_angles(&look_at(10.0, 0.0), 10.0, 0.0).yaw_deg,
            0.0,
            1e-9,
        );
    }

    #[test]
    fn target_right_is_negative_yaw() {
        near(
            to_gimbal_angles(&look_at(90.0, 0.0), 0.0, 0.0).yaw_deg,
            -90.0,
            1e-9,
        );
    }

    #[test]
    fn target_left_is_positive_yaw_across_north() {
        near(
            to_gimbal_angles(&look_at(350.0, 0.0), 10.0, 0.0).yaw_deg,
            20.0,
            1e-9,
        );
    }

    #[test]
    fn yaw_offset() {
        near(
            to_gimbal_angles(&look_at(10.0, 0.0), 10.0, 2.5).yaw_deg,
            2.5,
            1e-9,
        );
    }

    #[test]
    fn pitch_clamped_to_upper_limit() {
        near(
            to_gimbal_angles(&look_at(0.0, 60.0), 0.0, 0.0).pitch_deg,
            30.0,
            1e-9,
        );
    }

    #[test]
    fn pitch_passthrough() {
        near(
            to_gimbal_angles(&look_at(0.0, -45.0), 0.0, 0.0).pitch_deg,
            -45.0,
            1e-9,
        );
    }
}
