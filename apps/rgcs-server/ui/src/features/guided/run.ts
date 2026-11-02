import { ApiError } from '../../shared/api/client'
import type { VehicleCommand } from '../../shared/api/types'
import { sendGuided, type GuidedBody, type GuidedReply } from './api'

export type GuidedOutcome =
  | { readonly kind: 'sent'; readonly id: number; readonly warning: string | null }
  | { readonly kind: 'mode_required' }
  | { readonly kind: 'needs_confirm'; readonly message?: string }
  | { readonly kind: 'error'; readonly code: string; readonly message: string }

export type SendGuidedFn = (sysid: number, body: GuidedBody) => Promise<GuidedReply>

/** Sends a Guided target and classifies the server's answer for the modal. */
export async function runGuided(sysid: number, body: GuidedBody, token?: string, send: SendGuidedFn = sendGuided): Promise<GuidedOutcome> {
  try {
    const { id, warning } = await send(sysid, { ...body, confirm_token: token })
    return { kind: 'sent', id, warning }
  } catch (e) {
    if (e instanceof ApiError && e.code === 'mode_required') return { kind: 'mode_required' }
    if (e instanceof ApiError && e.code === 'confirm_required') return { kind: 'needs_confirm', message: e.message }
    if (e instanceof ApiError) return { kind: 'error', code: e.code, message: e.message }
    return { kind: 'error', code: 'unknown', message: e instanceof Error ? e.message : String(e) }
  }
}

export interface StartDeps {
  /** The vehicle's mode as the telemetry reports it now. */
  readonly mode: () => string | null
  readonly confirm: (sysid: number, cmd: string) => Promise<{ readonly confirm_token: string }>
  readonly command: (sysid: number, command: VehicleCommand, token?: string) => Promise<unknown>
  /** Resolves true once `pred` holds, false after `timeoutMs`. */
  readonly waitFor: (pred: () => boolean, timeoutMs: number) => Promise<boolean>
  readonly send: SendGuidedFn
}

/** How long the vehicle gets to report GUIDED after the mode command. */
export const GUIDED_MODE_WAIT_MS = 5000

const failure = (e: unknown): GuidedOutcome =>
  e instanceof ApiError ? { kind: 'error', code: e.code, message: e.message } : { kind: 'error', code: 'unknown', message: e instanceof Error ? e.message : String(e) }

/**
 * One press of 移動開始 (the operator's confirmation): switch to GUIDED unless already there (a mode
 * change needs no confirm token), wait until the vehicle reports GUIDED, then send the target —
 * answering the server's confirm request for the target itself. The target is never sent to a vehicle that has not reached GUIDED.
 */
export async function startGuided(sysid: number, body: GuidedBody, deps: StartDeps): Promise<GuidedOutcome> {
  try {
    if (deps.mode() !== 'GUIDED') {
      await deps.command(sysid, { cmd: 'set_mode', args: { mode: 'GUIDED' } })
      if (!(await deps.waitFor(() => deps.mode() === 'GUIDED', GUIDED_MODE_WAIT_MS))) return { kind: 'error', code: 'mode_timeout', message: 'GUIDED' }
    }
    const first = await runGuided(sysid, body, undefined, deps.send)
    if (first.kind !== 'needs_confirm') return first.kind === 'mode_required' ? { kind: 'error', code: 'mode_timeout', message: 'GUIDED' } : first
    const { confirm_token } = await deps.confirm(sysid, 'guided')
    return await runGuided(sysid, body, confirm_token, deps.send)
  } catch (e) {
    return failure(e)
  }
}

/** Polls `pred` every 100 ms. */
export function pollUntil(pred: () => boolean, timeoutMs: number): Promise<boolean> {
  const until = Date.now() + timeoutMs
  return new Promise((resolve) => {
    const tick = () => {
      if (pred()) return resolve(true)
      if (Date.now() >= until) return resolve(false)
      setTimeout(tick, 100)
    }
    tick()
  })
}
