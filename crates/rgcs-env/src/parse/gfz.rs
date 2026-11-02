//! GFZ Potsdam Kp (`/app/json/?index=Kp`) → the latest `Observed` Kp.

use serde_json::Value;

use super::{json, number, timestamp_ms, ParseError};
use crate::{Class, FactorKind, Reading, SourceId};

pub fn gfz_kp(body: &str) -> Result<Vec<Reading>, ParseError> {
    let v = json(body)?;
    let times = v
        .get("datetime")
        .and_then(Value::as_array)
        .ok_or(ParseError::Shape("datetime"))?;
    let kps = v
        .get("Kp")
        .and_then(Value::as_array)
        .ok_or(ParseError::Shape("Kp"))?;
    let latest = times
        .iter()
        .zip(kps.iter())
        .filter_map(|(t, k)| Some((timestamp_ms(t.as_str()?)?, number(Some(k))?)))
        .max_by_key(|(at, _)| *at)
        .ok_or(ParseError::Empty)?;
    Ok(vec![Reading {
        source: SourceId::GfzKp,
        class: Class::Observed,
        kind: FactorKind::Kp,
        value: latest.1,
        at_ms: latest.0,
        note: None,
    }])
}
