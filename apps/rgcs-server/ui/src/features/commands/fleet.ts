// Fleet commands (operator proposal 6): one command to every vehicle with a link, each with its
// own confirm token; a refusal by one vehicle never stops the others.
import type { VehicleCommand, VehicleState } from '../../shared/api/types'
import type { requestConfirm } from './api'
import { REQUIRES_CONFIRM } from './catalog'
import { runCommand, type SendFn } from './useCommand'

export interface FleetDeps {
  readonly confirm: typeof requestConfirm
  readonly send: SendFn
}

export interface FleetResult {
  readonly sysid: number
  readonly ok: boolean
  readonly message?: string
}

/** Armed vehicles with a link, by sysid. */
export function fleetTargets(vehicles: readonly VehicleState[]): VehicleState[] {
  // Disarmed vehicles are left alone: a pause (BRAKE) on the pad would then refuse to arm.
  return vehicles.filter((v) => v.link !== 'lost' && v.armed).sort((a, b) => a.sysid - b.sysid)
}

export type SkipReason = 'lost' | 'disarmed'

export interface Skipped {
  readonly vehicle: VehicleState
  readonly reason: SkipReason
}

/** The vehicles fleetTargets leaves out, by sysid, with why: the confirm names them. */
export function fleetSkipped(vehicles: readonly VehicleState[]): Skipped[] {
  return vehicles
    .filter((v) => v.link === 'lost' || !v.armed)
    .sort((a, b) => a.sysid - b.sysid)
    .map((vehicle) => ({ vehicle, reason: vehicle.link === 'lost' ? 'lost' : 'disarmed' }))
}

async function one(command: VehicleCommand, sysid: number, deps: FleetDeps): Promise<FleetResult> {
  try {
    const token = REQUIRES_CONFIRM.has(command.cmd) ? (await deps.confirm(sysid, command.cmd)).confirm_token : undefined
    const r = await runCommand(sysid, command, token, deps.send)
    if (r.kind === 'queued') return { sysid, ok: true }
    return { sysid, ok: false, message: r.kind === 'error' ? r.message : (r.message ?? 'confirm_required') }
  } catch (e) {
    return { sysid, ok: false, message: e instanceof Error ? e.message : String(e) }
  }
}

/** `onEach` reports every vehicle as soon as it settles; a slow one never holds the others. */
export function runFleet(command: VehicleCommand, sysids: readonly number[], deps: FleetDeps, onEach?: (r: FleetResult) => void): Promise<FleetResult[]> {
  return Promise.all(sysids.map((s) => one(command, s, deps).then((r) => (onEach?.(r), r))))
}
