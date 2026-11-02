//! QGC WPL 110 (`.waypoints`, Mission Planner compatible).
//!
//! ```text
//! QGC WPL 110
//! seq current frame command p1 p2 p3 p4 lat lon alt autocontinue      (tab separated)
//! ```
//! Line 0 is the home position. We write lat / lon with 8 decimals and every other number with
//! 6, LF line endings; we read CRLF, blank lines and any precision.

use rgcs_core::{Home, Mission, MissionFrame, MissionItem};

const HEADER: &str = "QGC WPL 110";
const ACCEPTED_HEADERS: [&str; 2] = ["QGC WPL 110", "QGC WPL 120"];
const COLUMNS: usize = 12;
const DEFAULT_ALT: f32 = 50.0;
const DEFAULT_SPEED: f32 = 8.0;

#[derive(Debug, thiserror::Error, PartialEq)]
pub enum WplError {
    #[error("missing QGC WPL header")]
    Header,
    #[error("line {line}: {reason}")]
    Line { line: usize, reason: String },
    #[error("no items")]
    Empty,
}

fn home_line(m: &Mission) -> (f64, f64, f32) {
    match &m.home {
        Some(h) => (h.lat, h.lon, h.alt),
        None => m
            .items
            .iter()
            .find(|it| it.is_positional() && !(it.lat == 0.0 && it.lon == 0.0))
            .map(|it| (it.lat, it.lon, 0.0))
            .unwrap_or((0.0, 0.0, 0.0)),
    }
}

fn format_item(seq: usize, current: bool, it: &MissionItem) -> String {
    format!(
        "{seq}\t{}\t{}\t{}\t{:.6}\t{:.6}\t{:.6}\t{:.6}\t{:.8}\t{:.8}\t{:.6}\t{}",
        u8::from(current),
        it.frame.mav(),
        it.command,
        it.params[0],
        it.params[1],
        it.params[2],
        it.params[3],
        it.lat,
        it.lon,
        it.alt,
        u8::from(it.autocontinue)
    )
}

/// Serialises the mission; line 0 is `home` (or the first positioned item at altitude 0).
pub fn to_wpl(m: &Mission) -> String {
    let (hlat, hlon, halt) = home_line(m);
    let home = MissionItem {
        command: 16,
        frame: MissionFrame::Abs,
        params: [0.0; 4],
        lat: hlat,
        lon: hlon,
        alt: halt,
        autocontinue: true,
    };
    let mut out = String::with_capacity(64 * (m.items.len() + 2));
    out.push_str(HEADER);
    out.push('\n');
    out.push_str(&format_item(0, true, &home));
    out.push('\n');
    for (i, it) in m.items.iter().enumerate() {
        out.push_str(&format_item(i + 1, false, it));
        out.push('\n');
    }
    out
}

fn parse_num<T: std::str::FromStr>(
    cols: &[&str],
    idx: usize,
    line: usize,
    what: &str,
) -> Result<T, WplError> {
    cols[idx].trim().parse().map_err(|_| WplError::Line {
        line,
        reason: format!("{what} is not a number: {:?}", cols[idx]),
    })
}

fn parse_line(text: &str, line: usize) -> Result<(u16, MissionItem), WplError> {
    let cols: Vec<&str> = text.split('\t').collect();
    if cols.len() < COLUMNS {
        return Err(WplError::Line {
            line,
            reason: format!("expected {COLUMNS} columns, found {}", cols.len()),
        });
    }
    let seq: u16 = parse_num(&cols, 0, line, "seq")?;
    let frame_id: u8 = parse_num(&cols, 2, line, "frame")?;
    // MAV_FRAME_MISSION (2): QGC's frame for DO_ / CONDITION rows, which carry no altitude.
    let frame_id = if frame_id == 2 {
        MissionFrame::Rel.mav()
    } else {
        frame_id
    };
    let frame = MissionFrame::from_mav(frame_id).ok_or_else(|| WplError::Line {
        line,
        reason: format!("unsupported frame {frame_id}"),
    })?;
    let command: u16 = parse_num(&cols, 3, line, "command")?;
    let params = [
        parse_num(&cols, 4, line, "param1")?,
        parse_num(&cols, 5, line, "param2")?,
        parse_num(&cols, 6, line, "param3")?,
        parse_num(&cols, 7, line, "param4")?,
    ];
    let lat: f64 = parse_num(&cols, 8, line, "lat")?;
    let lon: f64 = parse_num(&cols, 9, line, "lon")?;
    let alt: f32 = parse_num(&cols, 10, line, "alt")?;
    let autocontinue: u8 = parse_num(&cols, 11, line, "autocontinue")?;
    Ok((
        seq,
        MissionItem {
            command,
            frame,
            params,
            lat,
            lon,
            alt,
            autocontinue: autocontinue != 0,
        },
    ))
}

fn most_common_frame(items: &[MissionItem]) -> MissionFrame {
    [MissionFrame::Rel, MissionFrame::Abs, MissionFrame::Ter]
        .into_iter()
        .max_by_key(|f| {
            items
                .iter()
                .filter(|it| it.is_positional() && it.frame == *f)
                .count()
        })
        .unwrap_or(MissionFrame::Rel)
}

/// Parses a `.waypoints` file. The home line (seq 0) becomes `home`; items keep file order.
pub fn from_wpl(text: &str) -> Result<Mission, WplError> {
    let mut lines = text.lines().map(|l| l.trim_end_matches('\r'));
    let header = lines.next().map(str::trim).ok_or(WplError::Header)?;
    if !ACCEPTED_HEADERS.contains(&header) {
        return Err(WplError::Header);
    }
    let mut home = None;
    let mut items = Vec::new();
    for (idx, raw) in lines.enumerate() {
        let line_no = idx + 2;
        if raw.trim().is_empty() {
            continue;
        }
        let (seq, item) = parse_line(raw, line_no)?;
        if seq == 0 && home.is_none() {
            home = Some(Home {
                lat: item.lat,
                lon: item.lon,
                alt: item.alt,
            });
        } else {
            items.push(item);
        }
    }
    if items.is_empty() {
        return Err(WplError::Empty);
    }
    let default_alt = items
        .iter()
        .find(|it| it.is_positional())
        .map(|it| it.alt)
        .unwrap_or(DEFAULT_ALT);
    Ok(Mission {
        id: None,
        name: String::new(),
        sysid: None,
        default_alt,
        default_frame: most_common_frame(&items),
        speed: DEFAULT_SPEED,
        home,
        items,
        fence: Vec::new(),
        rally: Vec::new(),
        surveys: Vec::new(),
    })
}
