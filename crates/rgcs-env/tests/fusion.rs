//! Safety-side fusion, copter thresholds, now = 2026-10-25T03:45Z.

use rgcs_env::{fuse, Class, FactorKind, Fused, Level, Reading, SourceId, Thresholds};

const NOW: u64 = 1_792_897_200_000 + 45 * 60_000;
const SEC: u64 = 1_000;
const EXTERNAL: [SourceId; 8] = SourceId::EXTERNAL;

fn r(source: SourceId, class: Class, kind: FactorKind, value: f64, age_s: u64) -> Reading {
    Reading {
        source,
        class,
        kind,
        value,
        at_ms: NOW - age_s * SEC,
        note: None,
    }
}

fn fused(readings: &[Reading]) -> Fused {
    fuse(readings, &Thresholds::copter(), &EXTERNAL, &[], NOW)
}

fn wind_readings() -> Vec<Reading> {
    use FactorKind::Wind;
    vec![
        r(SourceId::Vehicle, Class::Measured, Wind, 4.0, 30),
        r(SourceId::JmaAmedas, Class::Observed, Wind, 3.1, 35 * 60 - 600),
        r(SourceId::OpenMeteo, Class::Forecast, Wind, 6.2, 45 * 60),
        r(SourceId::Openweathermap, Class::Forecast, Wind, 7.0, 45 * 60),
    ]
}

#[test]
fn wind_is_ok_with_the_vehicle_primary_and_sources_disagreeing() {
    let f = fused(&wind_readings());
    let w = f.factor(FactorKind::Wind).unwrap();
    assert_eq!(w.level, Level::Ok);
    assert_eq!(w.primary.as_ref().unwrap().reading.source, SourceId::Vehicle);
    assert!(w.disagree, "7.0 - 3.1 >= 3.0");
    assert_eq!(w.readings.len(), 4);
    assert!(w.readings.iter().all(|x| x.fresh));
}

#[test]
fn gust_takes_the_highest_level_and_its_reading_as_value() {
    use FactorKind::Gust;
    let f = fused(&[
        r(SourceId::OpenMeteo, Class::Forecast, Gust, 11.4, 2700),
        r(SourceId::Openweathermap, Class::Forecast, Gust, 12.9, 2700),
    ]);
    let g = f.factor(Gust).unwrap();
    assert_eq!(g.level, Level::Warn);
    let v = &g.value.as_ref().unwrap().reading;
    assert_eq!((v.source, v.value), (SourceId::Openweathermap, 12.9));
}

#[test]
fn kp_observed_and_nowcast_fuse_to_strong_from_the_nowcast() {
    use FactorKind::Kp;
    let f = fused(&[
        r(SourceId::SwpcKp, Class::Observed, Kp, 6.67, 2700),
        r(SourceId::SwpcKp1m, Class::Nowcast, Kp, 7.33, 240),
    ]);
    let k = f.factor(Kp).unwrap();
    assert_eq!(k.level, Level::Strong);
    let v = &k.value.as_ref().unwrap().reading;
    assert_eq!((v.source, v.value), (SourceId::SwpcKp1m, 7.33));
    assert!(!k.disagree);
    assert_eq!(f.kp_level(), Some(Level::Strong));
}

#[test]
fn kp_observed_stays_fresh_for_four_hours() {
    use FactorKind::Kp;
    let f = fused(&[r(SourceId::SwpcKp, Class::Observed, Kp, 5.33, 3 * 3600 + 50 * 60)]);
    assert_eq!(f.kp_level(), Some(Level::Warn));
    let f = fused(&[r(SourceId::SwpcKp, Class::Observed, Kp, 5.33, 4 * 3600 + 60)]);
    assert_eq!(f.kp_level(), None, "stale Kp feeds nothing");
}

#[test]
fn a_stale_reading_is_kept_but_does_not_raise_the_level() {
    use FactorKind::Wind;
    let mut rs = wind_readings();
    rs.push(r(SourceId::Vehicle, Class::Measured, Wind, 20.0, 90));
    let f = fused(&rs);
    let w = f.factor(Wind).unwrap();
    assert_eq!(w.level, Level::Ok);
    let stale = w.readings.iter().find(|x| x.reading.value == 20.0).unwrap();
    assert!(!stale.fresh);
    // The fresh Measured reading (30 s) is still the primary.
    assert_eq!(w.primary.as_ref().unwrap().reading.value, 4.0);
}

#[test]
fn only_stale_readings_still_show_the_last_value_but_level_ok() {
    use FactorKind::Wind;
    let f = fused(&[r(SourceId::Vehicle, Class::Measured, Wind, 20.0, 90)]);
    let w = f.factor(Wind).unwrap();
    assert_eq!(w.level, Level::Ok);
    assert!(w.value.is_none());
    let p = w.primary.as_ref().unwrap();
    assert!(!p.fresh && p.reading.value == 20.0);
}

#[test]
fn temperature_checks_min_against_low_and_max_against_high() {
    use FactorKind::Temp;
    let low = fused(&[
        r(SourceId::OpenMeteo, Class::Forecast, Temp, -12.0, 60),
        r(SourceId::JmaAmedas, Class::Observed, Temp, -3.0, 60),
    ]);
    let t = low.factor(Temp).unwrap();
    assert_eq!(t.level, Level::Strong);
    assert_eq!(t.value.as_ref().unwrap().reading.value, -12.0);
    let high = fused(&[
        r(SourceId::OpenMeteo, Class::Forecast, Temp, 36.0, 60),
        r(SourceId::JmaAmedas, Class::Observed, Temp, 30.0, 60),
    ]);
    let t = high.factor(Temp).unwrap();
    assert_eq!(t.level, Level::Warn);
    assert_eq!(t.value.as_ref().unwrap().reading.value, 36.0);
    assert!(t.disagree, "36 - 30 >= 5");
    let both = fused(&[
        r(SourceId::OpenMeteo, Class::Forecast, Temp, -12.0, 60),
        r(SourceId::JmaAmedas, Class::Observed, Temp, 36.0, 60),
    ]);
    assert_eq!(both.factor(Temp).unwrap().level, Level::Strong);
}

#[test]
fn failed_sources_are_missing_and_a_total_outage_is_unavailable() {
    let th = Thresholds::copter();
    let f = fuse(&wind_readings(), &th, &EXTERNAL, &[SourceId::OpenMeteo], NOW);
    assert_eq!(f.missing, vec![SourceId::OpenMeteo]);
    assert!(!f.unavailable);
    // A failed source that is disabled is not listed.
    let enabled = [SourceId::SwpcKp];
    let f = fuse(&[], &th, &enabled, &[SourceId::OpenMeteo], NOW);
    assert_eq!(f.missing, vec![]);
    // Everything external failed; only the vehicle's own reading is fresh.
    let vehicle_only = [r(SourceId::Vehicle, Class::Measured, FactorKind::Wind, 4.0, 5)];
    let f = fuse(&vehicle_only, &th, &EXTERNAL, &EXTERNAL, NOW);
    assert!(f.unavailable);
    assert_eq!(f.missing, EXTERNAL.to_vec());
    // Stale external readings are shown but do not count as available.
    let stale = [r(
        SourceId::OpenMeteo,
        Class::Forecast,
        FactorKind::Wind,
        4.0,
        4 * 3600,
    )];
    assert!(fuse(&stale, &th, &EXTERNAL, &[], NOW).unavailable);
    // Nothing external enabled: nothing to be unavailable.
    assert!(!fuse(&vehicle_only, &th, &[], &[], NOW).unavailable);
}

#[test]
fn a_higher_priority_lower_reading_never_downgrades_the_level() {
    use FactorKind::Wind;
    let f = fused(&[
        r(SourceId::Vehicle, Class::Measured, Wind, 4.0, 10),
        r(SourceId::OpenMeteo, Class::Forecast, Wind, 9.0, 600),
    ]);
    let w = f.factor(Wind).unwrap();
    assert_eq!(w.level, Level::Warn);
    assert_eq!(w.primary.as_ref().unwrap().reading.source, SourceId::Vehicle);
    assert_eq!(w.value.as_ref().unwrap().reading.source, SourceId::OpenMeteo);
}

#[test]
fn level_ties_go_to_the_higher_class() {
    use FactorKind::Gust;
    let f = fused(&[
        r(SourceId::OpenMeteo, Class::Forecast, Gust, 11.0, 60),
        r(SourceId::Vehicle, Class::Measured, Gust, 10.6, 5),
    ]);
    let v = &f.factor(Gust).unwrap().value.as_ref().unwrap().reading;
    assert_eq!(v.source, SourceId::Vehicle);
}

#[test]
fn gnss_sats_and_hdop_are_rated_separately() {
    let sats = Reading::gnss_sats(SourceId::Vehicle, 5.0, NOW);
    let hdop = Reading::gnss_hdop(SourceId::Vehicle, 2.5, NOW);
    let f = fused(&[sats.clone(), hdop.clone()]);
    assert_eq!(f.factor(FactorKind::Gnss).unwrap().level, Level::Strong);
    let f = fused(&[Reading { value: 12.0, ..sats }, hdop]);
    assert_eq!(f.factor(FactorKind::Gnss).unwrap().level, Level::Warn);
}

#[test]
fn declination_and_daylight_use_their_thresholds() {
    let f = fused(&[
        r(SourceId::Local, Class::Measured, FactorKind::Declination, 2.5, 1),
        r(SourceId::Local, Class::Measured, FactorKind::Daylight, 8.0, 1),
    ]);
    assert_eq!(f.factor(FactorKind::Declination).unwrap().level, Level::Warn);
    assert_eq!(f.factor(FactorKind::Daylight).unwrap().level, Level::Strong);
    let dark = fused(&[r(SourceId::Local, Class::Measured, FactorKind::Daylight, 0.0, 1)]);
    assert_eq!(dark.factor(FactorKind::Daylight).unwrap().level, Level::Strong);
}

#[test]
fn factors_come_out_in_kind_order_and_airframes_differ() {
    let f = fused(&[
        r(SourceId::SwpcKp, Class::Observed, FactorKind::Kp, 1.0, 60),
        r(SourceId::OpenMeteo, Class::Forecast, FactorKind::Wind, 11.0, 60),
    ]);
    let kinds: Vec<_> = f.factors.iter().map(|x| x.kind).collect();
    assert_eq!(kinds, vec![FactorKind::Wind, FactorKind::Kp]);
    assert_eq!(f.factors[0].level, Level::Warn);
    let wind = [r(
        SourceId::OpenMeteo,
        Class::Forecast,
        FactorKind::Wind,
        11.0,
        60,
    )];
    let plane = fuse(&wind, &Thresholds::plane(), &EXTERNAL, &[], NOW);
    assert_eq!(plane.factors[0].level, Level::Ok);
    let qp = fuse(&wind, &Thresholds::quadplane(), &EXTERNAL, &[], NOW);
    assert_eq!(qp.factors[0].level, Level::Warn);
}
