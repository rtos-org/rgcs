//! External factors, server side: source defaults, labels and
//! terms, settings validation, the vehicle / local readings (wind, GNSS, WMM declination,
//! daylight), and the mapping of `rgcs_env` fusion onto the `rgcs_core` wire types (by variant
//! name, never by order: the two `Class` enums sort the opposite way).

use rgcs_core::{
    EnvClass, EnvFactor, EnvLevel, EnvReading, EnvSettings, EnvThresholds, VehicleKind, VehicleState,
};
use rgcs_env::{Class, FactorKind, Fused, FusedFactor, Level, Rated, Reading, SourceId, Thresholds};
use serde::Deserialize;
use time::OffsetDateTime;

pub const INTERVAL_S: std::ops::RangeInclusive<u32> = 60..=86_400;
pub const TIMEOUT_MS: std::ops::RangeInclusive<u32> = 1000..=30_000;
/// At most this many distinct rounded cells are fetched (fixed values: Location).
pub const MAX_CELLS: usize = 4;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SourceCfg {
    pub enabled: bool,
    pub interval_s: u32,
    pub timeout_ms: u32,
}

/// Fixed values: Env defaults.
pub fn default_cfg(id: SourceId) -> SourceCfg {
    let (interval_s, enabled) = match id {
        SourceId::SwpcKp | SourceId::SwpcAlerts => (900, true),
        SourceId::SwpcKp1m => (300, true),
        SourceId::SwpcKpForecast => (3600, true),
        SourceId::GfzKp => (3600, false),
        SourceId::Openweathermap => (600, false),
        _ => (600, true),
    };
    SourceCfg {
        enabled,
        interval_s,
        timeout_ms: 8000,
    }
}

pub fn label(id: SourceId) -> &'static str {
    match id {
        SourceId::OpenMeteo => "Open-Meteo",
        SourceId::JmaAmedas => "JMA AMeDAS",
        SourceId::SwpcKp => "NOAA SWPC Kp (observed)",
        SourceId::SwpcKp1m => "NOAA SWPC Kp (1-minute estimate)",
        SourceId::SwpcKpForecast => "NOAA SWPC Kp (forecast)",
        SourceId::SwpcAlerts => "NOAA SWPC alerts",
        SourceId::GfzKp => "GFZ Kp",
        SourceId::Openweathermap => "OpenWeatherMap",
        SourceId::Vehicle => "Vehicle",
        SourceId::Local => "Computed locally",
    }
}

pub fn terms(id: SourceId) -> &'static str {
    match id {
        SourceId::OpenMeteo => {
            "Free API for non-commercial use only (commercial use needs an API key plan). CC BY 4.0"
        }
        SourceId::JmaAmedas => {
            "Source: Japan Meteorological Agency website (the bosai JSON is not a contracted API)"
        }
        SourceId::SwpcKp | SourceId::SwpcKp1m | SourceId::SwpcKpForecast | SourceId::SwpcAlerts => {
            "NOAA SWPC (US government public data)"
        }
        SourceId::GfzKp => "GFZ Potsdam Kp (CC BY 4.0)",
        SourceId::Openweathermap => "OpenWeatherMap terms of use (API key required)",
        SourceId::Vehicle | SourceId::Local => "",
    }
}

/// `PUT /api/env/sources/{id}` body.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SourcePut {
    pub enabled: Option<bool>,
    pub interval_s: Option<u32>,
    pub timeout_ms: Option<u32>,
}

pub fn apply_source_put(cur: SourceCfg, put: &SourcePut) -> Result<SourceCfg, String> {
    let next = SourceCfg {
        enabled: put.enabled.unwrap_or(cur.enabled),
        interval_s: put.interval_s.unwrap_or(cur.interval_s),
        timeout_ms: put.timeout_ms.unwrap_or(cur.timeout_ms),
    };
    if !INTERVAL_S.contains(&next.interval_s) {
        return Err(format!("interval_s must be within {INTERVAL_S:?}"));
    }
    if !TIMEOUT_MS.contains(&next.timeout_ms) {
        return Err(format!("timeout_ms must be within {TIMEOUT_MS:?}"));
    }
    Ok(next)
}

/// `PUT /api/env/settings` body: any subset, whole threshold tables.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SettingsPut {
    pub rounding_deg: Option<f64>,
    pub copter: Option<EnvThresholds>,
    pub quadplane: Option<EnvThresholds>,
    pub plane: Option<EnvThresholds>,
}

fn core_thresholds(t: &Thresholds) -> EnvThresholds {
    EnvThresholds {
        wind: t.wind,
        gust: t.gust,
        precip: t.precip,
        temp_low: t.temp_low,
        temp_high: t.temp_high,
        kp: t.kp,
        declination: t.declination,
        sats: t.sats,
        hdop: t.hdop,
        sunset_min: t.sunset_min,
    }
}

pub fn env_thresholds(t: &EnvThresholds) -> Thresholds {
    Thresholds {
        wind: t.wind,
        gust: t.gust,
        precip: t.precip,
        temp_low: t.temp_low,
        temp_high: t.temp_high,
        kp: t.kp,
        declination: t.declination,
        sats: t.sats,
        hdop: t.hdop,
        sunset_min: t.sunset_min,
    }
}

pub fn default_settings() -> EnvSettings {
    EnvSettings {
        rounding_deg: rgcs_env::location::DEFAULT_STEP,
        copter: core_thresholds(&Thresholds::copter()),
        quadplane: core_thresholds(&Thresholds::quadplane()),
        plane: core_thresholds(&Thresholds::plane()),
    }
}

fn valid_rounding(step: f64) -> bool {
    rgcs_env::location::ROUNDING_STEPS
        .iter()
        .any(|(s, _)| (s - step).abs() < 1e-9)
}

fn finite(t: &EnvThresholds) -> bool {
    let all = [
        t.wind,
        t.gust,
        t.precip,
        t.temp_low,
        t.temp_high,
        t.kp,
        t.declination,
        t.sats,
        t.hdop,
        t.sunset_min,
    ];
    all.iter().flatten().all(|v| v.is_finite())
}

pub fn validate_settings(s: &EnvSettings) -> Result<(), String> {
    if !valid_rounding(s.rounding_deg) {
        return Err("rounding_deg must be 0.01, 0.05 or 0.1".into());
    }
    if ![&s.copter, &s.quadplane, &s.plane].into_iter().all(finite) {
        return Err("thresholds must be finite numbers".into());
    }
    Ok(())
}

pub fn apply_settings_put(cur: &EnvSettings, put: SettingsPut) -> Result<EnvSettings, String> {
    let next = EnvSettings {
        rounding_deg: put.rounding_deg.unwrap_or(cur.rounding_deg),
        copter: put.copter.unwrap_or_else(|| cur.copter.clone()),
        quadplane: put.quadplane.unwrap_or_else(|| cur.quadplane.clone()),
        plane: put.plane.unwrap_or_else(|| cur.plane.clone()),
    };
    validate_settings(&next).map(|_| next)
}

/// The thresholds of the first vehicle's airframe (copter when none).
pub fn thresholds_for(settings: &EnvSettings, vehicles: &[VehicleState]) -> Thresholds {
    let t = match vehicles.first() {
        Some(v) if v.kind == VehicleKind::Plane && v.vtol => &settings.quadplane,
        Some(v) if v.kind == VehicleKind::Plane => &settings.plane,
        _ => &settings.copter,
    };
    env_thresholds(t)
}

/// Positions that choose cells: vehicles with a 3D fix, else their homes.
pub fn positions(vehicles: &[VehicleState]) -> Vec<(f64, f64)> {
    let fixed: Vec<(f64, f64)> = vehicles
        .iter()
        .filter(|v| v.gps.fix >= 3 && (v.lat != 0.0 || v.lon != 0.0))
        .map(|v| (v.lat, v.lon))
        .collect();
    if !fixed.is_empty() {
        return fixed;
    }
    vehicles
        .iter()
        .filter_map(|v| v.home.as_ref().map(|h| (h.lat, h.lon)))
        .collect()
}

/// Distinct rounded cells, at most [`MAX_CELLS`].
pub fn cells(positions: &[(f64, f64)], step: f64) -> Vec<crate::env_fetch::Cell> {
    positions
        .iter()
        .map(|&(lat, lon)| {
            let (lat, lon) = rgcs_env::round_cell(lat, lon, step);
            crate::env_fetch::Cell { lat, lon }
        })
        .fold(Vec::new(), |acc, c| {
            if acc.contains(&c) || acc.len() >= MAX_CELLS {
                acc
            } else {
                acc.into_iter().chain(std::iter::once(c)).collect()
            }
        })
}

fn measured(source: SourceId, kind: FactorKind, value: f64, at_ms: u64, note: Option<String>) -> Reading {
    Reading {
        source,
        class: Class::Measured,
        kind,
        value,
        at_ms,
        note,
    }
}

/// `WIND` from the guard tap.
pub fn wind_reading(dir_deg: f32, speed: f32, at_ms: u64) -> Reading {
    let note = Some(format!("{:.0}°", dir_deg));
    measured(SourceId::Vehicle, FactorKind::Wind, f64::from(speed), at_ms, note)
}

/// GNSS sats / hdop of every vehicle with a GPS that is not link-lost.
pub fn gnss_readings(vehicles: &[VehicleState], now_ms: u64) -> Vec<Reading> {
    vehicles
        .iter()
        .filter(|v| v.gps.fix >= 1 && v.link != rgcs_core::LinkStatus::Lost)
        .flat_map(|v| {
            let sats = Reading::gnss_sats(SourceId::Vehicle, f64::from(v.gps.sats), now_ms);
            let hdop = v
                .gps
                .hdop
                .map(|h| Reading::gnss_hdop(SourceId::Vehicle, f64::from(h), now_ms));
            std::iter::once(sats).chain(hdop)
        })
        .collect()
}

/// |WMM − `COMPASS_DEC`| (deg; the parameter is in radians), skipped with `COMPASS_AUTODEC = 1`
/// or an unknown `COMPASS_DEC`.
pub fn declination_reading(
    v: &VehicleState,
    compass_dec_rad: Option<f32>,
    autodec: Option<f32>,
    now_ms: u64,
) -> Option<Reading> {
    if autodec.is_some_and(|a| a.round() == 1.0) || (v.lat == 0.0 && v.lon == 0.0) {
        return None;
    }
    let dec = f64::from(compass_dec_rad?).to_degrees();
    let wmm = rgcs_env::declination_deg(v.lat, v.lon, f64::from(v.alt_msl), date_of(now_ms)?)?;
    let diff = (wmm - dec).rem_euclid(360.0);
    let value = diff.min(360.0 - diff);
    let note = Some(format!("WMM {wmm:.1}° / COMPASS_DEC {dec:.1}°"));
    Some(measured(
        SourceId::Local,
        FactorKind::Declination,
        value,
        now_ms,
        note,
    ))
}

pub fn daylight_reading(lat: f64, lon: f64, now_ms: u64) -> Option<Reading> {
    let now = OffsetDateTime::from_unix_timestamp_nanos(i128::from(now_ms) * 1_000_000).ok()?;
    let minutes = rgcs_env::daylight_minutes(lat, lon, now)?;
    Some(measured(
        SourceId::Local,
        FactorKind::Daylight,
        minutes,
        now_ms,
        None,
    ))
}

fn date_of(now_ms: u64) -> Option<time::Date> {
    OffsetDateTime::from_unix_timestamp_nanos(i128::from(now_ms) * 1_000_000)
        .ok()
        .map(|t| t.date())
}

pub fn class(c: Class) -> EnvClass {
    match c {
        Class::Measured => EnvClass::Measured,
        Class::Observed => EnvClass::Observed,
        Class::Nowcast => EnvClass::Nowcast,
        Class::Forecast => EnvClass::Forecast,
    }
}

pub fn level(l: Level) -> EnvLevel {
    match l {
        Level::Ok => EnvLevel::Ok,
        Level::Warn => EnvLevel::Warn,
        Level::Strong => EnvLevel::Strong,
    }
}

pub fn ext_level(l: Level) -> rgcs_guard::ExtLevel {
    match l {
        Level::Ok => rgcs_guard::ExtLevel::Ok,
        Level::Warn => rgcs_guard::ExtLevel::Warn,
        Level::Strong => rgcs_guard::ExtLevel::Strong,
    }
}

/// Display id of a reading's source: local readings name what computed them.
fn source_name(r: &Reading) -> String {
    match (r.source, r.kind) {
        (SourceId::Local, FactorKind::Declination) => "wmm".into(),
        (SourceId::Local, FactorKind::Daylight) => "sun".into(),
        (s, _) => s.as_str().into(),
    }
}

fn reading(r: &Rated) -> EnvReading {
    EnvReading {
        source: source_name(&r.reading),
        class: class(r.reading.class),
        value: r.reading.value,
        at_ms: r.reading.at_ms,
        fresh: r.fresh,
        note: r.reading.note.clone(),
    }
}

fn factor(f: &FusedFactor) -> EnvFactor {
    EnvFactor {
        kind: f.kind.as_str().into(),
        level: level(f.level),
        unit: f.kind.unit().into(),
        value: f.value.as_ref().map(reading),
        primary: f.primary.as_ref().map(reading),
        readings: f.readings.iter().map(reading).collect(),
        disagree: f.disagree,
    }
}

pub fn factors(fused: &Fused) -> Vec<EnvFactor> {
    fused.factors.iter().map(factor).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The UI translates names and terms by source id; the server's own text is the English
    /// fallback (and what the AI tools see).
    #[test]
    fn source_names_and_terms_are_english() {
        let all = SourceId::EXTERNAL
            .into_iter()
            .chain([SourceId::Vehicle, SourceId::Local]);
        for id in all {
            for s in [label(id), terms(id)] {
                assert!(s.is_ascii(), "{id:?}: {s}");
            }
        }
        assert_eq!(label(SourceId::JmaAmedas), "JMA AMeDAS");
    }
}
