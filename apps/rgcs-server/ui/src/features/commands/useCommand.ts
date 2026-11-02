import { ApiError } from '../../shared/api/client'
import type { VehicleCommand } from '../../shared/api/types'
import { sendCommand, type Queued } from './api'
import { REQUIRES_CONFIRM } from './catalog'

export type RunResult =
  | { readonly kind: 'queued'; readonly id: number }
  | { readonly kind: 'needs_confirm'; readonly message?: string }
  | { readonly kind: 'error'; readonly code: string; readonly message: string }

export type SendFn = (sysid: number, command: VehicleCommand, confirmToken?: string, aiProposalId?: string) => Promise<Queued>

export interface RunOpts {
  /** The AI proposal this send executes (`ai_proposal_id`, single use on the server). */
  readonly aiProposalId?: string
}

/**
 * Sends a command, deciding whether a confirm token is needed first. A 409 `confirm_required`
 * (missing / expired / mismatched token) comes back as `needs_confirm` so the UI re-prompts.
 */
export async function runCommand(sysid: number, command: VehicleCommand, token?: string, send: SendFn = sendCommand, opts: RunOpts = {}): Promise<RunResult> {
  if (token === undefined && REQUIRES_CONFIRM.has(command.cmd)) return { kind: 'needs_confirm' }
  try {
    const { id } = await (opts.aiProposalId === undefined ? send(sysid, command, token) : send(sysid, command, token, opts.aiProposalId))
    return { kind: 'queued', id }
  } catch (e) {
    if (e instanceof ApiError && e.status === 409 && e.code === 'confirm_required') return { kind: 'needs_confirm', message: e.message }
    if (e instanceof ApiError) return { kind: 'error', code: e.code, message: e.message }
    return { kind: 'error', code: 'unknown', message: e instanceof Error ? e.message : String(e) }
  }
}

export function useCommand(): { run: (sysid: number, command: VehicleCommand, token?: string) => Promise<RunResult> } {
  return { run: (sysid, command, token) => runCommand(sysid, command, token) }
}
