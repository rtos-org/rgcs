//! Source parsers against committed fixtures (no network).

use rgcs_env::parse::{self, Station};
use rgcs_env::{Class, FactorKind, Reading, SourceId};

const T0300: u64 = 1_792_897_200_000; // 2026-10-25T03:00:00Z
const T0345: u64 = T0300 + 45 * 60_000;

fn fixture(name: &str) -> String {
    let path = format!("{}/tests/fixtures/{name}", env!("CARGO_MANIFEST_DIR"));
    std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{path}: {e}"))
}

fn find(readings: &[Reading], kind: FactorKind) -> &Reading {
    readings
        .iter()
        .find(|r| r.kind == kind)
        .unwrap_or_else(|| panic!("no {kind:?} in {readings:?}"))
}

fn assert_reading(r: &Reading, source: SourceId, class: Class, value: f64, at_ms: u64) {
    assert_eq!((r.source, r.class, r.at_ms), (source, class, at_ms), "{r:?}");
    assert!((r.value - value).abs() < 1e-9, "{r:?} != {value}");
}

#[test]
fn open_meteo_current_block_gives_forecast_readings() {
    let rs = parse::open_meteo(&fixture("open_meteo.json")).unwrap();
    let (s, c) = (SourceId::OpenMeteo, Class::Forecast);
    assert_reading(find(&rs, FactorKind::Wind), s, c, 6.2, T0300);
    assert_reading(find(&rs, FactorKind::Gust), s, c, 11.4, T0300);
    assert_reading(find(&rs, FactorKind::Temp), s, c, 8.5, T0300);
    assert_reading(find(&rs, FactorKind::Precip), s, c, 0.0, T0300);
    assert_eq!(rs.len(), 4);
}

#[test]
fn open_meteo_precipitation_over_the_interval_is_scaled_to_mm_per_hour() {
    // 0.5 mm in the preceding 900 s → 2.0 mm/h.
    let rs = parse::open_meteo(&fixture("open_meteo_rain.json")).unwrap();
    assert!((find(&rs, FactorKind::Precip).value - 2.0).abs() < 1e-9);
}

#[test]
fn amedas_latest_time_becomes_the_map_file_stamp() {
    let stamp = parse::amedas_latest(&fixture("amedas_latest_time.txt")).unwrap();
    assert_eq!(stamp, "20261025121000");
    // 12:10 JST = 03:10Z.
    assert_eq!(
        parse::timestamp_ms("2026-10-25T12:10:00+09:00"),
        Some(T0300 + 600_000)
    );
}

fn stations() -> Vec<Station> {
    parse::amedas_table(&fixture("amedas_table.json")).unwrap()
}

#[test]
fn amedas_table_converts_degree_minutes_and_finds_the_nearest_station() {
    let st = stations();
    assert_eq!(st.len(), 2);
    let (near, km) = parse::nearest_station(&st, 36.2509, 137.6385, 30.0).unwrap();
    assert_eq!(near.id, "99001");
    assert_eq!(near.name, "上高地(試験)");
    assert!((near.lat - (36.0 + 15.1 / 60.0)).abs() < 1e-9);
    assert!(km < 1.0, "{km}");
    // The test station is ~86 m away, so a 50 m radius finds nothing.
    assert!(parse::nearest_station(&st, 36.2509, 137.6385, 0.05).is_none());
    assert!(parse::nearest_station(&[], 36.2509, 137.6385, 30.0).is_none());
}

#[test]
fn amedas_map_gives_observed_readings_for_the_station() {
    let st = stations();
    let at = T0300 + 600_000;
    let rs = parse::amedas_map(&fixture("amedas_map.json"), &st[0], at).unwrap();
    let (s, c) = (SourceId::JmaAmedas, Class::Observed);
    assert_reading(find(&rs, FactorKind::Temp), s, c, 6.8, at);
    assert_reading(find(&rs, FactorKind::Wind), s, c, 3.1, at);
    assert_reading(find(&rs, FactorKind::Precip), s, c, 0.0, at);
    assert_eq!(rs.len(), 3);
    let note = find(&rs, FactorKind::Wind).note.clone().unwrap();
    assert!(note.contains("出典: 気象庁ホームページ"), "{note}");
}

#[test]
fn amedas_map_drops_values_whose_quality_flag_is_not_zero() {
    let st = stations();
    let rs = parse::amedas_map(&fixture("amedas_map_bad_temp.json"), &st[0], T0300).unwrap();
    assert!(rs.iter().all(|r| r.kind != FactorKind::Temp));
    // precipitation10m ×6 → mm/h.
    assert!((find(&rs, FactorKind::Precip).value - 3.0).abs() < 1e-9);
}

#[test]
fn amedas_map_without_the_station_is_a_parse_error() {
    let other = Station {
        id: "12345".into(),
        name: "x".into(),
        lat: 0.0,
        lon: 0.0,
    };
    assert!(parse::amedas_map(&fixture("amedas_map.json"), &other, T0300).is_err());
}

#[test]
fn swpc_kp_accepts_header_rows_and_objects() {
    for name in ["swpc_kp_rows.json", "swpc_kp_objects.json"] {
        let rs = parse::swpc_kp(&fixture(name)).unwrap();
        assert_eq!(rs.len(), 1, "{name}");
        assert_reading(&rs[0], SourceId::SwpcKp, Class::Observed, 6.67, T0300);
        assert_eq!(rs[0].kind, FactorKind::Kp);
    }
}

#[test]
fn swpc_kp_1m_gives_the_latest_estimated_kp_as_nowcast() {
    let rs = parse::swpc_kp_1m(&fixture("swpc_kp_1m.json")).unwrap();
    assert_eq!(rs.len(), 1);
    assert_reading(
        &rs[0],
        SourceId::SwpcKp1m,
        Class::Nowcast,
        7.33,
        T0300 + 41 * 60_000,
    );
}

#[test]
fn swpc_kp_forecast_takes_the_max_predicted_kp_of_the_next_24_hours() {
    for name in ["swpc_kp_forecast.json", "swpc_kp_forecast_objects.json"] {
        let rs = parse::swpc_kp_forecast(&fixture(name), T0345).unwrap();
        assert_eq!(rs.len(), 1, "{name}: {rs:?}");
        // Stamped with the fetch time; the valid time goes in the note.
        assert_reading(&rs[0], SourceId::SwpcKpForecast, Class::Forecast, 5.33, T0345);
        assert!(rs[0].note.as_deref().unwrap_or("").contains("06:00"), "{rs:?}");
    }
}

#[test]
fn swpc_kp_forecast_with_nothing_ahead_is_empty_not_an_error() {
    let rs = parse::swpc_kp_forecast(&fixture("swpc_kp_forecast.json"), T0300 + 10 * 86_400_000);
    assert_eq!(rs.unwrap(), vec![]);
}

#[test]
fn swpc_alerts_become_notes_with_untrusted_text() {
    let notes = parse::swpc_alerts(&fixture("swpc_alerts.json")).unwrap();
    assert_eq!(notes.len(), 1);
    assert_eq!(notes[0].id, "K07A");
    assert_eq!(notes[0].at_ms, T0300 + 12 * 60_000);
    assert!(notes[0].untrusted_text.contains("Geomagnetic K-index of 7"));
    assert_eq!(parse::swpc_alerts("[]").unwrap(), vec![]);
}

#[test]
fn gfz_kp_gives_the_latest_observed_value() {
    let rs = parse::gfz_kp(&fixture("gfz_kp.json")).unwrap();
    assert_eq!(rs.len(), 1);
    assert_reading(&rs[0], SourceId::GfzKp, Class::Observed, 6.667, T0300);
}

#[test]
fn owm_current_weather_gives_forecast_readings() {
    let rs = parse::owm(&fixture("owm.json")).unwrap();
    let (s, c) = (SourceId::Openweathermap, Class::Forecast);
    assert_reading(find(&rs, FactorKind::Wind), s, c, 7.0, T0300);
    assert_reading(find(&rs, FactorKind::Gust), s, c, 12.9, T0300);
    assert_reading(find(&rs, FactorKind::Temp), s, c, 8.1, T0300);
    assert_reading(find(&rs, FactorKind::Precip), s, c, 0.4, T0300);
}

#[test]
fn every_parser_rejects_malformed_bodies_without_panicking() {
    let station = &stations()[0];
    let html = fixture("html.txt");
    let bodies = [
        "{}",
        "<html>",
        html.as_str(),
        "",
        "[",
        "null",
        "[[]]",
        "[{}]",
        "[1,2]",
    ];
    for body in bodies {
        assert!(parse::open_meteo(body).is_err(), "open_meteo {body:?}");
        assert!(parse::amedas_latest(body).is_err(), "amedas_latest {body:?}");
        assert!(parse::amedas_table(body).is_err(), "amedas_table {body:?}");
        assert!(
            parse::amedas_map(body, station, T0300).is_err(),
            "amedas_map {body:?}"
        );
        assert!(parse::swpc_kp(body).is_err(), "swpc_kp {body:?}");
        assert!(parse::swpc_kp_1m(body).is_err(), "swpc_kp_1m {body:?}");
        assert!(parse::gfz_kp(body).is_err(), "gfz_kp {body:?}");
        assert!(parse::owm(body).is_err(), "owm {body:?}");
    }
    for body in ["{}", "<html>", html.as_str(), "", "[", "null"] {
        assert!(
            parse::swpc_kp_forecast(body, T0345).is_err(),
            "kp_forecast {body:?}"
        );
        assert!(parse::swpc_alerts(body).is_err(), "alerts {body:?}");
    }
}

#[test]
fn wrong_value_types_are_errors_not_panics() {
    let bad = [
        r#"{"current":{"time":"x","wind_speed_10m":"fast"}}"#,
        r#"{"current":{"time":"2026-10-25T03:00","wind_speed_10m":"fast"}}"#,
        r#"[["time_tag","Kp"],["2026-10-25 03:00:00.000","n/a"]]"#,
        r#"{"datetime":["2026-10-25T03:00:00Z"],"Kp":[]}"#,
        r#"{"wind":{"speed":"x"},"dt":"y"}"#,
    ];
    assert!(parse::open_meteo(bad[0]).is_err());
    assert!(parse::open_meteo(bad[1]).is_err());
    assert!(parse::swpc_kp(bad[2]).is_err());
    assert!(parse::gfz_kp(bad[3]).is_err());
    assert!(parse::owm(bad[4]).is_err());
    assert!(parse::amedas_latest("2026-13-45T99:10:00+09:00").is_err());
}
