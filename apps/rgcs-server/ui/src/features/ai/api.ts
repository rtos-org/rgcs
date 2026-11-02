import { apiFetch } from '../../shared/api/client'
import type { AiChatReply, AiChatRequest, AiStatus } from '../../shared/api/types'

/** Above the server's 90 s chat limit, so the server's `504 ai_timeout` arrives first. */
const CHAT_TIMEOUT_MS = 95_000
const DISMISS_TIMEOUT_MS = 10_000

/** `GET /api/ai/status`: provider / model, or why the AI is not configured. */
export function getAiStatus(): Promise<AiStatus> {
  return apiFetch<AiStatus>('/api/ai/status')
}

/** `POST /api/ai/chat {sysid, message, conversation_id}` → one reply when the agent loop ends. */
export function postChat(body: AiChatRequest): Promise<AiChatReply> {
  return apiFetch<AiChatReply>('/api/ai/chat', { method: 'POST', body, timeoutMs: CHAT_TIMEOUT_MS })
}

/** `POST /api/ai/proposals/{id}/dismiss` (却下). */
export function dismissProposal(id: string): Promise<{ id: string; status: 'dismissed' }> {
  return apiFetch(`/api/ai/proposals/${encodeURIComponent(id)}/dismiss`, { method: 'POST', timeoutMs: DISMISS_TIMEOUT_MS })
}
