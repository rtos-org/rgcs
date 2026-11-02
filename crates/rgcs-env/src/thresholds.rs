//! Per-airframe `[warn, strong]` limits (fixed values: Thresholds) and rating one reading.

use serde::{Deserialize, Serialize};

use crate::{FactorKind, Reading};

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Level {
    Ok,
    Warn,
    Strong,
}

/// `[warn, strong]` per factor; mirrors `rgcs_core::EnvThresholds`.
/// Wind / gust / precip / temp_high / kp / declination / hdop: at or above.
/// temp_low / sunset_min: at or below. sats: below.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Thresholds {
    pub wind: [f64; 2],
    pub gust: [f64; 2],
    pub precip: [f64; 2],
    pub temp_low: [f64; 2],
    pub temp_high: [f64; 2],
    pub kp: [f64; 2],
    pub declination: [f64; 2],
    pub sats: [f64; 2],
    pub hdop: [f64; 2],
    pub sunset_min: [f64; 2],
}

impl Thresholds {
    fn with_wind(wind: [f64; 2], gust: [f64; 2]) -> Thresholds {
        Thresholds {
            wind,
            gust,
            precip: [0.5, 2.0],
            temp_low: [0.0, -10.0],
            temp_high: [35.0, 40.0],
            kp: [5.0, 7.0],
            declination: [2.0, 5.0],
            sats: [10.0, 6.0],
            hdop: [2.0, 4.0],
            sunset_min: [30.0, 10.0],
        }
    }

    pub fn copter() -> Thresholds {
        Thresholds::with_wind([8.4, 12.0], [10.5, 15.0])
    }

    pub fn quadplane() -> Thresholds {
        Thresholds::with_wind([10.5, 15.0], [12.6, 18.0])
    }

    pub fn plane() -> Thresholds {
        Thresholds::with_wind([12.6, 18.0], [15.4, 22.0])
    }
}

fn at_or_above(v: f64, [warn, strong]: [f64; 2]) -> Level {
    if v >= strong {
        Level::Strong
    } else if v >= warn {
        Level::Warn
    } else {
        Level::Ok
    }
}

fn at_or_below(v: f64, [warn, strong]: [f64; 2]) -> Level {
    if v <= strong {
        Level::Strong
    } else if v <= warn {
        Level::Warn
    } else {
        Level::Ok
    }
}

fn below(v: f64, [warn, strong]: [f64; 2]) -> Level {
    if v < strong {
        Level::Strong
    } else if v < warn {
        Level::Warn
    } else {
        Level::Ok
    }
}

/// The level of one reading on its own.
pub fn rate(r: &Reading, th: &Thresholds) -> Level {
    let v = r.value;
    if !v.is_finite() {
        return Level::Ok;
    }
    match r.kind {
        FactorKind::Wind => at_or_above(v, th.wind),
        FactorKind::Gust => at_or_above(v, th.gust),
        FactorKind::Precip => at_or_above(v, th.precip),
        FactorKind::Temp => at_or_below(v, th.temp_low).max(at_or_above(v, th.temp_high)),
        FactorKind::Kp => at_or_above(v, th.kp),
        FactorKind::Declination => at_or_above(v.abs(), th.declination),
        FactorKind::Gnss if r.is_hdop() => at_or_above(v, th.hdop),
        FactorKind::Gnss => below(v, th.sats),
        FactorKind::Daylight => at_or_below(v, th.sunset_min),
    }
}

/// How bad a reading is within its level (higher = worse), for picking the value shown.
pub(crate) fn severity(r: &Reading, th: &Thresholds) -> f64 {
    match r.kind {
        FactorKind::Temp => (th.temp_low[0] - r.value).max(r.value - th.temp_high[0]),
        FactorKind::Declination => r.value.abs(),
        FactorKind::Gnss if r.is_hdop() => r.value,
        FactorKind::Gnss | FactorKind::Daylight => -r.value,
        _ => r.value,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Class, SourceId};

    fn rating(kind: FactorKind, value: f64) -> Level {
        let r = Reading {
            source: SourceId::Local,
            class: Class::Measured,
            kind,
            value,
            at_ms: 0,
            note: None,
        };
        rate(&r, &Thresholds::copter())
    }

    #[test]
    fn limits_are_inclusive_where_the_table_says_so() {
        assert_eq!(rating(FactorKind::Wind, 8.39), Level::Ok);
        assert_eq!(rating(FactorKind::Wind, 8.4), Level::Warn);
        assert_eq!(rating(FactorKind::Wind, 12.0), Level::Strong);
        assert_eq!(rating(FactorKind::Temp, 0.0), Level::Warn);
        assert_eq!(rating(FactorKind::Temp, -10.0), Level::Strong);
        assert_eq!(rating(FactorKind::Temp, 20.0), Level::Ok);
        assert_eq!(rating(FactorKind::Declination, -5.5), Level::Strong);
        assert_eq!(rating(FactorKind::Kp, f64::NAN), Level::Ok);
    }

    #[test]
    fn sats_are_strictly_below_and_hdop_at_or_above() {
        assert_eq!(
            rate(
                &Reading::gnss_sats(SourceId::Vehicle, 10.0, 0),
                &Thresholds::copter()
            ),
            Level::Ok
        );
        assert_eq!(
            rate(
                &Reading::gnss_sats(SourceId::Vehicle, 9.0, 0),
                &Thresholds::copter()
            ),
            Level::Warn
        );
        assert_eq!(
            rate(
                &Reading::gnss_sats(SourceId::Vehicle, 5.0, 0),
                &Thresholds::copter()
            ),
            Level::Strong
        );
        assert_eq!(
            rate(
                &Reading::gnss_hdop(SourceId::Vehicle, 4.0, 0),
                &Thresholds::copter()
            ),
            Level::Strong
        );
        assert_eq!(
            rate(
                &Reading::gnss_hdop(SourceId::Vehicle, 1.9, 0),
                &Thresholds::copter()
            ),
            Level::Ok
        );
    }
}
