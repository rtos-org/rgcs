// A command the AI proposed: labelled 「AI の提案」, sent only by the operator's 実行.
import type { AiProposal } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { IconSparkles } from '../../shared/ui/icons'
import { DESTRUCTIVE } from '../commands/catalog'
import type { ChatItem } from './chat'
import { proposalText } from './format'

type Item = Extract<ChatItem, { kind: 'proposal' }>

interface Props {
  readonly item: Item
  readonly dict: Dict
  readonly onExecute: (p: AiProposal) => void
  readonly onDismiss: (id: string) => void
  readonly now: number
}

/** The closing line of a settled proposal, or null while it can still be executed. */
function settledText(item: Item, dict: Dict, now: number): string | null {
  if (item.state === 'executed') return dict.aiExecuted
  if (item.state === 'dismissed') return dict.aiDismissed
  if (item.state === 'expired') return dict.aiExpired
  if (item.state === 'pending' && item.proposal.expires_ms < now) return dict.aiExpired
  return null
}

export function ProposalCard({ item, dict, onExecute, onDismiss, now }: Props) {
  const p = item.proposal
  const settled = settledText(item, dict, now)
  const sending = item.state === 'sending'
  return (
    <div className="inset ai-proposal">
      <div className="row ai-proposal-h">
        <IconSparkles />
        <span>{dict.aiProposalLabel}</span>
      </div>
      <div className="ai-proposal-cmd">{proposalText(p, dict)}</div>
      <div className="t3 ai-proposal-meta">
        {dict.aiTarget}: {p.vehicle_name}
      </div>
      <div className="t2 ai-proposal-reason">{p.reason}</div>
      {item.state === 'failed' && item.error && <div className="ai-proposal-err">{item.error}</div>}
      {settled !== null ? (
        <div className="t3 ai-proposal-state">{settled}</div>
      ) : (
        <div className="row ai-proposal-actions">
          <button type="button" className="btn btn-ghost" disabled={sending} onClick={() => onDismiss(item.id)}>
            {dict.aiDismiss}
          </button>
          <button type="button" className={`btn ${DESTRUCTIVE.has(p.command.cmd) ? 'btn-danger' : 'btn-primary'}`} disabled={sending} onClick={() => onExecute(p)}>
            {dict.aiExecute}
          </button>
        </div>
      )}
    </div>
  )
}
