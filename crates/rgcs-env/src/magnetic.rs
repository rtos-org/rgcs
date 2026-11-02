//! Magnetic declination from the bundled WMM (`world_magnetic_model`), computed locally.

use time::Date;
use world_magnetic_model::uom::si::angle::degree;
use world_magnetic_model::uom::si::f32::{Angle, Length};
use world_magnetic_model::uom::si::length::meter;
use world_magnetic_model::GeomagneticField;

/// Declination in degrees (east positive) at the WGS 84 position and height. `None` for an
/// invalid position or a date outside the bundled models (WMM2020 / WMM2025).
pub fn declination_deg(lat: f64, lon: f64, alt_m: f64, date: Date) -> Option<f64> {
    let valid = lat.is_finite() && lon.is_finite() && alt_m.is_finite();
    if !valid || lat.abs() > 90.0 || lon.abs() > 180.0 {
        return None;
    }
    let field = GeomagneticField::new(
        Length::new::<meter>(alt_m as f32),
        Angle::new::<degree>(lat as f32),
        Angle::new::<degree>(lon as f32),
        date,
    )
    .ok()?;
    let d = f64::from(field.declination().get::<degree>());
    d.is_finite().then_some(d)
}

#[cfg(test)]
mod tests {
    use super::*;
    use time::macros::date;

    #[test]
    fn kamikochi_declination_is_about_eight_degrees_west() {
        let d = declination_deg(36.2509, 137.6385, 1500.0, date!(2026 - 10 - 25)).unwrap();
        assert!((-8.5..=-7.3).contains(&d), "{d}");
    }

    #[test]
    fn invalid_inputs_give_none() {
        let day = date!(2026 - 10 - 25);
        assert!(declination_deg(95.0, 0.0, 0.0, day).is_none());
        assert!(declination_deg(f64::NAN, 0.0, 0.0, day).is_none());
        assert!(declination_deg(36.0, 400.0, 0.0, day).is_none());
        assert!(declination_deg(36.0, 137.0, 0.0, date!(2040 - 01 - 01)).is_none());
    }
}
