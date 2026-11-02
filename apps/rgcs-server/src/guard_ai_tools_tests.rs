//! The AI's read-only `list_guard_alerts` tool against a live guard: the alert is
//! read with the vehicle name as untrusted data, audited with target `ai`, and the tool can
//! never cancel, trigger or change anything.

use rgcs_ai::{ToolCall, ToolHost};

use super::*;
use crate::ai_tools::ServerTools;

fn tools(r: &Rig) -> ServerTools {
    ServerTools::new(r.app.clone(), "op".into(), "c-1".into())
}

/// Every string in `v` with the key that holds it.
fn strings<'a>(key: &'a str, v: &'a Value, out: &mut Vec<(&'a str, &'a str)>) {
    match v {
        Value::String(s) => out.push((key, s)),
        Value::Array(a) => a.iter().for_each(|x| strings(key, x, out)),
        Value::Object(o) => o.iter().for_each(|(k, x)| strings(k, x, out)),
        _ => {}
    }
}

async fn last_ai_audit(r: &Rig) -> rgcs_store::audit::AuditEntry {
    r.audit()
        .await
        .into_iter()
        .find(|a| a.target == "ai")
        .expect("an ai audit row")
}

#[tokio::test]
async fn the_active_alert_is_listed_with_the_vehicle_name_untrusted() {
    let mut r = copter_rig().await;
    r.enable("l2").await;
    let a = Feed::new(&r, toilet_bowl()).until_alert(&r).await;
    r.flush().await;
    let before = r.app.guard.active_alerts();
    let v = tools(&r)
        .run(&ToolCall::ListGuardAlerts { sysid: None })
        .await
        .unwrap();
    assert_eq!((&v["enabled"], &v["level"]), (&json!(true), &json!("l2")), "{v}");
    let list = v["alerts"].as_array().expect("alerts");
    assert_eq!(list.len(), 1, "{v}");
    let got = &list[0];
    assert_eq!(got["id"], json!(a.id));
    assert_eq!(got["sysid"], 1);
    assert!(got["phase"].is_string() && got["event"] == "toilet_bowl", "{got}");
    assert_eq!(got["untrusted_text"], "UAV-01");
    assert!(got["text"].as_str().unwrap().contains("toilet bowl") || got["phase"] != "alerting");
    let mut found = Vec::new();
    strings("", &v, &mut found);
    let named: Vec<_> = found.iter().filter(|(_, s)| s.contains("UAV-01")).collect();
    assert!(named.iter().all(|(k, _)| *k == "untrusted_text"), "{v}");
    let audit = last_ai_audit(&r).await;
    assert_eq!(
        (
            audit.command.as_str(),
            audit.result.as_str(),
            audit.operator.as_str()
        ),
        ("list_guard_alerts", "ok", "op")
    );
    assert_eq!(audit.sysid, None);
    let none = tools(&r)
        .run(&ToolCall::ListGuardAlerts { sysid: Some(2) })
        .await
        .unwrap();
    assert_eq!(none["alerts"], json!([]));
    assert_eq!(last_ai_audit(&r).await.sysid, Some(2));
    // Reading changed nothing: same alert, nothing queued.
    assert_eq!(r.app.guard.active_alerts(), before);
    assert!(r.queued().is_empty());
}

#[tokio::test]
async fn while_the_guard_is_off_the_tool_says_so() {
    let r = copter_rig().await;
    let v = tools(&r)
        .run(&ToolCall::ListGuardAlerts { sysid: None })
        .await
        .unwrap();
    assert_eq!(v, json!({ "enabled": false }));
    let audit = last_ai_audit(&r).await;
    assert_eq!(
        (audit.command.as_str(), audit.result.as_str()),
        ("list_guard_alerts", "ok")
    );
}

#[test]
fn the_ai_tools_have_no_path_to_cancel_or_the_queue() {
    for (name, src) in [
        ("ai_tools.rs", include_str!("ai_tools.rs")),
        ("ai_tools_guard.rs", include_str!("ai_tools_guard.rs")),
    ] {
        for banned in ["guard.cancel", "queue", "apply_settings", "note_operator_command"] {
            assert!(!src.contains(banned), "{name} contains {banned}");
        }
    }
}
