//! Unit tests of `AiHub` (rate limit, busy flag, conversations, budget, proposals).

use std::sync::Arc;

use rgcs_ai::testing::ScriptedLlm;
use rgcs_ai::{AiConfig, Block, Role, Turn};
use rgcs_core::{AiProposal, AiProviderKind, AiStatus, VehicleCommand};

use super::*;

const MIN: u64 = 60_000;
const DAY: u64 = 24 * 60 * MIN;

fn hub(budget: u64) -> AiHub {
    let status = AiStatus {
        configured: true,
        provider: Some(AiProviderKind::OpenaiCompat),
        model: Some("fake".into()),
        reason: None,
        budget_left: None,
    };
    AiHub::new(
        Arc::new(ScriptedLlm::new(vec![])),
        status,
        AiConfig::default().limits(),
        budget,
    )
}

fn user_turn(text: &str) -> Turn {
    Turn {
        role: Role::User,
        blocks: vec![Block::Text(text.into())],
    }
}

fn exchange(text: &str) -> Vec<Turn> {
    vec![
        user_turn(text),
        Turn {
            role: Role::Assistant,
            blocks: vec![Block::Text("ok".into())],
        },
    ]
}

#[test]
fn the_seventh_chat_within_a_minute_is_rate_limited() {
    let h = hub(0);
    for i in 0..6 {
        drop(h.begin("op", 1_000 + i * 1_000).expect("allowed"));
    }
    match h.begin("op", 7_000) {
        Err(HubRefusal::RateLimited { retry_after_s }) => assert!((1..=60).contains(&retry_after_s)),
        other => panic!("{:?}", other.map(|_| ())),
    }
    assert!(h.begin("other", 7_000).is_ok(), "per user");
    assert!(h.begin("op", 1_000 + MIN + 1).is_ok(), "the window slides");
}

#[test]
fn one_chat_in_flight_per_user() {
    let h = hub(0);
    let first = h.begin("op", 1_000).unwrap();
    assert!(matches!(h.begin("op", 1_001), Err(HubRefusal::Busy)));
    drop(first);
    assert!(h.begin("op", 1_002).is_ok());
}

#[test]
fn conversations_belong_to_their_owner() {
    let h = hub(0);
    let (id, turns) = h.history("op", None, 1_000).unwrap();
    assert!(turns.is_empty());
    assert!(uuid::Uuid::parse_str(&id).is_ok());
    h.commit("op", &id, exchange("hi"), 10, 0, 1_000);
    let (same, turns) = h.history("op", Some(&id), 2_000).unwrap();
    assert_eq!((same.as_str(), turns.len()), (id.as_str(), 2));
    assert!(matches!(
        h.history("intruder", Some(&id), 2_000),
        Err(HubRefusal::Forbidden)
    ));
    assert!(matches!(
        h.history("op", Some("nope"), 2_000),
        Err(HubRefusal::NotFound)
    ));
}

#[test]
fn history_is_append_only_and_bounded() {
    let h = hub(0);
    let (id, _) = h.history("op", None, 0).unwrap();
    for i in 0..20 {
        if i > 0 {
            let (_, turns) = h.history("op", Some(&id), i).unwrap();
            assert_eq!(turns.len() as u64, i * 2);
        }
        h.commit("op", &id, exchange(&format!("q{i}")), 1, 0, i);
    }
    assert!(matches!(h.history("op", Some(&id), 30), Err(HubRefusal::Full)));
}

#[test]
fn a_huge_history_is_full() {
    let h = hub(0);
    let (id, _) = h.history("op", None, 0).unwrap();
    h.commit("op", &id, exchange(&"x".repeat(200_001)), 1, 0, 0);
    assert!(matches!(h.history("op", Some(&id), 1), Err(HubRefusal::Full)));
}

#[test]
fn a_history_costing_a_third_of_the_chat_cap_to_replay_is_full() {
    let h = hub(0);
    let share = AiConfig::default().max_tokens_per_chat / HISTORY_TOKEN_SHARE;
    assert_eq!(share, 20_000);
    let (a, _) = h.history("op", None, 0).unwrap();
    h.commit("op", &a, exchange("hi"), 1, share - 1, 0);
    assert!(h.history("op", Some(&a), 1).is_ok());
    let (b, _) = h.history("op", None, 0).unwrap();
    h.commit("op", &b, exchange("hi"), 1, share, 0);
    assert!(matches!(h.history("op", Some(&b), 1), Err(HubRefusal::Full)));
}

#[test]
fn without_reported_usage_the_history_is_estimated_from_its_characters() {
    let h = hub(0);
    let (id, _) = h.history("op", None, 0).unwrap();
    h.commit("op", &id, exchange(&"x".repeat(80_000)), 1, 0, 0);
    assert!(matches!(h.history("op", Some(&id), 1), Err(HubRefusal::Full)));
}

#[test]
fn idle_conversations_expire() {
    let h = hub(0);
    let (id, _) = h.history("op", None, 0).unwrap();
    h.commit("op", &id, exchange("hi"), 1, 0, 0);
    assert!(h.history("op", Some(&id), 29 * MIN).is_ok());
    h.commit("op", &id, exchange("again"), 1, 0, 29 * MIN);
    assert!(h.history("op", Some(&id), 29 * MIN + 31 * MIN).is_err());
    assert!(matches!(
        h.history("op", Some(&id), 29 * MIN + 31 * MIN),
        Err(HubRefusal::NotFound)
    ));
}

#[test]
fn at_most_64_conversations_are_kept() {
    let h = hub(0);
    let ids: Vec<String> = (0..65u64)
        .map(|i| {
            let (id, _) = h.history("op", None, i).unwrap();
            h.commit("op", &id, exchange("hi"), 1, 0, i);
            id
        })
        .collect();
    assert!(matches!(
        h.history("op", Some(&ids[0]), 100),
        Err(HubRefusal::NotFound)
    ));
    assert!(h.history("op", Some(&ids[1]), 100).is_ok());
    assert!(h.history("op", Some(&ids[64]), 100).is_ok());
}

#[test]
fn the_rolling_budget_spans_conversations() {
    let h = hub(1_000);
    assert_eq!(h.status(0).budget_left, Some(1_000));
    let (a, _) = h.history("op", None, 0).unwrap();
    h.commit("op", &a, exchange("hi"), 900, 0, 0);
    drop(h.begin("op", 10).expect("900 < 1000"));
    let (b, _) = h.history("op", None, 20).unwrap();
    h.commit("op", &b, exchange("hi"), 200, 0, 20);
    assert_eq!(h.status(30).budget_left, Some(0));
    assert!(matches!(h.begin("op", 1_100), Err(HubRefusal::Budget)));
    assert!(
        matches!(h.begin("other", 1_100), Err(HubRefusal::Budget)),
        "server-wide"
    );
    assert!(h.begin("op", DAY + 21).is_ok(), "allowed again after 24 h");
    assert_eq!(h.status(DAY + 21).budget_left, Some(1_000));
}

#[test]
fn an_unlimited_budget_reports_none() {
    let h = hub(0);
    let (a, _) = h.history("op", None, 0).unwrap();
    h.commit("op", &a, exchange("hi"), 5_000_000, 0, 0);
    assert!(h.begin("op", 1).is_ok());
    assert_eq!(h.status(1).budget_left, None);
}

#[test]
fn a_disabled_hub_has_no_client() {
    let h = AiHub::disabled(rgcs_ai::Unconfigured::NoApiKey);
    let s = h.status(0);
    assert!(!s.configured);
    assert_eq!(s.reason.as_deref(), Some("no_api_key"));
    assert!(h.client().is_none());
    assert!(hub(0).client().is_some());
}

fn proposal(id: &str, command: VehicleCommand) -> AiProposal {
    AiProposal {
        id: id.into(),
        sysid: 3,
        vehicle_name: "UAV-03".into(),
        command,
        reason: "test".into(),
        requires_confirm: false,
        created_ms: 1_000,
        expires_ms: 1_000 + PROPOSAL_TTL_MS,
    }
}

#[test]
fn proposals_are_checked_before_execution() {
    let h = hub(0);
    let loiter = VehicleCommand::SetMode {
        mode: "LOITER".into(),
    };
    h.add_proposal(proposal("p-1", loiter.clone()), "op");
    let check =
        |id: &str, user: &str, sysid, cmd: &VehicleCommand, now| h.check_proposal(id, user, sysid, cmd, now);
    assert_eq!(check("p-1", "op", 3, &loiter, 2_000), ProposalCheck::Ok);
    let lower = VehicleCommand::SetMode {
        mode: "loiter".into(),
    };
    assert_eq!(
        check("p-1", "op", 3, &lower, 2_000),
        ProposalCheck::Ok,
        "mode case"
    );
    assert_eq!(check("p-9", "op", 3, &loiter, 2_000), ProposalCheck::NotFound);
    assert_eq!(
        check("p-1", "intruder", 3, &loiter, 2_000),
        ProposalCheck::Forbidden
    );
    assert_eq!(check("p-1", "op", 4, &loiter, 2_000), ProposalCheck::Mismatch);
    let rtl_mode = VehicleCommand::SetMode { mode: "RTL".into() };
    assert_eq!(check("p-1", "op", 3, &rtl_mode, 2_000), ProposalCheck::Mismatch);
    assert_eq!(
        check("p-1", "op", 3, &VehicleCommand::Rtl, 2_000),
        ProposalCheck::Mismatch
    );
    assert_eq!(
        check("p-1", "op", 3, &loiter, 1_000 + PROPOSAL_TTL_MS),
        ProposalCheck::Ok
    );
    assert_eq!(
        check("p-1", "op", 3, &loiter, 1_000 + 120_001),
        ProposalCheck::Expired
    );
    h.mark("p-1", ProposalStatus::Executed);
    assert_eq!(check("p-1", "op", 3, &loiter, 2_000), ProposalCheck::Used);
    h.add_proposal(proposal("p-2", VehicleCommand::Rtl), "op");
    h.mark("p-2", ProposalStatus::Dismissed);
    assert_eq!(
        check("p-2", "op", 3, &VehicleCommand::Rtl, 2_000),
        ProposalCheck::Used
    );
}

#[test]
fn dismiss_is_owner_only_and_single_use() {
    let h = hub(0);
    h.add_proposal(proposal("p-1", VehicleCommand::Rtl), "op");
    assert_eq!(h.dismiss("p-2", "op", 2_000), ProposalCheck::NotFound);
    assert_eq!(h.dismiss("p-1", "intruder", 2_000), ProposalCheck::Forbidden);
    assert_eq!(h.dismiss("p-1", "op", 2_000), ProposalCheck::Ok);
    assert_eq!(h.dismiss("p-1", "op", 2_000), ProposalCheck::Used);
    assert_eq!(
        h.check_proposal("p-1", "op", 3, &VehicleCommand::Rtl, 2_000),
        ProposalCheck::Used
    );
    h.add_proposal(proposal("p-3", VehicleCommand::Rtl), "op");
    assert_eq!(h.dismiss("p-3", "op", 1_000 + 120_001), ProposalCheck::Expired);
}

#[test]
fn the_clock_is_injectable() {
    let h = hub(0).with_clock(Arc::new(|| 42));
    assert_eq!(h.now_ms(), 42);
}

#[test]
fn a_claim_is_single_use_until_released() {
    let h = hub(0);
    h.add_proposal(proposal("p-1", VehicleCommand::Rtl), "op");
    let claim = |user: &str, cmd: &VehicleCommand| h.claim("p-1", user, 3, cmd, 2_000);
    assert_eq!(claim("op", &VehicleCommand::Land), ProposalCheck::Mismatch);
    assert_eq!(claim("intruder", &VehicleCommand::Rtl), ProposalCheck::Forbidden);
    assert_eq!(claim("op", &VehicleCommand::Rtl), ProposalCheck::Ok);
    assert_eq!(
        claim("op", &VehicleCommand::Rtl),
        ProposalCheck::Used,
        "a second press"
    );
    assert_eq!(h.dismiss("p-1", "op", 2_000), ProposalCheck::Used);
    h.release("p-1");
    assert_eq!(
        claim("op", &VehicleCommand::Rtl),
        ProposalCheck::Ok,
        "a refused send frees it"
    );
    assert_eq!(
        h.claim("p-9", "op", 3, &VehicleCommand::Rtl, 2_000),
        ProposalCheck::NotFound
    );
}

#[test]
fn a_failed_or_timed_out_turn_still_spends_its_tokens() {
    let h = hub(1_000);
    h.charge(700, 0);
    assert_eq!(h.status(10).budget_left, Some(300));
    h.charge(400, 20);
    assert!(matches!(h.begin("op", 30), Err(HubRefusal::Budget)));
}
