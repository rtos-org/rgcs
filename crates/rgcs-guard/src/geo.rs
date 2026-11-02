//! Local geometry: angle wrap, a local east/north projection and the Kåsa circle fit.

/// Mean Earth radius (m), as used by the rest of RGCS for short local distances.
pub const EARTH_RADIUS_M: f64 = 6_371_008.8;

/// Local east / north offset in metres.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Enu {
    pub e: f64,
    pub n: f64,
}

/// A fitted circle in the local plane.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Circle {
    pub cx: f64,
    pub cy: f64,
    pub r: f64,
}

/// Wraps an angle in degrees into (-180, 180].
pub fn wrap_deg(deg: f32) -> f32 {
    let w = deg.rem_euclid(360.0);
    if w > 180.0 {
        w - 360.0
    } else {
        w
    }
}

/// Equirectangular projection of `(lat, lon)` around `(lat0, lon0)`; good to centimetres over
/// the few hundred metres a detector window covers.
pub fn enu(lat0: f64, lon0: f64, lat: f64, lon: f64) -> Enu {
    let n = (lat - lat0).to_radians() * EARTH_RADIUS_M;
    let e = (lon - lon0).to_radians() * EARTH_RADIUS_M * lat0.to_radians().cos();
    Enu { e, n }
}

/// Algebraic (Kåsa) least-squares circle fit. `None` with fewer than 3 points or when the
/// points are (nearly) collinear.
pub fn kasa_fit(points: &[(f64, f64)]) -> Option<Circle> {
    if points.len() < 3 {
        return None;
    }
    // Centre the data first: the normal equations are far better conditioned around the mean.
    let count = points.len() as f64;
    let (mx, my) = points
        .iter()
        .fold((0.0, 0.0), |(sx, sy), (x, y)| (sx + x, sy + y));
    let (mx, my) = (mx / count, my / count);
    let [sxx, sxy, syy, sxz, syz, sz] = points.iter().fold([0.0f64; 6], |acc, &(px, py)| {
        let (x, y) = (px - mx, py - my);
        let z = x * x + y * y;
        [
            acc[0] + x * x,
            acc[1] + x * y,
            acc[2] + y * y,
            acc[3] + x * z,
            acc[4] + y * z,
            acc[5] + z,
        ]
    });
    // With centred data the fit reduces to [sxx sxy; sxy syy] · (a, b) = ½ (sxz, syz) for the
    // centre (a, b), and r² = a² + b² + mean(z).
    let det = sxx * syy - sxy * sxy;
    let scale = (sxx + syy).powi(2);
    if scale <= 0.0 || det.abs() <= 1e-9 * scale {
        return None;
    }
    let a = 0.5 * (sxz * syy - syz * sxy) / det;
    let b = 0.5 * (syz * sxx - sxz * sxy) / det;
    let r2 = a * a + b * b + sz / count;
    (r2 > 0.0).then(|| Circle {
        cx: a + mx,
        cy: b + my,
        r: r2.sqrt(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wrap_deg_maps_into_half_open_range() {
        assert!((wrap_deg(370.0) - 10.0).abs() < 1e-4);
        assert!((wrap_deg(-190.0) - 170.0).abs() < 1e-4);
        assert!((wrap_deg(180.0) - 180.0).abs() < 1e-4);
        assert!((wrap_deg(-180.0) - 180.0).abs() < 1e-4);
        assert!((wrap_deg(-45.0) + 45.0).abs() < 1e-4);
    }

    #[test]
    fn kasa_fit_recovers_an_exact_circle() {
        let pts: Vec<(f64, f64)> = (0..36)
            .map(|i| {
                let a = f64::from(i) * 10f64.to_radians();
                (3.0 + 5.0 * a.cos(), -2.0 + 5.0 * a.sin())
            })
            .collect();
        let c = kasa_fit(&pts).expect("fit");
        assert!((c.cx - 3.0).abs() < 1e-6, "cx {}", c.cx);
        assert!((c.cy + 2.0).abs() < 1e-6, "cy {}", c.cy);
        assert!((c.r - 5.0).abs() < 1e-6, "r {}", c.r);
    }

    #[test]
    fn kasa_fit_rejects_collinear_and_tiny_inputs() {
        let line: Vec<(f64, f64)> = (0..20).map(|i| (f64::from(i), 2.0 * f64::from(i))).collect();
        assert!(kasa_fit(&line).is_none());
        assert!(kasa_fit(&[(0.0, 0.0), (1.0, 1.0)]).is_none());
    }

    #[test]
    fn enu_north_for_a_ten_thousandth_degree() {
        let p = enu(36.2509, 137.6385, 36.2510, 137.6385);
        assert!((p.n - 11.1).abs() <= 0.05, "n {}", p.n);
        assert!(p.e.abs() < 1e-9);
        let q = enu(36.2509, 137.6385, 36.2509, 137.6386);
        assert!(
            (q.e - 11.1 * 36.2509f64.to_radians().cos()).abs() < 0.05,
            "e {}",
            q.e
        );
    }
}
