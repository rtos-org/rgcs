//! OpenWeatherMap `/data/2.5/weather` (`units=metric`) → `Forecast` readings (model data).

use serde_json::Value;

use super::{json, number, ParseError};
use crate::{Class, FactorKind, Reading, SourceId};

/// `None` when absent, `Err` when present but not a number.
fn opt(v: &Value, path: [&str; 2]) -> Result<Option<f64>, ParseError> {
    match v.get(path[0]).and_then(|o| o.get(path[1])) {
        None | Some(Value::Null) => Ok(None),
        some => number(some).map(Some).ok_or(ParseError::Shape("owm value")),
    }
}

pub fn owm(body: &str) -> Result<Vec<Reading>, ParseError> {
    let v = json(body)?;
    if !v.is_object() {
        return Err(ParseError::Shape("expected an object"));
    }
    let dt = number(v.get("dt"))
        .filter(|t| *t >= 0.0)
        .ok_or(ParseError::Time("dt"))?;
    let at_ms = (dt * 1000.0) as u64;
    let wind = opt(&v, ["wind", "speed"])?;
    let gust = opt(&v, ["wind", "gust"])?;
    let temp = opt(&v, ["main", "temp"])?;
    if wind.is_none() && temp.is_none() {
        return Err(ParseError::Empty);
    }
    // No `rain` / `snow` block means none fell in the last hour.
    let precip = opt(&v, ["rain", "1h"])?.unwrap_or(0.0) + opt(&v, ["snow", "1h"])?.unwrap_or(0.0);
    let reading = |kind, value| Reading {
        source: SourceId::Openweathermap,
        class: Class::Forecast,
        kind,
        value,
        at_ms,
        note: None,
    };
    let values = [
        (FactorKind::Wind, wind),
        (FactorKind::Gust, gust),
        (FactorKind::Temp, temp),
        (FactorKind::Precip, Some(precip)),
    ];
    Ok(values
        .into_iter()
        .filter_map(|(k, v)| v.map(|v| reading(k, v)))
        .collect())
}
