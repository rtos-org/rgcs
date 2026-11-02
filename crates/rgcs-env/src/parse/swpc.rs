//! NOAA SWPC: planetary Kp (`Observed`), 1-minute estimated Kp (`Nowcast`), the 3-day Kp
//! forecast (`Forecast`, max over the next 24 h) and alerts (notes, untrusted text).
//! Tables are accepted in both the header-row and the array-of-objects form.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use super::{field, json, number, table, timestamp_ms, ParseError};
use crate::{Class, FactorKind, Reading, SourceId};

const HOUR_MS: u64 = 3_600_000;
/// Alert texts are shown and handed to the AI as untrusted text; keep them bounded.
const MAX_ALERT_CHARS: usize = 2_000;

/// A SWPC alert / warning / watch. Listed for the operator, never used for levels.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Note {
    /// SWPC `product_id` (e.g. `K07A`).
    pub id: String,
    pub at_ms: u64,
    pub untrusted_text: String,
}

fn time_of(row: &Map<String, Value>) -> Option<u64> {
    timestamp_ms(field(row, "time_tag")?.as_str()?)
}

/// The latest row with a time and a number in `key`.
fn latest(body: &str, key: &str) -> Result<(u64, f64), ParseError> {
    let rows = table(&json(body)?)?;
    rows.iter()
        .filter_map(|r| Some((time_of(r)?, number(field(r, key))?)))
        .max_by_key(|(at, _)| *at)
        .ok_or(ParseError::Empty)
}

fn kp(source: SourceId, class: Class, (at_ms, value): (u64, f64), note: Option<String>) -> Reading {
    Reading {
        source,
        class,
        kind: FactorKind::Kp,
        value,
        at_ms,
        note,
    }
}

pub fn swpc_kp(body: &str) -> Result<Vec<Reading>, ParseError> {
    Ok(vec![kp(
        SourceId::SwpcKp,
        Class::Observed,
        latest(body, "Kp")?,
        None,
    )])
}

pub fn swpc_kp_1m(body: &str) -> Result<Vec<Reading>, ParseError> {
    Ok(vec![kp(
        SourceId::SwpcKp1m,
        Class::Nowcast,
        latest(body, "estimated_kp")?,
        None,
    )])
}

fn utc_label(ms: u64) -> String {
    let at = time::OffsetDateTime::from_unix_timestamp((ms / 1000) as i64)
        .unwrap_or(time::OffsetDateTime::UNIX_EPOCH);
    format!("{} {:02}:{:02}Z", at.date(), at.hour(), at.minute())
}

/// The max predicted Kp over the 3-hour slots from the current one to `now + 24 h`,
/// stamped with `now_ms` (the fetch); the slot time and NOAA scale go in the note.
/// No predicted slot ahead → no reading (not an error).
pub fn swpc_kp_forecast(body: &str, now_ms: u64) -> Result<Vec<Reading>, ParseError> {
    let rows = table(&json(body)?)?;
    let ahead = |at: u64| at + 3 * HOUR_MS > now_ms && at <= now_ms + 24 * HOUR_MS;
    let best = rows
        .iter()
        .filter(|r| field(r, "observed").and_then(Value::as_str) == Some("predicted"))
        .filter_map(|r| Some((time_of(r)?, number(field(r, "kp"))?, r)))
        .filter(|(at, _, _)| ahead(*at))
        .max_by(|a, b| a.1.total_cmp(&b.1));
    Ok(best
        .map(|(at, value, row)| {
            let scale = field(row, "noaa_scale").and_then(Value::as_str).unwrap_or("");
            let note = format!("max 24 h: {} {scale}", utc_label(at))
                .trim_end()
                .to_string();
            kp(
                SourceId::SwpcKpForecast,
                Class::Forecast,
                (now_ms, value),
                Some(note),
            )
        })
        .into_iter()
        .collect())
}

fn note(row: &Value) -> Option<Note> {
    let id = row.get("product_id")?.as_str()?.trim();
    let at_ms = timestamp_ms(row.get("issue_datetime")?.as_str()?)?;
    let text = row.get("message")?.as_str()?;
    (!id.is_empty()).then(|| Note {
        id: id.chars().take(16).collect(),
        at_ms,
        untrusted_text: text.chars().take(MAX_ALERT_CHARS).collect(),
    })
}

/// Alerts newest first. Rows without an id, a time or a message are skipped.
pub fn swpc_alerts(body: &str) -> Result<Vec<Note>, ParseError> {
    let rows = json(body)?;
    let rows = rows.as_array().ok_or(ParseError::Shape("expected an array"))?;
    let mut notes: Vec<Note> = rows.iter().filter_map(note).collect();
    notes.sort_by_key(|n| std::cmp::Reverse(n.at_ms));
    Ok(notes)
}
