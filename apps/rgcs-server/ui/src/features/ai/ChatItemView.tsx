// One entry of the AI chat list (prototype lines 666–681): user / bot bubbles, the tool card,
// a proposal card, a failed request shown as a danger-coloured bot bubble, or a local AI 緊急介入
// alert (no LLM request; read only: cancelling is the banner's job).
import type { ReactNode } from 'react'
import type { AiProposal, GuardAlert } from '../../shared/api/types'
import { hhmm } from '../../shared/format/time'
import type { Dict } from '../../shared/i18n'
import { IconBot, IconLoader, IconShieldAlert } from '../../shared/ui/icons'
import type { ChatItem } from './chat'
import { aiErrorText } from './format'
import { ProposalCard } from './ProposalCard'
import { ToolCard } from './ToolCard'

interface Props {
  readonly item: ChatItem
  readonly names: ReadonlyMap<number, string>
  readonly dict: Dict
  readonly now: number
  readonly onExecute: (p: AiProposal) => void
  readonly onDismiss: (id: string) => void
}

function BotRow({ children, ts, error = false }: { children: ReactNode; ts?: number; error?: boolean }) {
  return (
    <div className="ai-row bot">
      <span className="ai-avatar">
        <IconBot size={18} />
      </span>
      <div className={`bubble bot${error ? ' ai-err' : ''}`}>{children}</div>
      {ts !== undefined && <span className="t4 num ai-time">{hhmm(ts)}</span>}
    </div>
  )
}

/** The bot row shown while the server works on the reply. */
export function ThinkingRow({ dict }: { dict: Dict }) {
  return (
    <BotRow>
      <span className="row ai-thinking">
        <IconLoader className="ai-spin" />
        {dict.aiThinking}
      </span>
    </BotRow>
  )
}

function GuardCard({ alert, dict }: { alert: GuardAlert; dict: Dict }) {
  return (
    <div className={`inset ai-guard ${alert.phase}`} role="status">
      <div className="row ai-guard-h">
        <IconShieldAlert size={16} />
        <span>{dict.aiGuardTitle}</span>
        <span className="t3">{alert.vehicle_name}</span>
        <span className="t4 num ai-run-time">{hhmm(alert.ts)}</span>
      </div>
      <div className="ai-guard-text">{alert.text}</div>
      <div className="t4 ai-guard-note">{dict.aiGuardNote}</div>
    </div>
  )
}

export function ChatItemView({ item, names, dict, now, onExecute, onDismiss }: Props) {
  switch (item.kind) {
    case 'user':
      return (
        <div className="ai-row user">
          <span className="t4 num ai-time">{hhmm(item.ts)}</span>
          <div className="bubble user">{item.text}</div>
        </div>
      )
    case 'bot':
      return (
        <BotRow ts={item.ts}>
          {item.text}
          {item.truncated && <div className="t4 ai-note">{dict.aiTruncated}</div>}
        </BotRow>
      )
    case 'tool':
      return <ToolCard card={item.card} runs={item.runs} names={names} dict={dict} />
    case 'proposal':
      return <ProposalCard item={item} dict={dict} now={now} onExecute={onExecute} onDismiss={onDismiss} />
    case 'error':
      return (
        <BotRow ts={item.ts} error>
          {aiErrorText(item.code, item.message, dict, item.retryAfterS)}
        </BotRow>
      )
    case 'guard':
      return <GuardCard alert={item.alert} dict={dict} />
  }
}
