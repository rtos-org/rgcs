//! External context: external factors only raise the sensitivity of the
//! vehicle-side signs; they never trigger anything on their own.

use serde::{Deserialize, Serialize};

use crate::toilet_bowl::ToiletBowlConfig;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ExtLevel {
    Ok,
    Warn,
    Strong,
}

/// The fused external factors the guard reads. Only Kp feeds it in v1.
#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
pub struct ExternalContext {
    pub kp: Option<ExtLevel>,
}

/// The thresholds actually used for `ctx`.
pub fn effective(cfg: &ToiletBowlConfig, ctx: &ExternalContext) -> ToiletBowlConfig {
    let (compass_var, min_turn_deg) = match ctx.kp {
        Some(ExtLevel::Strong) => (0.3, 180.0),
        Some(ExtLevel::Warn) => (0.4, 225.0),
        Some(ExtLevel::Ok) | None => return cfg.clone(),
    };
    // Only ever more sensitive: an admin value that is already tighter is kept.
    ToiletBowlConfig {
        compass_var: cfg.compass_var.min(compass_var),
        min_turn_deg: cfg.min_turn_deg.min(min_turn_deg),
        ..cfg.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn with(kp: Option<ExtLevel>) -> ToiletBowlConfig {
        effective(&ToiletBowlConfig::default(), &ExternalContext { kp })
    }

    #[test]
    fn kp_warn_and_strong_lower_compass_and_turn_thresholds() {
        let w = with(Some(ExtLevel::Warn));
        assert_eq!((w.compass_var, w.min_turn_deg), (0.4, 225.0));
        let s = with(Some(ExtLevel::Strong));
        assert_eq!((s.compass_var, s.min_turn_deg), (0.3, 180.0));
    }

    #[test]
    fn nothing_else_changes() {
        let d = ToiletBowlConfig::default();
        let s = with(Some(ExtLevel::Strong));
        assert_eq!(
            ToiletBowlConfig {
                compass_var: d.compass_var,
                min_turn_deg: d.min_turn_deg,
                ..s
            },
            d
        );
    }

    #[test]
    fn kp_none_or_ok_keeps_the_defaults() {
        assert_eq!(with(None), ToiletBowlConfig::default());
        assert_eq!(with(Some(ExtLevel::Ok)), ToiletBowlConfig::default());
    }

    #[test]
    fn never_less_sensitive_than_a_tighter_admin_value() {
        let tight = ToiletBowlConfig {
            compass_var: 0.2,
            min_turn_deg: 150.0,
            ..ToiletBowlConfig::default()
        };
        let w = effective(
            &tight,
            &ExternalContext {
                kp: Some(ExtLevel::Warn),
            },
        );
        assert_eq!((w.compass_var, w.min_turn_deg), (0.2, 150.0));
    }
}
