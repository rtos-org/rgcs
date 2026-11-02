// The board's write sheet lines (spec 2026-10-31 §7): each target vehicle with its assigned saved
// plan, its distance and time, whether the plan changed since the last write and whether the
// vehicle is armed (its row then waits for the operator's tick).
import type { VehicleState } from '../../shared/api/types'
import { fromMission } from '../mission/model'
import { compareRows } from '../plans/compare'
import type { SheetLine } from '../plans/BatchWriteSheet'
import { cardStatus } from './logic'
import type { Assignments } from './store'
import type { LibraryPlan } from './usePlanLibrary'

export interface BoardWriteContext {
  readonly vehicles: readonly VehicleState[]
  readonly assignments: Assignments
  readonly plans: readonly LibraryPlan[]
  readonly colours: ReadonlyMap<number, string>
}

function lineFor(v: VehicleState, plan: LibraryPlan, ctx: BoardWriteContext): SheetLine {
  const [figures] = compareRows([{ key: '', draft: fromMission(plan.mission), enduranceMin: null }])
  return {
    key: `vehicle-${v.sysid}`,
    color: ctx.colours.get(plan.id) ?? 'var(--text-4)',
    name: plan.name,
    sysid: v.sysid,
    vehicle: v.name,
    distanceM: figures?.distanceM ?? 0,
    durationS: figures?.durationS ?? 0,
    mission: plan.mission,
    savedId: plan.id,
    updated: cardStatus(ctx.assignments.get(v.sysid), plan, true) === 'updated',
    armed: v.armed ? v.mode : null,
  }
}

/** Lines for `sysids`, in that order; a vehicle without a known assigned plan is left out. */
export function boardLines(sysids: readonly number[], ctx: BoardWriteContext): SheetLine[] {
  const vehicles = new Map(ctx.vehicles.map((v) => [v.sysid, v]))
  const plans = new Map(ctx.plans.map((p) => [p.id, p]))
  return sysids.flatMap((sysid) => {
    const v = vehicles.get(sysid)
    const planId = ctx.assignments.get(sysid)?.plan_id
    const plan = planId == null ? undefined : plans.get(planId)
    return v === undefined || plan === undefined ? [] : [lineFor(v, plan, ctx)]
  })
}
