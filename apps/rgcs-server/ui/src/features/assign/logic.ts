// Pure rules of the plan assignment board (spec 2026-10-31 §3.3, §5): a vehicle card's write
// status, whether a plan suits a vehicle kind, the battery estimate, who a board write targets
// and the colour each plan is drawn in.
import type { Assignment, Mission, VehicleKind, VehicleState } from '../../shared/api/types'
import { fromMission } from '../mission/model'
import { compareRows } from '../plans/compare'
import { nextColor } from '../plans/palette'
import type { Assignments } from './store'

/** A saved plan with its version (`missions.updated_at`, ms); `Mission` alone does not carry it. */
export interface VersionedPlan {
  readonly id: number
  readonly updated_at: number
  readonly mission: Mission
}

export interface PlanVersion {
  readonly id: number
  readonly updated_at: number
}

/** The badge of a vehicle card. Armed / flying is a separate flag, not a status. */
export type CardStatus = 'none' | 'pending' | 'ok' | 'updated' | 'unknown'

/** I18n keys of the reasons a plan does not suit a vehicle kind. */
export type CompatKey = 'asRoverNoTakeoff' | 'asAirNeedsTakeoff'

const NAV_TAKEOFF = 22
const NAV_VTOL_TAKEOFF = 84

/** A vehicle's row status. `plan` is the assigned plan as loaded now (undefined while unknown to the board). */
export function cardStatus(a: Assignment | undefined, plan: PlanVersion | undefined, online: boolean): CardStatus {
  if (a === undefined || a.plan_id === null) return 'none'
  const w = a.written
  if (w === null) return online ? 'pending' : 'unknown'
  if (w.plan_id !== a.plan_id || plan === undefined) return 'pending'
  return w.plan_updated_at === plan.updated_at ? 'ok' : 'updated'
}

/**
 * Mirrors the takeoff rule of `Mission::validate_for(kind)`: an air vehicle needs a first item
 * that takes off, a rover cannot take one. Like the server's `validate_for`, every other kind (`other` included) needs one.
 */
export function compatibility(plan: Mission, kind: VehicleKind): CompatKey | null {
  const first = plan.items[0]?.command
  const takesOff = first === NAV_TAKEOFF || first === NAV_VTOL_TAKEOFF
  if (kind === 'rover') return takesOff ? 'asRoverNoTakeoff' : null
  return takesOff ? null : 'asAirNeedsTakeoff'
}

/** Estimated minutes / endurance minutes in percent (目安); null when unknown or incompatible. */
export function batteryPct(plan: Mission, kind: VehicleKind, enduranceMin: number | null): number | null {
  if (compatibility(plan, kind) !== null) return null
  const [row] = compareRows([{ key: '', draft: fromMission(plan), enduranceMin }])
  return row?.batteryPct ?? null
}

type TargetVehicle = Pick<VehicleState, 'sysid' | 'kind' | 'link'>

/** Online vehicles whose card is pending or updated and whose plan suits them, by sysid. */
export function writeTargets(vehicles: readonly TargetVehicle[], assignments: Assignments, plans: readonly VersionedPlan[]): number[] {
  const byId = new Map(plans.map((p) => [p.id, p]))
  return vehicles
    .filter((v) => {
      if (v.link === 'lost') return false
      const a = assignments.get(v.sysid)
      const plan = a?.plan_id == null ? undefined : byId.get(a.plan_id)
      if (plan === undefined) return false
      const status = cardStatus(a, plan, true)
      return (status === 'pending' || status === 'updated') && compatibility(plan.mission, v.kind) === null
    })
    .map((v) => v.sysid)
    .sort((x, y) => x - y)
}

export interface ColourRow {
  readonly color: string
  readonly ui: { readonly savedId: number | null }
}

/** Open plans keep their row colour; the others take palette colours in id order, skipping used ones. */
export function planColours(openRows: readonly ColourRow[], plans: readonly { readonly id: number }[]): Map<number, string> {
  const open = new Map(openRows.flatMap((r) => (r.ui.savedId === null ? [] : [[r.ui.savedId, r.color] as const])))
  const ids = [...new Set(plans.map((p) => p.id))].sort((x, y) => x - y)
  const start = { used: openRows.map((r) => r.color), out: [] as (readonly [number, string])[] }
  const { out } = ids.reduce((acc, id) => {
    const kept = open.get(id)
    if (kept !== undefined) return { used: acc.used, out: [...acc.out, [id, kept] as const] }
    const colour = nextColor(acc.used)
    return { used: [...acc.used, colour], out: [...acc.out, [id, colour] as const] }
  }, start)
  return new Map(out)
}

export interface AssignedVehicle {
  readonly sysid: number
  readonly name: string
}

/** The vehicles the server assigns `planId` to, by name; an unknown vehicle shows as `#sysid`. */
export function assignedTo(planId: number | null, assignments: Assignments, vehicles: readonly AssignedVehicle[]): AssignedVehicle[] {
  if (planId === null) return []
  const names = new Map(vehicles.map((v) => [v.sysid, v.name]))
  return [...assignments.values()]
    .filter((a) => a.plan_id === planId)
    .map((a) => ({ sysid: a.sysid, name: names.get(a.sysid) ?? `#${a.sysid}` }))
    .sort((x, y) => x.name.localeCompare(y.name))
}
