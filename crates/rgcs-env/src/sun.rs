//! Sunrise / sunset, NOAA general solar position algorithm (zenith 90.833°), no dependency.

use std::f64::consts::PI;

use time::{Date, Duration, OffsetDateTime, Time};

/// Zenith of the sun's centre at apparent sunrise / sunset (refraction + solar radius).
const ZENITH_DEG: f64 = 90.833;
/// `daylight_minutes` during polar day: a whole day of light left.
pub const POLAR_DAY_MINUTES: f64 = 1440.0;

enum Sun {
    Times(f64, f64), // sunrise, sunset in minutes after 00:00 UTC of the date
    PolarDay,
    PolarNight,
}

fn solve(lat: f64, lon: f64, date: Date) -> Option<Sun> {
    if !lat.is_finite() || !lon.is_finite() || lat.abs() > 90.0 || lon.abs() > 180.0 {
        return None;
    }
    // Fractional year at local noon (NOAA general solar position).
    let days = if date.year() % 4 == 0 { 366.0 } else { 365.0 };
    let g = 2.0 * PI / days * (f64::from(date.ordinal()) - 1.0 - lon / 360.0);
    let eqtime = 229.18
        * (0.000075 + 0.001868 * g.cos()
            - 0.032077 * g.sin()
            - 0.014615 * (2.0 * g).cos()
            - 0.040849 * (2.0 * g).sin());
    let decl = 0.006918 - 0.399912 * g.cos() + 0.070257 * g.sin() - 0.006758 * (2.0 * g).cos()
        + 0.000907 * (2.0 * g).sin()
        - 0.002697 * (3.0 * g).cos()
        + 0.00148 * (3.0 * g).sin();
    let phi = lat.to_radians();
    let cos_ha = ZENITH_DEG.to_radians().cos() / (phi.cos() * decl.cos()) - phi.tan() * decl.tan();
    if cos_ha.is_nan() {
        return None;
    }
    if cos_ha > 1.0 {
        return Some(Sun::PolarNight);
    }
    if cos_ha < -1.0 {
        return Some(Sun::PolarDay);
    }
    let ha = cos_ha.acos().to_degrees();
    Some(Sun::Times(
        720.0 - 4.0 * (lon + ha) - eqtime,
        720.0 - 4.0 * (lon - ha) - eqtime,
    ))
}

fn at_minutes(date: Date, minutes: f64) -> OffsetDateTime {
    let midnight = date.with_time(Time::MIDNIGHT).assume_utc();
    midnight + Duration::seconds((minutes * 60.0).round() as i64)
}

/// Sunrise and sunset (UTC) for the local solar day `date` at the position.
/// `None` during polar day / night or for an invalid position.
pub fn sun_times(lat: f64, lon: f64, date: Date) -> Option<(OffsetDateTime, OffsetDateTime)> {
    match solve(lat, lon, date)? {
        Sun::Times(rise, set) => Some((at_minutes(date, rise), at_minutes(date, set))),
        Sun::PolarDay | Sun::PolarNight => None,
    }
}

/// Minutes of daylight left at `now`: until sunset while the sun is up, `0.0` when dark
/// (after sunset, before sunrise, polar night), [`POLAR_DAY_MINUTES`] in polar day.
pub fn daylight_minutes(lat: f64, lon: f64, now: OffsetDateTime) -> Option<f64> {
    if !lon.is_finite() {
        return None;
    }
    // The local solar date: shift UTC by the longitude (15° per hour).
    let local = now.to_offset(time::UtcOffset::UTC) + Duration::minutes((lon * 4.0) as i64);
    let date = local.date();
    match solve(lat, lon, date)? {
        Sun::PolarDay => Some(POLAR_DAY_MINUTES),
        Sun::PolarNight => Some(0.0),
        Sun::Times(rise, set) => {
            let (rise, set) = (at_minutes(date, rise), at_minutes(date, set));
            if now < rise || now >= set {
                return Some(0.0);
            }
            Some((set - now).whole_seconds() as f64 / 60.0)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use time::macros::{date, datetime};
    use time::UtcOffset;

    fn jst_minutes(t: OffsetDateTime) -> i64 {
        let j = t.to_offset(UtcOffset::from_hms(9, 0, 0).unwrap());
        i64::from(j.hour()) * 60 + i64::from(j.minute())
    }

    #[test]
    fn kamikochi_sunrise_and_sunset_match_noaa() {
        let (rise, set) = sun_times(36.2509, 137.6385, date!(2026 - 10 - 25)).unwrap();
        assert!((jst_minutes(rise) - (6 * 60 + 4)).abs() <= 3, "{rise}");
        assert!((jst_minutes(set) - (17 * 60 + 3)).abs() <= 3, "{set}");
        assert_eq!(rise.offset(), UtcOffset::UTC);
        assert!(rise < set);
    }

    #[test]
    fn polar_day_and_night_have_no_times() {
        assert!(sun_times(80.0, 0.0, date!(2026 - 06 - 21)).is_none());
        assert!(sun_times(80.0, 0.0, date!(2026 - 12 - 21)).is_none());
        assert!(sun_times(f64::NAN, 0.0, date!(2026 - 12 - 21)).is_none());
        assert!(sun_times(91.0, 0.0, date!(2026 - 12 - 21)).is_none());
    }

    #[test]
    fn daylight_minutes_counts_down_to_sunset_and_is_zero_when_dark() {
        let (lat, lon) = (36.2509, 137.6385);
        // 16:33 JST is about 30 min before sunset.
        let m = daylight_minutes(lat, lon, datetime!(2026-10-25 07:33 UTC)).unwrap();
        assert!((m - 30.0).abs() <= 3.0, "{m}");
        // 20:00 JST (after sunset) and 04:00 JST (before sunrise, previous UTC day).
        assert_eq!(
            daylight_minutes(lat, lon, datetime!(2026-10-25 11:00 UTC)),
            Some(0.0)
        );
        assert_eq!(
            daylight_minutes(lat, lon, datetime!(2026-10-24 19:00 UTC)),
            Some(0.0)
        );
        assert_eq!(
            daylight_minutes(80.0, 0.0, datetime!(2026-12-21 12:00 UTC)),
            Some(0.0)
        );
        assert_eq!(
            daylight_minutes(80.0, 0.0, datetime!(2026-06-21 12:00 UTC)),
            Some(1440.0)
        );
        assert_eq!(daylight_minutes(95.0, 0.0, datetime!(2026-06-21 12:00 UTC)), None);
    }
}
