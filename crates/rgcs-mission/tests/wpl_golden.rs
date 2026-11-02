use rgcs_core::{demo20, MissionFrame, MAV_CMD_NAV_TAKEOFF};
use rgcs_mission::{from_wpl, to_wpl, WplError};

const FIXTURE: &str = include_str!("fixtures/demo20.waypoints");

#[test]
fn golden_round_trip_is_byte_identical() {
    let m = from_wpl(FIXTURE).expect("fixture parses");
    assert_eq!(to_wpl(&m), FIXTURE);
    // and the writer reproduces the fixture from the in-code demo mission
    assert_eq!(to_wpl(&demo20()), FIXTURE);
}

#[test]
fn parsed_fixture_has_twenty_items_and_home() {
    let m = from_wpl(FIXTURE).unwrap();
    assert_eq!(m.items.len(), 20);
    assert_eq!(m.items[0].command, MAV_CMD_NAV_TAKEOFF);
    assert_eq!(m.items[0].frame, MissionFrame::Rel);
    let home = m.home.expect("home line");
    assert!((home.lat - 35.481883).abs() < 1e-9);
    assert_eq!(m.default_alt, 30.0, "first positional altitude");
    assert_eq!(m.default_frame, MissionFrame::Rel);
    assert_eq!(m.speed, 8.0);
}

#[test]
fn imports_mission_planner_file_with_crlf_and_blank_lines() {
    // Mission Planner: CRLF, 7-decimal numbers, a `current` flag on a later row, trailing blanks.
    let mp: String = FIXTURE
        .lines()
        .enumerate()
        .map(|(i, line)| {
            if i == 0 {
                return line.to_string();
            }
            let mut cols: Vec<String> = line.split('\t').map(str::to_string).collect();
            for col in cols.iter_mut().skip(4).take(7) {
                let v: f64 = col.parse().unwrap();
                *col = format!("{v:.7}");
            }
            if i == 3 {
                cols[1] = "1".into();
            }
            cols.join("\t")
        })
        .collect::<Vec<_>>()
        .join("\r\n")
        + "\r\n\r\n";
    let a = from_wpl(&mp).expect("MP file parses");
    let b = from_wpl(FIXTURE).unwrap();
    assert_eq!(a.items.len(), b.items.len());
    for (x, y) in a.items.iter().zip(&b.items) {
        assert_eq!(
            (x.command, x.frame, x.params, x.alt, x.autocontinue),
            (y.command, y.frame, y.params, y.alt, y.autocontinue)
        );
        assert!(
            (x.lat - y.lat).abs() < 1e-6 && (x.lon - y.lon).abs() < 1e-6,
            "{x:?} vs {y:?}"
        );
    }
    assert_eq!(a.home.map(|h| h.alt), b.home.map(|h| h.alt));
}

#[test]
fn rejects_missing_header_and_bad_frame() {
    assert_eq!(
        from_wpl("0\t1\t0\t16\t0\t0\t0\t0\t36\t139\t0\t1\n"),
        Err(WplError::Header)
    );
    let bad = "QGC WPL 110\n0\t1\t0\t16\t0\t0\t0\t0\t36.0\t139.0\t0\t1\n1\t0\t99\t22\t0\t0\t0\t0\t36.0\t139.0\t30\t1\n";
    // `line` is the 1-based line in the file (header = 1, home = 2, first item = 3).
    match from_wpl(bad) {
        Err(WplError::Line { line, .. }) => assert_eq!(line, 3),
        other => panic!("expected line error, got {other:?}"),
    }
    assert_eq!(from_wpl("QGC WPL 110\n"), Err(WplError::Empty));
}

#[test]
fn export_without_home_uses_first_positional_item() {
    let mut m = demo20();
    m.home = None;
    let text = to_wpl(&m);
    let line0 = text.lines().nth(1).unwrap();
    assert_eq!(
        line0,
        "0\t1\t0\t16\t0.000000\t0.000000\t0.000000\t0.000000\t35.48188300\t138.48029000\t0.000000\t1"
    );
    let back = from_wpl(&text).unwrap();
    assert_eq!(back.home.unwrap().alt, 0.0);
}

#[test]
fn frame_mission_rows_import_as_rel() {
    // QGC writes MAV_FRAME_MISSION (2) for DO_ / CONDITION rows.
    let text = "QGC WPL 110\n0\t1\t0\t16\t0\t0\t0\t0\t36.0\t139.0\t0\t1\n1\t0\t3\t22\t0\t0\t0\t0\t36.0\t139.0\t30\t1\n2\t0\t2\t178\t1\t8\t-1\t0\t0\t0\t0\t1\n";
    let m = from_wpl(text).expect("frame 2 accepted on a non-positional row");
    assert_eq!(m.items[1].command, 178);
    assert_eq!(m.items[1].frame, MissionFrame::Rel);
}
