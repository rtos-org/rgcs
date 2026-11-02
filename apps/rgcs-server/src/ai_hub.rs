//! In-memory state of the AI chat: conversations per user, the per-user
//! rate limit and in-flight flag, the rolling 24 h token budget and the proposal store. Nothing
//! here talks to a vehicle; proposals are only executed through `commands::command`.

use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::{Arc, Mutex as StdMutex, MutexGuard};

use rgcs_ai::{Block, Limits, LlmClient, Turn, Unconfigured};
use rgcs_core::{AiProposal, AiStatus, SysId, VehicleCommand};

/// How long a proposal can be executed after it was made.
pub const PROPOSAL_TTL_MS: u64 = 120_000;
/// Chats per user in any sliding [`RATE_WINDOW_MS`].
pub const RATE_LIMIT: usize = 6;
pub const RATE_WINDOW_MS: u64 = 60_000;
/// A conversation refuses more turns after this many user turns or serialized characters.
pub const MAX_USER_TURNS: u32 = 20;
pub const MAX_HISTORY_CHARS: usize = 200_000;
/// A conversation is full once replaying its history costs `max_tokens_per_chat /` this
/// many tokens (20 000 by default), so every chat still has room for at least three calls
/// (two tool rounds and the answer) under the per-chat cap instead of being cut after one.
pub const HISTORY_TOKEN_SHARE: u64 = 3;
/// Characters per token when the provider reports no usage (a low guess for JSON, high
/// for Japanese, where it is about one).
const CHARS_PER_TOKEN: usize = 4;
/// Conversations idle this long are forgotten.
pub const CONVERSATION_TTL_MS: u64 = 30 * 60_000;
/// Server-wide conversation cap; the least recently used one is evicted.
pub const MAX_CONVERSATIONS: usize = 64;
const BUDGET_WINDOW_MS: u64 = 24 * 60 * 60_000;
/// Finished proposals are kept this long past their expiry (so a late press reads `used` /
/// `expired`, not `not_found`), then dropped.
const PROPOSAL_KEEP_MS: u64 = 10 * 60_000;

pub type Clock = Arc<dyn Fn() -> u64 + Send + Sync>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProposalStatus {
    Pending,
    Executed,
    Dismissed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProposalCheck {
    Ok,
    NotFound,
    Forbidden,
    Mismatch,
    Expired,
    Used,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HubRefusal {
    RateLimited { retry_after_s: u64 },
    Busy,
    Budget,
    NotFound,
    Forbidden,
    Full,
}

#[derive(Debug, Clone)]
struct Conversation {
    owner: String,
    turns: Vec<Turn>,
    user_turns: u32,
    chars: usize,
    /// Reported replay cost of `turns` (input + output of the last call), 0 = unreported.
    context_tokens: u64,
    last_used_ms: u64,
}

impl Conversation {
    /// Estimated tokens to replay the history: the reported cost, or a character estimate.
    fn replay_tokens(&self) -> u64 {
        let estimate = u64::try_from(self.chars / CHARS_PER_TOKEN).unwrap_or(u64::MAX);
        self.context_tokens.max(estimate)
    }
}

#[derive(Debug, Clone)]
struct StoredProposal {
    proposal: AiProposal,
    owner: String,
    status: ProposalStatus,
}

#[derive(Default)]
struct HubState {
    conversations: HashMap<String, Conversation>,
    chats: HashMap<String, VecDeque<u64>>,
    in_flight: HashSet<String>,
    proposals: HashMap<String, StoredProposal>,
    /// `(ts, tokens)` of committed chats within the last 24 h.
    spent: VecDeque<(u64, u64)>,
}

impl HubState {
    fn prune(&mut self, now_ms: u64) {
        while self
            .spent
            .front()
            .is_some_and(|(ts, _)| now_ms.saturating_sub(*ts) >= BUDGET_WINDOW_MS)
        {
            self.spent.pop_front();
        }
        self.conversations
            .retain(|_, c| now_ms.saturating_sub(c.last_used_ms) <= CONVERSATION_TTL_MS);
        self.chats.retain(|_, ts| {
            ts.retain(|t| now_ms.saturating_sub(*t) < RATE_WINDOW_MS);
            !ts.is_empty()
        });
    }

    fn spent(&self) -> u64 {
        self.spent.iter().map(|(_, t)| t).sum()
    }

    fn evict_lru(&mut self) {
        while self.conversations.len() > MAX_CONVERSATIONS {
            let oldest = self
                .conversations
                .iter()
                .min_by_key(|(_, c)| c.last_used_ms)
                .map(|(id, _)| id.clone());
            match oldest {
                Some(id) => self.conversations.remove(&id),
                None => break,
            };
        }
    }
}

/// Shared AI state; cheap to clone.
#[derive(Clone)]
pub struct AiHub {
    state: Arc<StdMutex<HubState>>,
    client: Option<Arc<dyn LlmClient>>,
    status: AiStatus,
    limits: Limits,
    daily_budget: u64,
    clock: Clock,
}

/// Held while a user's chat runs; dropping it (also on timeout or panic) frees the user.
pub struct InFlight {
    state: Arc<StdMutex<HubState>>,
    user: String,
}

impl Drop for InFlight {
    fn drop(&mut self) {
        lock(&self.state).in_flight.remove(&self.user);
    }
}

fn lock(state: &StdMutex<HubState>) -> MutexGuard<'_, HubState> {
    state.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Characters the turns would take serialized (text, tool inputs, results, opaque blocks).
fn turn_chars(turns: &[Turn]) -> usize {
    turns
        .iter()
        .flat_map(|t| t.blocks.iter())
        .map(|b| match b {
            Block::Text(t) => t.chars().count(),
            Block::ToolUse { id, name, input } => id.len() + name.len() + input.to_string().chars().count(),
            Block::ToolResult {
                tool_use_id, content, ..
            } => tool_use_id.len() + content.chars().count(),
            Block::Opaque(v) => v.to_string().chars().count(),
        })
        .sum()
}

/// Whether `cmd` is the proposed command (mode names compare case-insensitively).
fn same_command(proposed: &VehicleCommand, cmd: &VehicleCommand) -> bool {
    match (proposed, cmd) {
        (VehicleCommand::SetMode { mode: a }, VehicleCommand::SetMode { mode: b }) => {
            a.eq_ignore_ascii_case(b.trim())
        }
        _ => proposed == cmd,
    }
}

impl AiHub {
    /// No provider: chats are refused with `ai_unconfigured`.
    pub fn disabled(reason: Unconfigured) -> Self {
        let status = AiStatus {
            configured: false,
            provider: None,
            model: None,
            reason: Some(reason.reason().to_string()),
            budget_left: None,
        };
        Self::build(None, status, rgcs_ai::AiConfig::default().limits(), 0)
    }

    /// `daily_budget` = tokens per rolling 24 h, `0` = unlimited.
    pub fn new(client: Arc<dyn LlmClient>, status: AiStatus, limits: Limits, daily_budget: u64) -> Self {
        Self::build(Some(client), status, limits, daily_budget)
    }

    fn build(
        client: Option<Arc<dyn LlmClient>>,
        status: AiStatus,
        limits: Limits,
        daily_budget: u64,
    ) -> Self {
        Self {
            state: Arc::new(StdMutex::new(HubState::default())),
            client,
            status,
            limits,
            daily_budget,
            clock: Arc::new(crate::app::unix_ms),
        }
    }

    /// Replaces the wall clock (tests drive proposal expiry with it).
    pub fn with_clock(self, clock: Clock) -> Self {
        Self { clock, ..self }
    }

    pub fn now_ms(&self) -> u64 {
        (self.clock)()
    }

    pub fn client(&self) -> Option<Arc<dyn LlmClient>> {
        self.client.clone()
    }

    pub fn limits(&self) -> &Limits {
        &self.limits
    }

    pub fn status(&self, now_ms: u64) -> AiStatus {
        let budget_left = (self.status.configured && self.daily_budget > 0).then(|| {
            let mut s = lock(&self.state);
            s.prune(now_ms);
            self.daily_budget.saturating_sub(s.spent())
        });
        AiStatus {
            budget_left,
            ..self.status.clone()
        }
    }

    /// Admits one chat of `user`: one at a time, [`RATE_LIMIT`] per minute, within the budget.
    pub fn begin(&self, user: &str, now_ms: u64) -> Result<InFlight, HubRefusal> {
        let mut s = lock(&self.state);
        s.prune(now_ms);
        if s.in_flight.contains(user) {
            return Err(HubRefusal::Busy);
        }
        if self.daily_budget > 0 && s.spent() >= self.daily_budget {
            return Err(HubRefusal::Budget);
        }
        let recent = s.chats.entry(user.to_string()).or_default();
        if recent.len() >= RATE_LIMIT {
            let oldest = recent.front().copied().unwrap_or(now_ms);
            let wait_ms = (oldest + RATE_WINDOW_MS).saturating_sub(now_ms);
            let retry_after_s = wait_ms.div_ceil(1_000).clamp(1, RATE_WINDOW_MS / 1_000);
            return Err(HubRefusal::RateLimited { retry_after_s });
        }
        recent.push_back(now_ms);
        s.in_flight.insert(user.to_string());
        Ok(InFlight {
            state: self.state.clone(),
            user: user.to_string(),
        })
    }

    /// The conversation's turns so far; `None` starts a new conversation (nothing is stored
    /// until [`AiHub::commit`]).
    pub fn history(
        &self,
        user: &str,
        id: Option<&str>,
        now_ms: u64,
    ) -> Result<(String, Vec<Turn>), HubRefusal> {
        let Some(id) = id else {
            return Ok((uuid::Uuid::new_v4().to_string(), Vec::new()));
        };
        let mut s = lock(&self.state);
        s.prune(now_ms);
        let c = s.conversations.get(id).ok_or(HubRefusal::NotFound)?;
        if c.owner != user {
            return Err(HubRefusal::Forbidden);
        }
        let too_costly = c.replay_tokens() >= self.limits.max_tokens_per_chat / HISTORY_TOKEN_SHARE;
        if c.user_turns >= MAX_USER_TURNS || c.chars >= MAX_HISTORY_CHARS || too_costly {
            return Err(HubRefusal::Full);
        }
        Ok((id.to_string(), c.turns.clone()))
    }

    /// Appends one finished chat (its new turns) and charges its tokens to the budget.
    /// Spends the tokens of a turn that failed or timed out (nothing is committed to the
    /// conversation, but the provider still billed them).
    pub fn charge(&self, tokens: u64, now_ms: u64) {
        let mut s = lock(&self.state);
        s.prune(now_ms);
        s.spent.push_back((now_ms, tokens));
    }

    /// `context_tokens` = [`rgcs_ai::TurnOutput::context`], the replay cost after this turn.
    pub fn commit(
        &self,
        user: &str,
        id: &str,
        turns: Vec<Turn>,
        tokens: u64,
        context_tokens: u64,
        now_ms: u64,
    ) {
        let mut s = lock(&self.state);
        s.prune(now_ms);
        s.spent.push_back((now_ms, tokens));
        let previous = s.conversations.get(id).filter(|c| c.owner == user);
        let next = match previous {
            Some(c) => Conversation {
                user_turns: c.user_turns + 1,
                chars: c.chars + turn_chars(&turns),
                turns: c.turns.iter().cloned().chain(turns).collect(),
                context_tokens,
                last_used_ms: now_ms,
                owner: c.owner.clone(),
            },
            None if s.conversations.contains_key(id) => return,
            None => Conversation {
                owner: user.to_string(),
                user_turns: 1,
                chars: turn_chars(&turns),
                turns,
                context_tokens,
                last_used_ms: now_ms,
            },
        };
        s.conversations.insert(id.to_string(), next);
        s.evict_lru();
    }

    pub fn add_proposal(&self, p: AiProposal, owner: &str) {
        let mut s = lock(&self.state);
        let now_ms = p.created_ms;
        s.proposals
            .retain(|_, sp| sp.proposal.expires_ms + PROPOSAL_KEEP_MS > now_ms);
        let stored = StoredProposal {
            proposal: p,
            owner: owner.to_string(),
            status: ProposalStatus::Pending,
        };
        s.proposals.insert(stored.proposal.id.clone(), stored);
    }

    /// Whether `user` may execute proposal `id` as `cmd` on `sysid` now.
    pub fn check_proposal(
        &self,
        id: &str,
        user: &str,
        sysid: SysId,
        cmd: &VehicleCommand,
        now_ms: u64,
    ) -> ProposalCheck {
        check_in(&lock(&self.state), id, user, sysid, cmd, now_ms)
    }

    /// [`AiHub::check_proposal`] that also marks it executed on `Ok`, in one step, so two
    /// presses cannot both send it. [`AiHub::release`] undoes it when the send is refused.
    pub fn claim(
        &self,
        id: &str,
        user: &str,
        sysid: SysId,
        cmd: &VehicleCommand,
        now_ms: u64,
    ) -> ProposalCheck {
        let mut s = lock(&self.state);
        let verdict = check_in(&s, id, user, sysid, cmd, now_ms);
        if let (ProposalCheck::Ok, Some(sp)) = (verdict, s.proposals.get_mut(id)) {
            sp.status = ProposalStatus::Executed;
        }
        verdict
    }

    /// A claimed proposal whose command was refused before the queue is pending again.
    pub fn release(&self, id: &str) {
        self.mark(id, ProposalStatus::Pending);
    }

    /// 却下: marks a pending proposal of `user` dismissed.
    pub fn dismiss(&self, id: &str, user: &str, now_ms: u64) -> ProposalCheck {
        let mut s = lock(&self.state);
        let Some(sp) = s.proposals.get_mut(id) else {
            return ProposalCheck::NotFound;
        };
        if sp.owner != user {
            return ProposalCheck::Forbidden;
        }
        let verdict = usable(sp, now_ms);
        if verdict == ProposalCheck::Ok {
            sp.status = ProposalStatus::Dismissed;
        }
        verdict
    }

    pub fn mark(&self, id: &str, status: ProposalStatus) {
        if let Some(sp) = lock(&self.state).proposals.get_mut(id) {
            sp.status = status;
        }
    }
}

fn check_in(
    s: &HubState,
    id: &str,
    user: &str,
    sysid: SysId,
    cmd: &VehicleCommand,
    now_ms: u64,
) -> ProposalCheck {
    let Some(sp) = s.proposals.get(id) else {
        return ProposalCheck::NotFound;
    };
    if sp.owner != user {
        return ProposalCheck::Forbidden;
    }
    if sp.proposal.sysid != sysid || !same_command(&sp.proposal.command, cmd) {
        return ProposalCheck::Mismatch;
    }
    usable(sp, now_ms)
}

fn usable(sp: &StoredProposal, now_ms: u64) -> ProposalCheck {
    if sp.status != ProposalStatus::Pending {
        ProposalCheck::Used
    } else if now_ms > sp.proposal.expires_ms {
        ProposalCheck::Expired
    } else {
        ProposalCheck::Ok
    }
}

#[cfg(test)]
#[path = "ai_hub_tests.rs"]
mod tests;
