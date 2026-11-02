//! Timestamps as the sources write them: `2026-10-25T03:00`, `2026-10-25 00:00:00.000`,
//! `2026-10-25T03:00:00Z`, `2026-10-25T12:10:00+09:00`. No zone means UTC.

use time::{Date, Month, PrimitiveDateTime, Time, UtcOffset};

fn digits(s: &str, from: usize, len: usize) -> Option<u32> {
    let part = s.get(from..from + len)?;
    if !part.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    part.parse().ok()
}

fn offset(rest: &str) -> Option<UtcOffset> {
    match rest {
        "" | "Z" | "z" => Some(UtcOffset::UTC),
        _ => {
            let sign = match rest.get(..1)? {
                "+" => 1,
                "-" => -1,
                _ => return None,
            };
            let (h, m) = (digits(rest, 1, 2)?, digits(rest, 4, 2)?);
            if rest.len() != 6 || rest.get(3..4)? != ":" {
                return None;
            }
            UtcOffset::from_hms(sign * h as i8, sign * m as i8, 0).ok()
        }
    }
}

/// Milliseconds since the Unix epoch, or `None` for anything malformed.
pub fn timestamp_ms(s: &str) -> Option<u64> {
    let s = s.trim();
    let sep = s.get(10..11)?;
    if (sep != "T" && sep != " ") || s.get(4..5)? != "-" || s.get(7..8)? != "-" {
        return None;
    }
    let month = Month::try_from(digits(s, 5, 2)? as u8).ok()?;
    let date = Date::from_calendar_date(digits(s, 0, 4)? as i32, month, digits(s, 8, 2)? as u8).ok()?;
    let (hour, minute) = (digits(s, 11, 2)?, digits(s, 14, 2)?);
    if s.get(13..14)? != ":" {
        return None;
    }
    let mut pos = 16;
    let mut second = 0;
    if s.get(16..17) == Some(":") {
        second = digits(s, 17, 2)?;
        pos = 19;
        if s.get(19..20) == Some(".") {
            let frac = s.get(20..)?.bytes().take_while(u8::is_ascii_digit).count();
            pos = 20 + frac;
        }
    }
    let time = Time::from_hms(hour as u8, minute as u8, second as u8).ok()?;
    let at = PrimitiveDateTime::new(date, time).assume_offset(offset(s.get(pos..)?)?);
    u64::try_from(at.unix_timestamp_nanos() / 1_000_000).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    const T0300: u64 = 1_792_897_200_000;

    #[test]
    fn accepts_every_source_format() {
        for s in [
            "2026-10-25T03:00",
            "2026-10-25 03:00:00.000",
            "2026-10-25T03:00:00",
            "2026-10-25 03:00:00",
            "2026-10-25T03:00:00Z",
            "2026-10-25T12:00:00+09:00",
            "2026-10-24T22:00:00-05:00",
        ] {
            assert_eq!(timestamp_ms(s), Some(T0300), "{s}");
        }
    }

    #[test]
    fn rejects_malformed_text() {
        for s in [
            "",
            "2026",
            "2026-10-25",
            "2026/10/25 03:00",
            "2026-10-25T3:00",
            "2026-13-01T00:00",
            "2026-10-25T03:00:00+9",
            "2026-10-25T03:00junk",
            "２０２６-10-25T03:00",
            "1960-01-01T00:00",
        ] {
            assert_eq!(timestamp_ms(s), None, "{s}");
        }
    }
}
