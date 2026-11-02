//! The AI's read-only `get_external_factors` tool: factors with source and time,
//! SWPC notices and station names only under `untrusted_text`, audited with target `ai`.

use rgcs_ai::{ToolCall, ToolHost};

use super::*;
use crate::ai_tools::ServerTools;

async fn run(rig: &Rig) -> Value {
    let t = ServerTools::new(rig.app.clone(), "op".into(), "c-1".into());
    t.run(&ToolCall::GetExternalFactors).await.unwrap()
}

fn readings(f: &Value) -> Vec<&Value> {
    let mut out: Vec<&Value> = f["readings"].as_array().unwrap().iter().collect();
    out.extend([&f["value"], &f["primary"]].into_iter().filter(|r| !r.is_null()));
    out
}

#[tokio::test]
async fn factors_carry_source_and_time_and_notices_are_untrusted() {
    let rig = Rig::new().await;
    rig.consent(true, true);
    rig.vehicle_at(RAW.0, RAW.1).await;
    for id in [SourceId::SwpcKp1m, SourceId::SwpcAlerts, SourceId::JmaAmedas] {
        assert_eq!(rig.fetch(id).await.last_error, None, "{id:?}");
    }
    let v = run(&rig).await;
    assert_eq!(v["external_sources"], "on", "{v}");
    let factors = v["factors"].as_array().expect("factors");
    let kp = factors.iter().find(|f| f["kind"] == "kp").expect("kp");
    assert_eq!(kp["level"], "strong");
    assert_eq!(kp["value"]["source"], "swpc_kp_1m");
    for f in factors {
        for r in readings(f) {
            assert!(
                r["source"].is_string() && r["at_ms"].is_u64() && r["fresh"].is_boolean(),
                "{r}"
            );
            assert!(r.get("note").is_none(), "notes go under untrusted_text: {r}");
        }
    }
    let notes = v["notes"].as_array().expect("notes");
    assert!(
        notes[0]["untrusted_text"].as_str().unwrap().starts_with("K07A"),
        "{v}"
    );
    let station = factors
        .iter()
        .flat_map(readings)
        .find(|r| r["source"] == "jma_amedas")
        .expect("an AMeDAS reading");
    assert!(
        station["untrusted_text"].as_str().unwrap().contains("気象庁"),
        "{station}"
    );
    assert!(
        v.to_string().chars().count() <= rgcs_ai::agent::MAX_TOOL_RESULT_CHARS,
        "{v}"
    );
    let audit = rig.app.store.recent_audit(1).await.unwrap().remove(0);
    assert_eq!(
        (
            audit.target.as_str(),
            audit.command.as_str(),
            audit.result.as_str()
        ),
        ("ai", "get_external_factors", "ok")
    );
}

#[tokio::test]
async fn while_off_only_local_factors_are_read_and_nothing_is_fetched() {
    let rig = Rig::new().await;
    rig.vehicle_at(RAW.0, RAW.1).await;
    rig.env().refresh().await;
    let v = run(&rig).await;
    assert_eq!(v["external_sources"], "guard_disabled", "{v}");
    assert!(v["factors"]
        .as_array()
        .unwrap()
        .iter()
        .any(|f| f["kind"] == "daylight"));
    assert!(rig.fake.seen().is_empty(), "{:?}", rig.fake.seen());
}
