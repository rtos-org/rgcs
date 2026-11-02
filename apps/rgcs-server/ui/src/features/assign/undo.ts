// The undo toast's pure side (spec 2026-10-31 §4): what an assign, replace, move or unassign
// changed, and how the toast says it.
import type { VehicleState } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import type { LibraryPlan } from './usePlanLibrary'

/** One vehicle's assignment before and after an action. */
export interface Change {
  readonly sysid: number
  readonly before: number | null
  readonly after: number | null
}

export interface Undo {
  readonly text: string
  readonly changes: readonly Change[]
}

/** Plan and vehicle names for the toast's copy. */
export interface Names {
  readonly plans: readonly LibraryPlan[]
  readonly vehicles: readonly VehicleState[]
}

const fill = (template: string, values: Record<string, string>): string =>
  Object.entries(values).reduce((s, [k, v]) => s.replace(`{${k}}`, v), template)

function namer({ plans, vehicles }: Names) {
  return {
    plan: (id: number | null) => plans.find((p) => p.id === id)?.name ?? `#${id}`,
    vehicle: (sysid: number) => vehicles.find((v) => v.sysid === sysid)?.name ?? `#${sysid}`,
  }
}

/** A move lets go of the plan on one vehicle and gives it to another. */
function isMove(changes: readonly Change[]): changes is readonly [Change, Change] {
  if (changes.length !== 2) return false
  const [from, to] = changes as readonly [Change, Change]
  return from.after === null && from.before !== null && to.after === from.before
}

/** What the toast says about `changes` (null when nothing changed). */
export function undoText(changes: readonly Change[], names: Names, dict: Dict): string | null {
  const n = namer(names)
  if (isMove(changes)) {
    const [from, to] = changes
    return fill(dict.asToastMoved, { plan: n.plan(to.after), from: n.vehicle(from.sysid), to: n.vehicle(to.sysid) })
  }
  const c = changes[changes.length - 1]
  if (c === undefined) return null
  const vehicle = n.vehicle(c.sysid)
  if (c.after === null) return fill(dict.asToastUnassigned, { vehicle })
  if (c.before !== null) return fill(dict.asToastReplaced, { vehicle, old: n.plan(c.before), new: n.plan(c.after) })
  return fill(dict.asToastAssigned, { plan: n.plan(c.after), vehicle })
}
