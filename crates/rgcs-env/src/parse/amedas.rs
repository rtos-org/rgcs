//! JMA AMeDAS (`bosai` JSON, not a contractual API): latest time, station table, map file.
//! No coordinates are ever sent; the nearest station is picked locally.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use super::{json, number, timestamp_ms, ParseError};
use crate::{Class, FactorKind, Reading, SourceId};

/// Shown with every AMeDAS reading (JMA terms of use).
pub const ATTRIBUTION: &str = "出典: 気象庁ホームページ";
const EARTH_RADIUS_KM: f64 = 6371.0;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Station {
    /// AMeDAS station number (the map file's key).
    pub id: String,
    /// `kjName` (untrusted text).
    pub name: String,
    pub lat: f64,
    pub lon: f64,
}

/// `latest_time.txt` (`2026-10-25T12:10:00+09:00`) → the map file stamp `20261025121000`
/// (JST digits, as the file name uses them).
pub fn amedas_latest(body: &str) -> Result<String, ParseError> {
    let s = body.trim();
    timestamp_ms(s).ok_or(ParseError::Time("latest_time"))?;
    let stamp: String = s
        .get(..19)
        .ok_or(ParseError::Time("latest_time"))?
        .chars()
        .filter(char::is_ascii_digit)
        .collect();
    if stamp.len() != 14 {
        return Err(ParseError::Time("latest_time"));
    }
    Ok(stamp)
}

/// `[degrees, minutes]` → decimal degrees.
fn degrees(v: Option<&Value>) -> Option<f64> {
    let parts = v?.as_array()?;
    let (d, m) = (number(parts.first())?, number(parts.get(1))?);
    Some(d + m / 60.0)
}

fn station(id: &str, v: &Value) -> Option<Station> {
    let (lat, lon) = (degrees(v.get("lat"))?, degrees(v.get("lon"))?);
    let name = v
        .get("kjName")
        .and_then(Value::as_str)
        .unwrap_or("")
        .chars()
        .take(40)
        .collect();
    let valid = lat.abs() <= 90.0 && lon.abs() <= 180.0;
    valid.then(|| Station {
        id: id.to_string(),
        name,
        lat,
        lon,
    })
}

/// `amedastable.json` → stations. Malformed entries are skipped; none usable is an error.
pub fn amedas_table(body: &str) -> Result<Vec<Station>, ParseError> {
    let v = json(body)?;
    let table = v.as_object().ok_or(ParseError::Shape("expected an object"))?;
    let stations: Vec<Station> = table.iter().filter_map(|(id, s)| station(id, s)).collect();
    if stations.is_empty() {
        return Err(ParseError::Empty);
    }
    Ok(stations)
}

fn distance_km(lat1: f64, lon1: f64, lat2: f64, lon2: f64) -> f64 {
    let (p1, p2) = (lat1.to_radians(), lat2.to_radians());
    let dp = p2 - p1;
    let dl = (lon2 - lon1).to_radians();
    let a = (dp / 2.0).sin().powi(2) + p1.cos() * p2.cos() * (dl / 2.0).sin().powi(2);
    2.0 * EARTH_RADIUS_KM * a.sqrt().min(1.0).asin()
}

/// The closest station within `max_km`, with its distance in km.
pub fn nearest_station(stations: &[Station], lat: f64, lon: f64, max_km: f64) -> Option<(Station, f64)> {
    stations
        .iter()
        .map(|s| (s, distance_km(lat, lon, s.lat, s.lon)))
        .filter(|(_, km)| km.is_finite() && *km <= max_km)
        .min_by(|a, b| a.1.total_cmp(&b.1))
        .map(|(s, km)| (s.clone(), km))
}

/// `[value, quality]`; only quality flag 0 counts.
fn good(obs: &Map<String, Value>, key: &str) -> Option<f64> {
    let pair = obs.get(key)?.as_array()?;
    let flag = pair.get(1)?.as_i64()?;
    (flag == 0).then(|| number(pair.first())).flatten()
}

/// The station's entry in `map/{stamp}.json` → `Observed` temp, wind, precipitation (mm/h).
pub fn amedas_map(body: &str, station: &Station, at_ms: u64) -> Result<Vec<Reading>, ParseError> {
    let v = json(body)?;
    let obs = v
        .as_object()
        .ok_or(ParseError::Shape("expected an object"))?
        .get(&station.id)
        .and_then(Value::as_object)
        .ok_or(ParseError::Shape("station not in map"))?;
    let source_note = format!("{ATTRIBUTION} — {}", station.name);
    let wind_note = match good(obs, "windDirection") {
        // 16-point code, 1 = NNE … 16 = N, 0 = calm.
        Some(code) if code > 0.0 => format!("{source_note} — {:.0}°", (code * 22.5) % 360.0),
        _ => source_note.clone(),
    };
    let values = [
        (FactorKind::Temp, good(obs, "temp"), &source_note),
        (FactorKind::Wind, good(obs, "wind"), &wind_note),
        (
            FactorKind::Precip,
            good(obs, "precipitation10m").map(|p| p * 6.0),
            &source_note,
        ),
    ];
    let readings: Vec<Reading> = values
        .into_iter()
        .filter_map(|(kind, value, note)| {
            let note = Some(note.clone());
            Some(Reading {
                source: SourceId::JmaAmedas,
                class: Class::Observed,
                kind,
                value: value?,
                at_ms,
                note,
            })
        })
        .collect();
    if readings.is_empty() {
        return Err(ParseError::Empty);
    }
    Ok(readings)
}
