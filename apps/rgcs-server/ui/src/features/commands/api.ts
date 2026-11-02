import { apiFetch } from '../../shared/api/client'
import type { VehicleCommand } from '../../shared/api/types'

/** A command that has not been answered in 10 s is reported failed instead of hanging the UI. */
const COMMAND_TIMEOUT_MS = 10_000

export interface ConfirmReply {
  readonly confirm_token: string
  readonly expires_in: number
}

export interface Queued {
  readonly id: number
}

/** `POST /api/vehicles/{sysid}/confirm {cmd}` → token valid for 30 s. */
export function requestConfirm(sysid: number, cmd: string): Promise<ConfirmReply> {
  return apiFetch<ConfirmReply>(`/api/vehicles/${sysid}/confirm`, { method: 'POST', body: { cmd }, timeoutMs: COMMAND_TIMEOUT_MS })
}

/**
 * `POST /api/vehicles/{sysid}/command` with the flat `{cmd, args?, confirm_token?, ai_proposal_id?}` body
 *. `aiProposalId` links the send to the AI proposal the operator pressed 実行 on.
 */
export function sendCommand(sysid: number, command: VehicleCommand, confirmToken?: string, aiProposalId?: string): Promise<Queued> {
  const body = {
    ...command,
    ...(confirmToken === undefined ? {} : { confirm_token: confirmToken }),
    ...(aiProposalId === undefined ? {} : { ai_proposal_id: aiProposalId }),
  }
  return apiFetch<Queued>(`/api/vehicles/${sysid}/command`, { method: 'POST', body, timeoutMs: COMMAND_TIMEOUT_MS })
}
