//! One parser per source. No network, no clock beyond the arguments, no unchecked indexing:
//! a format change is a `ParseError` (a source failure), never a panic.

mod amedas;
mod gfz;
mod open_meteo;
mod owm;
mod swpc;
mod time_tag;

pub use amedas::{amedas_latest, amedas_map, amedas_table, nearest_station, Station};
pub use gfz::gfz_kp;
pub use open_meteo::open_meteo;
pub use owm::owm;
pub use swpc::{swpc_alerts, swpc_kp, swpc_kp_1m, swpc_kp_forecast, Note};
pub use time_tag::timestamp_ms;

use serde_json::{Map, Value};

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ParseError {
    #[error("not JSON: {0}")]
    Json(String),
    #[error("unexpected shape: {0}")]
    Shape(&'static str),
    #[error("bad time: {0}")]
    Time(&'static str),
    #[error("no usable values")]
    Empty,
}

pub(crate) fn json(body: &str) -> Result<Value, ParseError> {
    // Only the error category: the message would quote the (untrusted) body.
    serde_json::from_str(body).map_err(|e| ParseError::Json(format!("{:?}", e.classify())))
}

/// A finite number, or a string holding one (SWPC sends both).
pub(crate) fn number(v: Option<&Value>) -> Option<f64> {
    let n = match v? {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => s.trim().parse::<f64>().ok(),
        _ => None,
    }?;
    n.is_finite().then_some(n)
}

/// Case-insensitive field lookup (`Kp` vs `kp`).
pub(crate) fn field<'a>(row: &'a Map<String, Value>, key: &str) -> Option<&'a Value> {
    row.get(key).or_else(|| {
        row.iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(key))
            .map(|(_, v)| v)
    })
}

/// SWPC tables come either as `[[header…], [row…], …]` or as `[{…}, …]`; both become objects.
pub(crate) fn table(value: &Value) -> Result<Vec<Map<String, Value>>, ParseError> {
    let rows = value.as_array().ok_or(ParseError::Shape("expected an array"))?;
    let first = rows.first().ok_or(ParseError::Empty)?;
    if first.is_object() {
        return rows
            .iter()
            .map(|r| r.as_object().cloned().ok_or(ParseError::Shape("mixed rows")))
            .collect();
    }
    let header: Vec<String> = first
        .as_array()
        .ok_or(ParseError::Shape("expected rows"))?
        .iter()
        .map(|h| h.as_str().map(str::to_string).ok_or(ParseError::Shape("header")))
        .collect::<Result<_, _>>()?;
    if header.is_empty() {
        return Err(ParseError::Shape("empty header"));
    }
    rows.iter()
        .skip(1)
        .map(|r| {
            let cells = r.as_array().ok_or(ParseError::Shape("expected a row array"))?;
            Ok(header.iter().cloned().zip(cells.iter().cloned()).collect())
        })
        .collect()
}
