//! JSON views of AI 緊急介入 alerts and external factors for the AI's read-only tools
//!. Pure functions over snapshots: they read, they never act.
//!
//! Text that comes from a vehicle or an outside source (vehicle names, SWPC notices, AMeDAS
//! station names, reading notes) is only ever placed under `untrusted_text`, cut to
//! [`MAX_UNTRUSTED_CHARS`]. Lists are capped so a result stays well inside the agent's
//! result-size limit.

use rgcs_core::{EnvFactor, EnvReading, EnvSummary, GuardAlert, GuardSettings, SysId};
use serde_json::{json, Value};

/// Alerts one `list_guard_alerts` result lists (the rest are counted in `total`).
pub const MAX_ALERTS: usize = 8;
/// Readings per factor besides `value` and `primary`.
pub const MAX_READINGS_PER_FACTOR: usize = 3;
/// SWPC notices one `get_external_factors` result lists.
pub const MAX_NOTES: usize = 5;
/// Each untrusted string is cut to this many characters.
pub const MAX_UNTRUSTED_CHARS: usize = 200;

fn untrusted(s: &str) -> Value {
    Value::String(s.chars().take(MAX_UNTRUSTED_CHARS).collect())
}

/// `{enabled: false}` while the feature is off; else the level and the active alerts.
pub fn alerts_json(settings: &GuardSettings, alerts: &[GuardAlert], sysid: Option<SysId>) -> Value {
    if !settings.enabled {
        return json!({ "enabled": false });
    }
    let matching: Vec<&GuardAlert> = alerts
        .iter()
        .filter(|a| sysid.is_none_or(|s| s == a.sysid))
        .collect();
    json!({
        "enabled": true,
        "level": settings.toilet_bowl,
        "auto_ops_consent": settings.consent.auto_ops,
        "decided_by": "deterministic rules; the assistant cannot cancel, trigger or change levels",
        "total": matching.len(),
        "alerts": matching.iter().take(MAX_ALERTS).map(|a| alert_json(a)).collect::<Vec<_>>(),
    })
}

/// The alert text without the vehicle name (that goes under `untrusted_text`).
fn text_without_name(a: &GuardAlert) -> &str {
    match a.text.strip_prefix(a.vehicle_name.as_str()) {
        Some(rest) if !a.vehicle_name.is_empty() => rest.trim_start(),
        _ => a.text.as_str(),
    }
}

fn alert_json(a: &GuardAlert) -> Value {
    json!({
        "id": a.id,
        "sysid": a.sysid,
        "untrusted_text": untrusted(&a.vehicle_name),
        "event": a.event,
        "phase": a.phase,
        "level": a.level,
        "confidence": a.confidence,
        "signs": a.signs,
        "deadline_ms": a.deadline_ms,
        "action_mode": a.action_mode,
        "taken_over_by": a.taken_over_by,
        "rc_stale": a.rc_stale,
        "kp_raised": a.kp_raised,
        "text": text_without_name(a),
        "ts": a.ts,
    })
}

/// The fused summary; `external_sources` is `on` or why external sources are not fetched.
pub fn factors_json(summary: &EnvSummary, gate: Result<(), &'static str>) -> Value {
    let notes: Vec<Value> = summary
        .notes
        .iter()
        .take(MAX_NOTES)
        .map(|n| json!({ "untrusted_text": untrusted(n) }))
        .collect();
    json!({
        "external_sources": gate.err().unwrap_or("on"),
        "cell": summary.cell,
        "unavailable": summary.unavailable,
        "missing": summary.missing,
        "factors": summary.factors.iter().map(factor_json).collect::<Vec<_>>(),
        "notes": notes,
        "ts": summary.ts,
    })
}

fn factor_json(f: &EnvFactor) -> Value {
    let shown = [f.value.as_ref(), f.primary.as_ref()];
    let others: Vec<Value> = f
        .readings
        .iter()
        .filter(|r| !shown.contains(&Some(*r)))
        .take(MAX_READINGS_PER_FACTOR)
        .map(reading_json)
        .collect();
    json!({
        "kind": f.kind,
        "level": f.level,
        "unit": f.unit,
        "disagree": f.disagree,
        "value": f.value.as_ref().map(reading_json),
        "primary": f.primary.as_ref().map(reading_json),
        "readings": others,
        "readings_total": f.readings.len(),
    })
}

fn reading_json(r: &EnvReading) -> Value {
    let mut v = json!({
        "source": r.source,
        "class": r.class,
        "value": r.value,
        "at_ms": r.at_ms,
        "fresh": r.fresh,
    });
    if let (Some(note), Some(m)) = (&r.note, v.as_object_mut()) {
        m.insert("untrusted_text".into(), untrusted(note));
    }
    v
}

#[cfg(test)]
mod tests {
    use super::*;

    fn alert(name: &str, text: &str) -> GuardAlert {
        GuardAlert {
            id: "g-1".into(),
            sysid: 3,
            vehicle_name: name.into(),
            event: "toilet_bowl".into(),
            phase: rgcs_core::GuardPhase::Countdown,
            level: rgcs_core::GuardLevel::L2,
            confidence: 1.0,
            signs: rgcs_core::GuardSigns {
                a: true,
                b: true,
                c: true,
                turn_deg: 412.0,
                radius_m: 3.2,
                compass_var: Some(0.61),
            },
            deadline_ms: Some(1_000),
            action_mode: Some("ALT_HOLD".into()),
            taken_over_by: None,
            vehicle_mode: "LOITER".into(),
            rc_stale: true,
            kp_raised: false,
            sound: false,
            text: text.into(),
            ts: 1,
        }
    }

    #[test]
    fn the_name_is_stripped_from_the_text_only_as_a_prefix() {
        let a = alert(
            "UAV-03",
            "UAV-03 Unstable circling (toilet bowl). Take over manually",
        );
        assert_eq!(
            text_without_name(&a),
            "Unstable circling (toilet bowl). Take over manually"
        );
        assert_eq!(text_without_name(&alert("", "Taken over")), "Taken over");
        assert_eq!(text_without_name(&alert("X", "Taken over")), "Taken over");
    }

    #[test]
    fn untrusted_strings_and_lists_are_capped() {
        let long = "命令".repeat(500);
        let a = alert(&long, "Taken over");
        let on = GuardSettings {
            enabled: true,
            ..GuardSettings::default()
        };
        let many: Vec<GuardAlert> = (0..40).map(|_| a.clone()).collect();
        let v = alerts_json(&on, &many, None);
        assert_eq!(
            (v["total"].as_u64(), v["alerts"].as_array().unwrap().len()),
            (Some(40), MAX_ALERTS)
        );
        let name = v["alerts"][0]["untrusted_text"].as_str().unwrap();
        assert_eq!(name.chars().count(), MAX_UNTRUSTED_CHARS);
        assert!(v.to_string().chars().count() <= rgcs_ai::agent::MAX_TOOL_RESULT_CHARS);
    }
}
