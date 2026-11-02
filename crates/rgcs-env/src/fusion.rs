//! Safety-side fusion: per factor, the level is the max over fresh readings and is
//! never downgraded by a higher-priority reading; `primary` is only the display order.

use serde::{Deserialize, Serialize};

use crate::thresholds::severity;
use crate::{rate, FactorKind, Level, Reading, SourceId, Thresholds};

/// One reading with its freshness and own level.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Rated {
    pub reading: Reading,
    pub fresh: bool,
    pub level: Level,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct FusedFactor {
    pub kind: FactorKind,
    /// Max level of the fresh readings (`Ok` when none is fresh).
    pub level: Level,
    /// The fresh reading that set `level` (ties: higher class, then worse value, then newer).
    pub value: Option<Rated>,
    /// The freshest reading of the highest class present (fresh ones first), shown first.
    pub primary: Option<Rated>,
    /// Every reading, stale ones included (greyed in the UI).
    pub readings: Vec<Rated>,
    pub disagree: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Fused {
    pub factors: Vec<FusedFactor>,
    /// Enabled sources whose last fetch failed.
    pub missing: Vec<SourceId>,
    /// Every enabled reading-producing external source lacks a fresh reading.
    pub unavailable: bool,
}

impl Fused {
    pub fn factor(&self, kind: FactorKind) -> Option<&FusedFactor> {
        self.factors.iter().find(|f| f.kind == kind)
    }

    /// The only factor that feeds the guard in v1. `None` without a fresh Kp reading.
    pub fn kp_level(&self) -> Option<Level> {
        self.factor(FactorKind::Kp)
            .filter(|f| f.value.is_some())
            .map(|f| f.level)
    }
}

/// Spread among fresh readings at or above which sources disagree.
fn disagree_spread(kind: FactorKind) -> Option<f64> {
    match kind {
        FactorKind::Wind | FactorKind::Gust => Some(3.0),
        FactorKind::Temp => Some(5.0),
        FactorKind::Precip => Some(1.0),
        FactorKind::Kp => Some(2.0),
        FactorKind::Declination | FactorKind::Gnss | FactorKind::Daylight => None,
    }
}

fn disagrees(kind: FactorKind, fresh: &[&Rated]) -> bool {
    let Some(spread) = disagree_spread(kind) else {
        return false;
    };
    let values = fresh.iter().map(|r| r.reading.value);
    let max = values.clone().fold(f64::NEG_INFINITY, f64::max);
    let min = values.fold(f64::INFINITY, f64::min);
    fresh.len() >= 2 && max - min >= spread
}

fn fuse_kind(kind: FactorKind, readings: Vec<Rated>, th: &Thresholds) -> FusedFactor {
    let fresh: Vec<&Rated> = readings.iter().filter(|r| r.fresh).collect();
    let level = fresh.iter().map(|r| r.level).max().unwrap_or(Level::Ok);
    let value = fresh
        .iter()
        .filter(|r| r.level == level)
        .max_by(|a, b| {
            (a.reading.class.cmp(&b.reading.class))
                .then(severity(&a.reading, th).total_cmp(&severity(&b.reading, th)))
                .then(a.reading.at_ms.cmp(&b.reading.at_ms))
        })
        .map(|r| (*r).clone());
    let pool: Vec<&Rated> = if fresh.is_empty() {
        readings.iter().collect()
    } else {
        fresh.clone()
    };
    let primary = pool
        .iter()
        .max_by_key(|r| (r.reading.class, r.reading.at_ms))
        .map(|r| (*r).clone());
    let disagree = disagrees(kind, &fresh);
    FusedFactor {
        kind,
        level,
        value,
        primary,
        readings,
        disagree,
    }
}

fn is_unavailable(readings: &[Rated], enabled: &[SourceId]) -> bool {
    let external: Vec<SourceId> = enabled
        .iter()
        .copied()
        .filter(|s| s.is_external() && s.has_readings())
        .collect();
    !external.is_empty()
        && !readings
            .iter()
            .any(|r| r.fresh && external.contains(&r.reading.source))
}

/// Fuse every reading at `now_ms` with the airframe's thresholds. Factors come out in
/// [`FactorKind::ALL`] order, one per kind that has any reading.
pub fn fuse(
    readings: &[Reading],
    th: &Thresholds,
    enabled: &[SourceId],
    failed: &[SourceId],
    now_ms: u64,
) -> Fused {
    let rated: Vec<Rated> = readings
        .iter()
        .map(|r| Rated {
            reading: r.clone(),
            fresh: r.is_fresh(now_ms),
            level: rate(r, th),
        })
        .collect();
    let factors = FactorKind::ALL
        .into_iter()
        .filter_map(|kind| {
            let of_kind: Vec<Rated> = rated.iter().filter(|r| r.reading.kind == kind).cloned().collect();
            (!of_kind.is_empty()).then(|| fuse_kind(kind, of_kind, th))
        })
        .collect();
    let missing = enabled.iter().copied().filter(|s| failed.contains(s)).collect();
    Fused {
        factors,
        missing,
        unavailable: is_unavailable(&rated, enabled),
    }
}
