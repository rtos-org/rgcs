//! AI 緊急介入 (experimental) types: settings with the 3-part consent, and the alert the
//! server pushes on every phase change (spec 2026-10-24 §3–§5.2, `guard_alert` WS frame).

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::vehicle::SysId;

/// Countdown before an L2 action, seconds (default 5).
pub const GUARD_COUNTDOWN_S: std::ops::RangeInclusive<u32> = 3..=15;
/// How long to wait for a takeover after an action, seconds (default 20).
pub const GUARD_TAKEOVER_WAIT_S: std::ops::RangeInclusive<u32> = 10..=120;

/// L0 off, L1 warn only, L2 act after a cancellable countdown, L3 act at once.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, rename_all = "snake_case")]
pub enum GuardLevel {
    L0,
    L1,
    L2,
    L3,
}

/// The consent dialog's three parts; `monitoring` is required to enable, `auto_ops` for L2 / L3.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct GuardConsent {
    pub monitoring: bool,
    pub external_data: bool,
    pub auto_ops: bool,
    pub by: Option<String>,
    #[ts(type = "number | null")]
    pub at_ms: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct GuardSettings {
    pub enabled: bool,
    pub consent: GuardConsent,
    /// Level for the toilet-bowl event.
    pub toilet_bowl: GuardLevel,
    pub countdown_s: u32,
    pub takeover_wait_s: u32,
    /// `rgcs_guard::ToiletBowlConfig` as JSON (`null` = the built-in defaults).
    #[ts(type = "unknown")]
    pub params: serde_json::Value,
}

/// Off, no consent, warn-only level, 5 s countdown, 20 s takeover wait (fixed values).
impl Default for GuardSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            consent: GuardConsent::default(),
            toilet_bowl: GuardLevel::L1,
            countdown_s: 5,
            takeover_wait_s: 20,
            params: serde_json::Value::Null,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export, rename_all = "snake_case")]
pub enum GuardPhase {
    Alerting,
    Countdown,
    /// The L2 countdown ended without a fresh detection: still cancellable, switches on the next
    /// fresh detection until the signs clear.
    Due,
    Executing,
    Executed,
    Cancelled,
    TakenOver,
    Unanswered,
    Refused,
    Cleared,
}

/// Which toilet-bowl signs hold (A rotation + spiral, B heading ≠ course, C compass variance).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct GuardSigns {
    pub a: bool,
    pub b: bool,
    pub c: bool,
    pub turn_deg: f32,
    pub radius_m: f32,
    pub compass_var: Option<f32>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct GuardAlert {
    /// `"g-<uuid>"`.
    pub id: String,
    pub sysid: SysId,
    pub vehicle_name: String,
    /// `"toilet_bowl"`.
    pub event: String,
    pub phase: GuardPhase,
    pub level: GuardLevel,
    pub confidence: f32,
    pub signs: GuardSigns,
    /// Unix ms when the countdown / takeover wait ends.
    #[ts(type = "number | null")]
    pub deadline_ms: Option<u64>,
    /// `"ALT_HOLD"` / `"QHOVER"` once an action is planned or taken.
    pub action_mode: Option<String>,
    /// On `taken_over`: `"rc"` (sticks), `"gcs_command"` (an operator command) or
    /// `"mode_change"` (a mode change the guard did not make: a pilot's mode switch or a vehicle
    /// failsafe, which the guard cannot tell apart). `null` otherwise.
    pub taken_over_by: Option<String>,
    /// The vehicle's flight mode when the alert was built.
    pub vehicle_mode: String,
    /// No `RC_CHANNELS` for > 2 s: only a GCS command counts as takeover.
    pub rc_stale: bool,
    /// A high Kp raised the detector's sensitivity.
    pub kp_raised: bool,
    /// The UI plays the alert tone.
    pub sound: bool,
    pub text: String,
    #[ts(type = "number")]
    pub ts: u64,
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    pub(crate) fn sample_alert() -> GuardAlert {
        GuardAlert {
            id: "g-1".into(),
            sysid: 3,
            vehicle_name: "UAV-03".into(),
            event: "toilet_bowl".into(),
            phase: GuardPhase::Countdown,
            level: GuardLevel::L2,
            confidence: 0.7,
            signs: GuardSigns {
                a: true,
                b: false,
                c: true,
                turn_deg: 300.0,
                radius_m: 2.5,
                compass_var: Some(0.62),
            },
            deadline_ms: Some(1_761_350_400_000),
            action_mode: Some("ALT_HOLD".into()),
            taken_over_by: None,
            vehicle_mode: "LOITER".into(),
            rc_stale: false,
            kp_raised: false,
            sound: true,
            text: "UAV-03 Unstable circling (toilet bowl). Take over manually".into(),
            ts: 1_761_350_395_000,
        }
    }

    #[test]
    fn levels_and_phases_are_snake_case() {
        assert_eq!(serde_json::to_value(GuardLevel::L2).unwrap(), "l2");
        assert_eq!(serde_json::to_value(GuardPhase::TakenOver).unwrap(), "taken_over");
        assert_eq!(
            serde_json::from_str::<GuardLevel>(r#""l3""#).unwrap(),
            GuardLevel::L3
        );
    }

    #[test]
    fn alert_deadline_is_a_number() {
        let json = serde_json::to_value(sample_alert()).unwrap();
        assert_eq!(json["deadline_ms"], 1_761_350_400_000_u64);
        assert!(json["deadline_ms"].is_u64());
        assert_eq!(json["phase"], "countdown");
        assert_eq!(json["signs"]["c"], true);
    }

    #[test]
    fn default_settings_are_off_and_warn_only() {
        let s = GuardSettings::default();
        assert!(!s.enabled && !s.consent.monitoring && !s.consent.auto_ops);
        assert_eq!(
            (s.toilet_bowl, s.countdown_s, s.takeover_wait_s),
            (GuardLevel::L1, 5, 20)
        );
        assert!(GUARD_COUNTDOWN_S.contains(&s.countdown_s));
        assert!(GUARD_TAKEOVER_WAIT_S.contains(&s.takeover_wait_s));
        let back: GuardSettings = serde_json::from_value(serde_json::to_value(&s).unwrap()).unwrap();
        assert_eq!(back, s);
    }
}
