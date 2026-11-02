//! JST date/time helpers for the logbook (MLIT forms use Japan Standard Time, minutes).

use time::macros::format_description;
use time::{Date, OffsetDateTime, PrimitiveDateTime, Time, UtcOffset};

/// Japan Standard Time (+09:00, no DST).
pub const JST: UtcOffset = match UtcOffset::from_hms(9, 0, 0) {
    Ok(o) => o,
    Err(_) => panic!("static offset"),
};

fn at(ms: u64) -> OffsetDateTime {
    OffsetDateTime::from_unix_timestamp_nanos(i128::from(ms) * 1_000_000)
        .unwrap_or(OffsetDateTime::UNIX_EPOCH)
        .to_offset(JST)
}

/// `YYYY-MM-DD` in JST.
pub fn date(ms: u64) -> String {
    at(ms)
        .format(format_description!("[year]-[month]-[day]"))
        .unwrap_or_default()
}

/// `HH:MM` in JST (24 h).
pub fn hhmm(ms: u64) -> String {
    at(ms)
        .format(format_description!("[hour]:[minute]"))
        .unwrap_or_default()
}

fn parse_date(s: &str) -> Option<Date> {
    Date::parse(s, format_description!("[year]-[month]-[day]")).ok()
}

/// True for a well-formed, valid calendar date `YYYY-MM-DD`.
pub fn is_date(s: &str) -> bool {
    s.len() == 10 && parse_date(s).is_some()
}

fn midnight_ms(d: Date) -> u64 {
    let t = PrimitiveDateTime::new(d, Time::MIDNIGHT).assume_offset(JST);
    (t.unix_timestamp_nanos() / 1_000_000).max(0) as u64
}

/// `[from 00:00 JST, (to + 1 day) 00:00 JST)` as unix milliseconds; `None` on a bad date.
pub fn day_range_ms(from: &str, to: &str) -> Option<(u64, u64)> {
    let a = parse_date(from)?;
    let b = parse_date(to)?.next_day()?;
    Some((midnight_ms(a), midnight_ms(b)))
}

/// Minutes between two instants, rounded up (飛行時間 は 1 分単位で切り上げ); 0 when `to <= from`.
pub fn ceil_minutes(from_ms: u64, to_ms: u64) -> u32 {
    let d = to_ms.saturating_sub(from_ms);
    d.div_ceil(60_000).min(u64::from(u32::MAX)) as u32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_in_jst() {
        assert_eq!(date(1_700_000_000_000), "2023-11-15");
        assert_eq!(hhmm(1_700_000_000_000), "07:13");
    }

    #[test]
    fn day_range_covers_both_ends() {
        let (a, b) = day_range_ms("2026-12-01", "2026-12-01").unwrap();
        assert_eq!(b - a, 86_400_000);
        assert_eq!(a, 1_796_050_800_000);
        assert!(day_range_ms("2026-13-01", "x").is_none());
        assert!(is_date("2026-02-28") && !is_date("2026-02-30") && !is_date("26-1-1"));
    }

    #[test]
    fn minutes_round_up() {
        assert_eq!(ceil_minutes(0, 1), 1);
        assert_eq!(ceil_minutes(0, 60_000), 1);
        assert_eq!(ceil_minutes(0, 60_001), 2);
        assert_eq!(ceil_minutes(5, 5), 0);
    }
}
