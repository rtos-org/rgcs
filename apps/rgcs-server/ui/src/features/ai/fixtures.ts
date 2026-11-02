// Shared test data for the AI chat modules (not imported by production code).
import type { AiChatReply, AiProposal, GuardAlert } from '../../shared/api/types'

export function proposal(over: Partial<AiProposal> = {}): AiProposal {
  return {
    id: 'p-1',
    sysid: 3,
    vehicle_name: 'UAV-03',
    command: { cmd: 'set_mode', args: { mode: 'LOITER' } },
    reason: 'hold position',
    requires_confirm: false,
    created_ms: 1_000,
    expires_ms: 121_000,
    ...over,
  }
}

export function reply(over: Partial<AiChatReply> = {}): AiChatReply {
  return {
    conversation_id: 'c-1',
    reply: 'UAV-03 is flying',
    tool_runs: [],
    status_card: null,
    proposals: [],
    truncated: false,
    ts: 2_000,
    ...over,
  }
}

export function guardAlert(over: Partial<GuardAlert> = {}): GuardAlert {
  return {
    id: 'g-1',
    sysid: 3,
    vehicle_name: 'UAV-03',
    event: 'toilet_bowl',
    phase: 'alerting',
    level: 'l2',
    confidence: 1,
    signs: { a: true, b: true, c: true, turn_deg: 412, radius_m: 3.2, compass_var: 0.61 },
    deadline_ms: null,
    action_mode: null,
    taken_over_by: null,
    vehicle_mode: 'LOITER',
    rc_stale: false,
    kp_raised: false,
    sound: true,
    text: 'UAV-03 トイレットボウルの兆候 — 手動で引き継いでください',
    ts: 3_000,
    ...over,
  }
}
