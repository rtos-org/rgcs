//! Location rounding: only rounded cells ever leave the server.

/// The allowed rounding steps in degrees, with the decimals each is printed with.
pub const ROUNDING_STEPS: [(f64, usize); 3] = [(0.01, 2), (0.05, 2), (0.1, 1)];
pub const DEFAULT_STEP: f64 = 0.01;

/// The step actually used: one of [`ROUNDING_STEPS`], else [`DEFAULT_STEP`].
pub fn valid_step(step: f64) -> (f64, usize) {
    ROUNDING_STEPS
        .iter()
        .copied()
        .find(|(s, _)| (s - step).abs() < 1e-9)
        .unwrap_or((DEFAULT_STEP, 2))
}

/// Round to the nearest multiple of `step`, formatted with the step's decimals.
/// An invalid step falls back to 0.01°, never to the raw position. No `-0.00`.
pub fn round_cell(lat: f64, lon: f64, step: f64) -> (String, String) {
    let (step, decimals) = valid_step(step);
    let fmt = |v: f64| {
        // `+ 0.0` turns a rounded `-0.0` into `0.0`.
        let rounded = (v / step).round() * step + 0.0;
        let text = format!("{rounded:.decimals$}");
        match text.strip_prefix('-') {
            Some(rest) if rest.chars().all(|c| c == '0' || c == '.') => rest.to_string(),
            _ => text,
        }
    };
    (fmt(lat), fmt(lon))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cell(a: &str, b: &str) -> (String, String) {
        (a.to_string(), b.to_string())
    }

    #[test]
    fn rounds_to_the_step_with_its_decimals() {
        assert_eq!(round_cell(36.2509, 137.6385, 0.01), cell("36.25", "137.64"));
        assert_eq!(round_cell(36.2509, 137.6385, 0.1), cell("36.3", "137.6"));
        assert_eq!(round_cell(36.2509, 137.6385, 0.05), cell("36.25", "137.65"));
        assert_eq!(round_cell(-33.8688, -151.2093, 0.01), cell("-33.87", "-151.21"));
    }

    #[test]
    fn never_prints_negative_zero() {
        assert_eq!(round_cell(-0.004, 0.004, 0.01), cell("0.00", "0.00"));
        assert_eq!(round_cell(-0.04, -0.001, 0.1), cell("0.0", "0.0"));
    }

    #[test]
    fn an_invalid_step_falls_back_to_the_default_not_the_raw_position() {
        for step in [0.0, -0.1, f64::NAN, f64::INFINITY, 0.003] {
            assert_eq!(
                round_cell(36.2509, 137.6385, step),
                cell("36.25", "137.64"),
                "{step}"
            );
        }
    }
}
