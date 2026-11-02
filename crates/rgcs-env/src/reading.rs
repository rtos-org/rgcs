//! One reading from one source, its class (display priority) and freshness.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SourceId {
    OpenMeteo,
    JmaAmedas,
    SwpcKp,
    #[serde(rename = "swpc_kp_1m")]
    SwpcKp1m,
    SwpcKpForecast,
    SwpcAlerts,
    GfzKp,
    Openweathermap,
    /// The vehicle's own telemetry (`WIND`, `GPS_RAW_INT`, …).
    Vehicle,
    /// Computed on the server (WMM, sunrise / sunset).
    Local,
}

impl SourceId {
    /// Every source fetched from outside, in settings-page order.
    pub const EXTERNAL: [SourceId; 8] = [
        SourceId::OpenMeteo,
        SourceId::JmaAmedas,
        SourceId::SwpcKp,
        SourceId::SwpcKp1m,
        SourceId::SwpcKpForecast,
        SourceId::SwpcAlerts,
        SourceId::GfzKp,
        SourceId::Openweathermap,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            SourceId::OpenMeteo => "open_meteo",
            SourceId::JmaAmedas => "jma_amedas",
            SourceId::SwpcKp => "swpc_kp",
            SourceId::SwpcKp1m => "swpc_kp_1m",
            SourceId::SwpcKpForecast => "swpc_kp_forecast",
            SourceId::SwpcAlerts => "swpc_alerts",
            SourceId::GfzKp => "gfz_kp",
            SourceId::Openweathermap => "openweathermap",
            SourceId::Vehicle => "vehicle",
            SourceId::Local => "local",
        }
    }

    pub fn parse(id: &str) -> Option<SourceId> {
        [SourceId::Vehicle, SourceId::Local]
            .into_iter()
            .chain(SourceId::EXTERNAL)
            .find(|s| s.as_str() == id)
    }

    pub fn is_external(self) -> bool {
        !matches!(self, SourceId::Vehicle | SourceId::Local)
    }

    /// Whether a request to this source carries a (rounded) location. AMeDAS picks its
    /// station locally and sends none.
    pub fn uses_location(self) -> bool {
        matches!(self, SourceId::OpenMeteo | SourceId::Openweathermap)
    }

    /// Whether the source yields readings (SWPC alerts yield notes only).
    pub fn has_readings(self) -> bool {
        self != SourceId::SwpcAlerts
    }
}

/// Reading class. Declared low → high so the derived `Ord` makes `Measured` the highest.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Class {
    Forecast,
    Nowcast,
    Observed,
    Measured,
}

impl Class {
    pub fn as_str(self) -> &'static str {
        match self {
            Class::Measured => "measured",
            Class::Observed => "observed",
            Class::Nowcast => "nowcast",
            Class::Forecast => "forecast",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FactorKind {
    Wind,
    Gust,
    Precip,
    Temp,
    Kp,
    /// |WMM − `COMPASS_DEC`| in degrees.
    Declination,
    /// Satellite count or HDOP; see [`GNSS_HDOP_NOTE`].
    Gnss,
    /// Minutes of daylight left (0 when dark).
    Daylight,
}

impl FactorKind {
    pub const ALL: [FactorKind; 8] = [
        FactorKind::Wind,
        FactorKind::Gust,
        FactorKind::Precip,
        FactorKind::Temp,
        FactorKind::Kp,
        FactorKind::Declination,
        FactorKind::Gnss,
        FactorKind::Daylight,
    ];

    pub fn as_str(self) -> &'static str {
        match self {
            FactorKind::Wind => "wind",
            FactorKind::Gust => "gust",
            FactorKind::Precip => "precip",
            FactorKind::Temp => "temp",
            FactorKind::Kp => "kp",
            FactorKind::Declination => "declination",
            FactorKind::Gnss => "gnss",
            FactorKind::Daylight => "daylight",
        }
    }

    pub fn unit(self) -> &'static str {
        match self {
            FactorKind::Wind | FactorKind::Gust => "m/s",
            FactorKind::Precip => "mm/h",
            FactorKind::Temp => "°C",
            FactorKind::Declination => "°",
            FactorKind::Daylight => "min",
            FactorKind::Kp | FactorKind::Gnss => "",
        }
    }
}

/// The note that marks a `Gnss` reading as HDOP; any other `Gnss` reading is a sats count.
pub const GNSS_HDOP_NOTE: &str = "hdop";
pub const GNSS_SATS_NOTE: &str = "sats";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Reading {
    pub source: SourceId,
    pub class: Class,
    pub kind: FactorKind,
    pub value: f64,
    /// When the value was valid (observation / model time); the fetch time for forecasts
    /// whose valid time lies ahead (the valid time is then in `note`).
    pub at_ms: u64,
    pub note: Option<String>,
}

const MIN: u64 = 60_000;

impl Reading {
    pub fn gnss_sats(source: SourceId, sats: f64, at_ms: u64) -> Reading {
        Reading::gnss(source, sats, at_ms, GNSS_SATS_NOTE)
    }

    pub fn gnss_hdop(source: SourceId, hdop: f64, at_ms: u64) -> Reading {
        Reading::gnss(source, hdop, at_ms, GNSS_HDOP_NOTE)
    }

    fn gnss(source: SourceId, value: f64, at_ms: u64, note: &str) -> Reading {
        Reading {
            source,
            class: Class::Measured,
            kind: FactorKind::Gnss,
            value,
            at_ms,
            note: Some(note.to_string()),
        }
    }

    pub fn is_hdop(&self) -> bool {
        self.kind == FactorKind::Gnss && self.note.as_deref() == Some(GNSS_HDOP_NOTE)
    }

    /// How long the reading counts: Measured 60 s, Observed 30 min (Kp 4 h),
    /// Nowcast 30 min, Forecast 3 h.
    pub fn fresh_for_ms(&self) -> u64 {
        match (self.class, self.kind) {
            (Class::Measured, _) => MIN,
            (Class::Observed, FactorKind::Kp) => 240 * MIN,
            (Class::Observed | Class::Nowcast, _) => 30 * MIN,
            (Class::Forecast, _) => 180 * MIN,
        }
    }

    /// Fresh at `now_ms`. A reading stamped in the future counts as fresh.
    pub fn is_fresh(&self, now_ms: u64) -> bool {
        self.value.is_finite() && now_ms.saturating_sub(self.at_ms) <= self.fresh_for_ms()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn measured_is_the_highest_class_and_ids_are_snake_case() {
        assert!(Class::Measured > Class::Observed && Class::Nowcast > Class::Forecast);
        assert_eq!(serde_json::to_value(SourceId::SwpcKp1m).unwrap(), "swpc_kp_1m");
        assert_eq!(serde_json::to_value(Class::Nowcast).unwrap(), "nowcast");
        for s in SourceId::EXTERNAL {
            assert_eq!(serde_json::to_value(s).unwrap(), s.as_str());
            assert_eq!(SourceId::parse(s.as_str()), Some(s));
        }
        assert_eq!(SourceId::parse("vehicle"), Some(SourceId::Vehicle));
        assert_eq!(SourceId::parse("nope"), None);
    }

    #[test]
    fn freshness_windows_follow_the_class() {
        let r = |class, kind| Reading {
            source: SourceId::Local,
            class,
            kind,
            value: 1.0,
            at_ms: 0,
            note: None,
        };
        assert!(r(Class::Measured, FactorKind::Wind).is_fresh(60_000));
        assert!(!r(Class::Measured, FactorKind::Wind).is_fresh(60_001));
        assert!(r(Class::Observed, FactorKind::Kp).is_fresh(4 * 3_600_000));
        assert!(!r(Class::Observed, FactorKind::Wind).is_fresh(30 * MIN + 1));
        assert!(r(Class::Forecast, FactorKind::Wind).is_fresh(3 * 3_600_000));
        let nan = Reading {
            value: f64::NAN,
            ..r(Class::Measured, FactorKind::Wind)
        };
        assert!(!nan.is_fresh(0));
    }
}
