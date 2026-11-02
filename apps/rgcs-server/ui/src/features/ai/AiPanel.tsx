// The AI chat right panel (prototype lines 655–689, glass_ops_ai.png).
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { AiProposal, AiStatus, VehicleState } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { IconClose, IconSend } from '../../shared/ui/icons'
import { ChatItemView, ThinkingRow } from './ChatItemView'
import type { AiChat } from './useAiChat'

export interface AiPanelProps {
  readonly vehicles: readonly VehicleState[]
  /** The select value: the Shell's current vehicle. */
  readonly target: number | null
  readonly onTarget: (sysid: number) => void
  readonly chat: AiChat
  readonly dict: Dict
  /** Only ever called from the 実行 button of a proposal card. */
  readonly onExecute: (p: AiProposal) => void
  readonly onClose: () => void
}

function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [])
  return now
}

function StatusLine({ status, dict }: { status: AiStatus | null; dict: Dict }) {
  if (status === null) return null
  if (status.configured) return <div className="t4 ai-provider">{dict.aiProvider.replace('{provider}', status.provider ?? '').replace('{model}', status.model ?? '')}</div>
  return (
    <div className="inset t2 ai-notice">
      {dict.aiUnconfigured}
      {status.reason === 'no_api_key' && <div className="t3">{dict.aiNoKey}</div>}
    </div>
  )
}

/** `locked`: no AI or no target (the input is off); `busy`: a reply is pending (typing allowed, sending not). */
function Composer({ locked, busy, dict, onSend }: { locked: boolean; busy: boolean; dict: Dict; onSend: (text: string) => void }) {
  const [draft, setDraft] = useState('')
  const submit = () => {
    if (locked || busy || draft.trim() === '') return
    onSend(draft)
    setDraft('')
  }
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    // Enter while an IME is composing confirms the conversion, not the message.
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return
    e.preventDefault()
    submit()
  }
  return (
    <div className="row hair-t ai-compose">
      <input className="in lg grow" value={draft} disabled={locked} placeholder={dict.aiTypeMessage} aria-label={dict.aiTypeMessage} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} />
      <button type="button" className="btn btn-lg btn-primary ai-send" disabled={locked || busy || draft.trim() === ''} aria-label={dict.aiSend} title={dict.aiSend} onClick={submit}>
        <IconSend size={18} />
      </button>
    </div>
  )
}

/** The last answer of a running conversation was an error: the stored history may be what fails, so offer a fresh one. */
function stuck(state: AiChat['state']): boolean {
  return state.conversationId !== null && state.items.at(-1)?.kind === 'error'
}

export function AiPanel({ vehicles, target, onTarget, chat, dict, onExecute, onClose }: AiPanelProps) {
  const { state, status } = chat
  const now = useNow()
  const list = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = list.current
    if (el) el.scrollTop = el.scrollHeight
  }, [state.items.length, state.pending])
  const names = new Map(vehicles.map((v) => [v.sysid, v.name]))
  const locked = status?.configured !== true || target === null || state.full
  return (
    <aside className="g panel float float-r ai" aria-label={dict.aiTitle}>
      <div className="panel-h">
        <span className="h1">{dict.aiTitle}</span>
        <span className="t3 ai-target-l">{dict.aiTarget}</span>
        <select className="in ai-target" value={target ?? ''} aria-label={dict.aiTarget} onChange={(e) => onTarget(Number(e.target.value))}>
          {vehicles.map((v) => (
            <option key={v.sysid} value={v.sysid}>
              {v.name}
            </option>
          ))}
        </select>
        <div className="grow" />
        <button type="button" className="btn-icon" aria-label={dict.close} title={dict.close} onClick={onClose}>
          <IconClose />
        </button>
      </div>
      <StatusLine status={status} dict={dict} />
      <div ref={list} className="ai-list">
        {state.items.map((item) => (
          <ChatItemView key={item.id} item={item} names={names} dict={dict} now={now} onExecute={onExecute} onDismiss={chat.dismiss} />
        ))}
        {state.pending && <ThinkingRow dict={dict} />}
        {(state.full || stuck(state)) && (
          <div className="inset ai-notice row">
            <span className="grow">{state.full ? dict.aiFull : dict.aiStuck}</span>
            <button type="button" className="btn btn-sm" onClick={chat.reset}>
              {dict.aiNewChat}
            </button>
          </div>
        )}
      </div>
      <Composer locked={locked} busy={state.pending} dict={dict} onSend={(text) => target !== null && chat.send(target, text)} />
    </aside>
  )
}
