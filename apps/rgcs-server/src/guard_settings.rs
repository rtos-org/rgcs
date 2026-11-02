//! 実験機能 › AI 緊急介入 settings: load / validate / store, and the mapping to the pure
//! `rgcs_guard::Policy`.

use rgcs_core::{GuardConsent, GuardLevel, GuardSettings, GUARD_COUNTDOWN_S, GUARD_TAKEOVER_WAIT_S};
use rgcs_guard::{Level, Policy, ToiletBowlConfig};
use rgcs_store::app_settings::GUARD_SETTINGS;
use rgcs_store::Store;
use serde::{Deserialize, Deserializer};
use serde_json::{json, Map, Value};

/// The consent dialog's answer; `by` / `at_ms` are set by the server.
#[derive(Debug, Clone, Deserialize)]
pub struct ConsentPut {
    pub monitoring: bool,
    #[serde(default)]
    pub external_data: bool,
    #[serde(default)]
    pub auto_ops: bool,
}

/// `PUT /api/guard/settings` body: every field optional.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct GuardSettingsPut {
    pub enabled: Option<bool>,
    pub consent: Option<ConsentPut>,
    pub toilet_bowl: Option<GuardLevel>,
    pub countdown_s: Option<u32>,
    pub takeover_wait_s: Option<u32>,
    /// Absent = keep; `null` = the built-in defaults; an object = a `ToiletBowlConfig`.
    #[serde(default, deserialize_with = "present")]
    pub params: Option<Value>,
}

fn present<'de, D: Deserializer<'de>>(d: D) -> Result<Option<Value>, D::Error> {
    Value::deserialize(d).map(Some)
}

#[derive(Debug, Clone, PartialEq)]
pub struct Refusal {
    pub code: &'static str,
    pub message: String,
}

fn refuse(code: &'static str, message: impl Into<String>) -> Refusal {
    Refusal {
        code,
        message: message.into(),
    }
}

/// One audit row for an accepted change (`target = "ai_intervention"`).
#[derive(Debug, Clone, PartialEq)]
pub struct Change {
    pub command: &'static str,
    pub args: Value,
}

/// The settings after `put` by admin `by`, plus the audit rows; a disable clears
/// the consent (and caps the level at L1, so a re-enable asks for consent 3 again).
pub fn apply_put(
    cur: &GuardSettings,
    put: GuardSettingsPut,
    by: &str,
    now_ms: u64,
) -> Result<(GuardSettings, Vec<Change>), Refusal> {
    let disabling = put.enabled == Some(false);
    let consent = match (&put.consent, disabling) {
        (_, true) => GuardConsent::default(),
        (Some(c), false) => GuardConsent {
            monitoring: c.monitoring,
            external_data: c.external_data,
            auto_ops: c.auto_ops,
            by: Some(by.to_string()),
            at_ms: Some(now_ms),
        },
        (None, false) => cur.consent.clone(),
    };
    let level = put.toilet_bowl.unwrap_or(cur.toilet_bowl);
    let next = GuardSettings {
        enabled: put.enabled.unwrap_or(cur.enabled),
        consent,
        toilet_bowl: if disabling {
            level.min(GuardLevel::L1)
        } else {
            level
        },
        countdown_s: put.countdown_s.unwrap_or(cur.countdown_s),
        takeover_wait_s: put.takeover_wait_s.unwrap_or(cur.takeover_wait_s),
        params: match put.params {
            Some(p) => normalize_params(p)?,
            None => cur.params.clone(),
        },
    };
    validate(&next)?;
    let changes = changes(cur, &next);
    Ok((next, changes))
}

fn validate(s: &GuardSettings) -> Result<(), Refusal> {
    if !GUARD_COUNTDOWN_S.contains(&s.countdown_s) {
        return Err(refuse("validation", "countdown_s must be 3..=15"));
    }
    if !GUARD_TAKEOVER_WAIT_S.contains(&s.takeover_wait_s) {
        return Err(refuse("validation", "takeover_wait_s must be 10..=120"));
    }
    if s.enabled && !s.consent.monitoring {
        return Err(refuse(
            "consent_required",
            "consent 1 (monitoring) is required to enable",
        ));
    }
    if s.toilet_bowl >= GuardLevel::L2 && !s.consent.auto_ops {
        return Err(refuse(
            "auto_ops_consent_required",
            "L2 / L3 need consent 3 (automatic operation)",
        ));
    }
    Ok(())
}

/// `null` stays `null` (defaults); an object must be a sane `ToiletBowlConfig`.
fn normalize_params(p: Value) -> Result<Value, Refusal> {
    if p.is_null() {
        return Ok(Value::Null);
    }
    let cfg: ToiletBowlConfig =
        serde_json::from_value(p).map_err(|e| refuse("validation", format!("params: {e}")))?;
    check_config(&cfg).map_err(|m| refuse("validation", m))?;
    serde_json::to_value(cfg).map_err(|e| refuse("validation", e.to_string()))
}

fn check_config(c: &ToiletBowlConfig) -> Result<(), String> {
    let positive = [
        ("min_speed_mps", c.min_speed_mps),
        ("min_turn_deg", c.min_turn_deg),
        ("turn_consistency", c.turn_consistency),
        ("min_radius_growth_mps", c.min_radius_growth_mps),
        ("min_radius_m", c.min_radius_m),
        ("heading_course_deg", c.heading_course_deg),
        ("heading_course_frac", c.heading_course_frac),
        ("compass_var", c.compass_var),
    ];
    if let Some((name, _)) = positive.iter().find(|(_, v)| !(v.is_finite() && *v > 0.0)) {
        return Err(format!("params.{name} must be a positive number"));
    }
    if c.turn_consistency > 1.0 || c.heading_course_frac > 1.0 {
        return Err("params fractions must be at most 1".into());
    }
    if !(1_000..=60_000).contains(&c.window_ms) || !(1..=600).contains(&c.min_samples) {
        return Err("params.window_ms must be 1000..=60000 and min_samples 1..=600".into());
    }
    if c.compass_hold_ms == 0 || c.clear_ms == 0 {
        return Err("params.compass_hold_ms and clear_ms must be positive".into());
    }
    Ok(())
}

fn consent_json(c: &GuardConsent) -> Value {
    json!({ "monitoring": c.monitoring, "external_data": c.external_data, "auto_ops": c.auto_ops })
}

fn changes(cur: &GuardSettings, next: &GuardSettings) -> Vec<Change> {
    let mut out = Vec::new();
    if cur.enabled != next.enabled {
        let command = if next.enabled { "enable" } else { "disable" };
        let args = json!({ "enabled": next.enabled, "consent": consent_json(&next.consent) });
        out.push(Change { command, args });
    }
    if cur.toilet_bowl != next.toilet_bowl {
        out.push(Change {
            command: "set_level",
            args: json!({ "toilet_bowl": next.toilet_bowl }),
        });
    }
    let params = params_changed(cur, next);
    if !params.is_empty() {
        out.push(Change {
            command: "set_guard_params",
            args: Value::Object(params),
        });
    }
    out
}

/// Changed countdown / takeover wait / params, and a consent change not already in an
/// enable / disable row.
fn params_changed(cur: &GuardSettings, next: &GuardSettings) -> Map<String, Value> {
    let mut m = Map::new();
    if cur.countdown_s != next.countdown_s {
        m.insert("countdown_s".into(), next.countdown_s.into());
    }
    if cur.takeover_wait_s != next.takeover_wait_s {
        m.insert("takeover_wait_s".into(), next.takeover_wait_s.into());
    }
    if cur.params != next.params {
        m.insert("params".into(), next.params.clone());
    }
    let consent_moved = consent_json(&cur.consent) != consent_json(&next.consent);
    if consent_moved && cur.enabled == next.enabled {
        m.insert("consent".into(), consent_json(&next.consent));
    }
    m
}

pub fn level(l: GuardLevel) -> Level {
    match l {
        GuardLevel::L0 => Level::L0,
        GuardLevel::L1 => Level::L1,
        GuardLevel::L2 => Level::L2,
        GuardLevel::L3 => Level::L3,
    }
}

pub fn guard_level(l: Level) -> GuardLevel {
    match l {
        Level::L0 => GuardLevel::L0,
        Level::L1 => GuardLevel::L1,
        Level::L2 => GuardLevel::L2,
        Level::L3 => GuardLevel::L3,
    }
}

/// Enabled only with consent 1; consent 3 travels as `auto_ops` (the machine caps L2 / L3).
pub fn policy(s: &GuardSettings) -> Policy {
    Policy {
        enabled: s.enabled && s.consent.monitoring,
        auto_ops: s.consent.auto_ops,
        level: level(s.toilet_bowl),
        countdown_ms: u64::from(s.countdown_s) * 1_000,
        takeover_wait_ms: u64::from(s.takeover_wait_s) * 1_000,
    }
}

/// The admin's detector config (`params`), or the built-in defaults.
pub fn config(s: &GuardSettings) -> ToiletBowlConfig {
    serde_json::from_value::<ToiletBowlConfig>(s.params.clone())
        .ok()
        .filter(|c| check_config(c).is_ok())
        .unwrap_or_default()
}

/// Stored settings; missing or unreadable → off (the default).
pub async fn load(store: &Store) -> GuardSettings {
    let raw = match store.app_setting(GUARD_SETTINGS).await {
        Ok(Some(raw)) => raw,
        Ok(None) => return GuardSettings::default(),
        Err(e) => {
            tracing::warn!(error = %e, "guard settings could not be read; the guard stays off");
            return GuardSettings::default();
        }
    };
    let parsed = serde_json::from_str::<GuardSettings>(&raw).ok();
    match parsed.filter(|s| validate(s).is_ok()) {
        Some(s) => s,
        None => {
            tracing::warn!("stored guard settings are invalid; the guard stays off");
            GuardSettings::default()
        }
    }
}

pub async fn save(store: &Store, s: &GuardSettings) -> rgcs_store::Result<()> {
    let json = serde_json::to_string(s).unwrap_or_default();
    store.put_app_setting(GUARD_SETTINGS, &json).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn put(v: Value) -> GuardSettingsPut {
        serde_json::from_value(v).unwrap()
    }

    fn enabled_l2() -> GuardSettings {
        let consent = json!({ "monitoring": true, "auto_ops": true });
        let body = put(json!({ "enabled": true, "consent": consent, "toilet_bowl": "l2" }));
        apply_put(&GuardSettings::default(), body, "admin", 5).unwrap().0
    }

    #[test]
    fn consent_is_stamped_with_the_admin_and_time() {
        let s = enabled_l2();
        assert_eq!(
            (s.consent.by.as_deref(), s.consent.at_ms),
            (Some("admin"), Some(5))
        );
        assert_eq!(policy(&s).effective_level(), Level::L2);
    }

    #[test]
    fn disable_clears_consent_and_caps_the_level() {
        let (s, changes) = apply_put(&enabled_l2(), put(json!({ "enabled": false })), "admin", 9).unwrap();
        assert_eq!(s.consent, GuardConsent::default());
        assert_eq!(s.toilet_bowl, GuardLevel::L1);
        let commands: Vec<&str> = changes.iter().map(|c| c.command).collect();
        assert_eq!(commands, vec!["disable", "set_level"]);
        assert_eq!(policy(&s).effective_level(), Level::L0);
    }

    #[test]
    fn params_null_means_defaults_and_absent_means_keep() {
        let p = put(json!({ "params": null }));
        assert_eq!(p.params, Some(Value::Null));
        assert_eq!(put(json!({})).params, None);
        let custom = GuardSettings {
            params: json!({ "min_turn_deg": 300.0 }),
            ..GuardSettings::default()
        };
        assert_eq!(config(&custom).min_turn_deg, 300.0);
        assert_eq!(config(&GuardSettings::default()), ToiletBowlConfig::default());
    }

    #[test]
    fn insane_params_are_refused() {
        for bad in [
            json!({ "window_ms": 0 }),
            json!({ "turn_consistency": 1.5 }),
            json!({ "compass_var": 0.0 }),
        ] {
            let err =
                apply_put(&GuardSettings::default(), put(json!({ "params": bad })), "a", 0).unwrap_err();
            assert_eq!(err.code, "validation");
        }
    }

    #[test]
    fn withdrawing_consent_3_needs_a_lower_level() {
        let body = put(json!({ "consent": { "monitoring": true, "auto_ops": false } }));
        let err = apply_put(&enabled_l2(), body, "admin", 9).unwrap_err();
        assert_eq!(err.code, "auto_ops_consent_required");
        let body = put(json!({ "consent": { "monitoring": true }, "toilet_bowl": "l1" }));
        assert!(apply_put(&enabled_l2(), body, "admin", 9).is_ok());
    }
}
