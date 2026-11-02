// The AI chat panel's state, lifted to the Shell so it survives view switches.
import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { ApiError } from '../../shared/api/client'
import type { AiChatReply, AiStatus } from '../../shared/api/types'
import { vehicleStore, type FrameSource } from '../vehicles/store'
import { dismissProposal, getAiStatus, postChat } from './api'
import { chatReducer, EMPTY_CHAT, type ChatAction, type ChatState, type ProposalState } from './chat'

export interface AiChat {
  readonly state: ChatState
  readonly status: AiStatus | null
  readonly send: (sysid: number, text: string) => void
  readonly setProposal: (id: string, s: ProposalState, err?: string) => void
  readonly dismiss: (id: string) => void
  readonly reset: () => void
}

/** Posts once; a conversation the server no longer has (restart, TTL) is retried once as a new one. */
async function chatOnce(sysid: number, message: string, conversationId: string | null): Promise<AiChatReply> {
  try {
    return await postChat({ sysid, message, conversation_id: conversationId })
  } catch (e) {
    if (conversationId !== null && e instanceof ApiError && e.code === 'conversation_not_found') return postChat({ sysid, message, conversation_id: null })
    throw e
  }
}

function failAction(e: unknown): ChatAction {
  const ts = Date.now()
  if (e instanceof ApiError) return { t: 'fail', code: e.code, message: e.message, ts, ...(e.retryAfterS === undefined ? {} : { retryAfterS: e.retryAfterS }) }
  return { t: 'fail', code: 'unknown', message: e instanceof Error ? e.message : String(e), ts }
}

function useAiStatus(): AiStatus | null {
  const [status, setStatus] = useState<AiStatus | null>(null)
  useEffect(() => {
    let live = true
    getAiStatus().then(
      (s) => live && setStatus(s),
      () => live && setStatus({ configured: false, provider: null, model: null, reason: 'unavailable', budget_left: null }),
    )
    return () => {
      live = false
    }
  }, [])
  return status
}

export function useAiChat(frames: FrameSource = vehicleStore): AiChat {
  const [state, dispatch] = useReducer(chatReducer, EMPTY_CHAT)
  const status = useAiStatus()
  // AI 緊急介入 alerts become local items: no LLM request, nothing sent anywhere.
  useEffect(() => frames.onFrame((msg) => msg.t === 'guard_alert' && dispatch({ t: 'guard', alert: msg.alert })), [frames])
  // Read inside callbacks so a quick second press sees the in-flight flag and the latest id.
  const conversation = useRef<string | null>(null)
  useEffect(() => {
    conversation.current = state.conversationId
  }, [state.conversationId])
  const inFlight = useRef(false)

  const send = useCallback((sysid: number, text: string) => {
    const message = text.trim()
    if (message === '' || inFlight.current) return
    inFlight.current = true
    dispatch({ t: 'send', text: message, ts: Date.now() })
    chatOnce(sysid, message, conversation.current)
      .then((reply) => dispatch({ t: 'reply', reply }), (e: unknown) => dispatch(failAction(e)))
      .finally(() => {
        inFlight.current = false
      })
  }, [])

  const setProposal = useCallback((id: string, s: ProposalState, err?: string) => dispatch({ t: 'proposal', id, state: s, ...(err === undefined ? {} : { error: err }) }), [])

  const dismiss = useCallback((id: string) => {
    dispatch({ t: 'proposal', id, state: 'sending' })
    dismissProposal(id).then(
      () => dispatch({ t: 'proposal', id, state: 'dismissed' }),
      (e: unknown) => {
        const expired = e instanceof ApiError && e.code === 'proposal_expired'
        dispatch(expired ? { t: 'proposal', id, state: 'expired' } : { t: 'proposal', id, state: 'failed', error: e instanceof Error ? e.message : String(e) })
      },
    )
  }, [])

  const reset = useCallback(() => dispatch({ t: 'reset' }), [])

  return { state, status, send, setProposal, dismiss, reset }
}
