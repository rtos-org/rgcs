// The 実行 press of an AI proposal card: the same runner as every other command
// button, with the proposal id (single use on the server) and the AI's reason for the confirm dialog.
import type { AiChat, ProposalState } from '../features/ai'
import { errorText, type PickOpts, type RunResult } from '../features/commands'
import type { AiProposal, VehicleCommand } from '../shared/api/types'
import type { Dict } from '../shared/i18n'

interface Outcome {
  readonly state: ProposalState
  readonly error?: string
}

/** queued → executed; a cancelled confirm → pending again; proposal_expired → expired; else failed. */
export function proposalOutcome(r: RunResult, dict: Dict): Outcome {
  if (r.kind === 'queued') return { state: 'executed' }
  if (r.kind === 'needs_confirm') return { state: 'pending' }
  if (r.code === 'proposal_expired') return { state: 'expired' }
  return { state: 'failed', error: errorText(r.code, r.message, dict) }
}

type PickFn = (sysid: number, command: VehicleCommand, opts?: PickOpts) => void

export function executeProposal(chat: Pick<AiChat, 'setProposal'>, runner: { readonly pick: PickFn }, dict: Dict): (p: AiProposal) => void {
  return (p) => {
    chat.setProposal(p.id, 'sending')
    const onResult = (r: RunResult) => {
      const out = proposalOutcome(r, dict)
      if (out.error === undefined) chat.setProposal(p.id, out.state)
      else chat.setProposal(p.id, out.state, out.error)
    }
    runner.pick(p.sysid, p.command, { aiProposalId: p.id, note: p.reason, onResult })
  }
}
