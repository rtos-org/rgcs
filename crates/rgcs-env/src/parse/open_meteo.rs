//! Open-Meteo `/v1/forecast` `current` block → `Forecast` readings (model data).

use serde_json::{Map, Value};

use super::{json, number, timestamp_ms, ParseError};
use crate::{Class, FactorKind, Reading, SourceId};

const FIELDS: [(&str, FactorKind); 4] = [
    ("wind_speed_10m", FactorKind::Wind),
    ("wind_gusts_10m", FactorKind::Gust),
    ("temperature_2m", FactorKind::Temp),
    ("precipitation", FactorKind::Precip),
];

/// `None` when absent, `Err` when present but not a number.
fn value(cur: &Map<String, Value>, key: &str) -> Result<Option<f64>, ParseError> {
    match cur.get(key) {
        None | Some(Value::Null) => Ok(None),
        some => number(some).map(Some).ok_or(ParseError::Shape("current value")),
    }
}

/// Wind must be m/s (`wind_speed_unit=ms`); anything else would be misread.
fn check_units(v: &Value) -> Result<(), ParseError> {
    let units = v.get("current_units").and_then(Value::as_object);
    for key in ["wind_speed_10m", "wind_gusts_10m"] {
        if let Some(u) = units.and_then(|u| u.get(key)).and_then(Value::as_str) {
            if u != "m/s" {
                return Err(ParseError::Shape("wind unit is not m/s"));
            }
        }
    }
    Ok(())
}

pub fn open_meteo(body: &str) -> Result<Vec<Reading>, ParseError> {
    let v = json(body)?;
    check_units(&v)?;
    let cur = v
        .get("current")
        .and_then(Value::as_object)
        .ok_or(ParseError::Shape("current"))?;
    let at_ms = cur
        .get("time")
        .and_then(Value::as_str)
        .and_then(timestamp_ms)
        .ok_or(ParseError::Time("current.time"))?;
    // `precipitation` is the sum over the preceding `interval` seconds → mm/h.
    let per_hour = number(cur.get("interval"))
        .filter(|s| *s > 0.0)
        .map_or(1.0, |s| 3600.0 / s);
    let dir = number(cur.get("wind_direction_10m")).map(|d| format!("{d:.0}°"));
    let mut out = Vec::new();
    for (key, kind) in FIELDS {
        let Some(raw) = value(cur, key)? else { continue };
        let value = if kind == FactorKind::Precip {
            raw * per_hour
        } else {
            raw
        };
        let note = if kind == FactorKind::Wind {
            dir.clone()
        } else {
            None
        };
        out.push(Reading {
            source: SourceId::OpenMeteo,
            class: Class::Forecast,
            kind,
            value,
            at_ms,
            note,
        });
    }
    if out.is_empty() {
        return Err(ParseError::Empty);
    }
    Ok(out)
}
