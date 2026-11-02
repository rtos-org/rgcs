// The vehicle cards' pure side (spec 2026-10-31 §3.3): kind labels, the order and filter of the
// list, and what each card shows.
import type { VehicleState } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { hasPosition } from '../map/markers'
import type { AssignDrag } from './board'
import { batteryPct, cardStatus, compatibility } from './logic'
import type { Assignments } from './store'
import type { LibraryPlan } from './usePlanLibrary'
import type { VehicleCardView } from './VehicleCard'

/** The part of `useCardDrag<AssignDrag>()` the cards draw. */
export interface VehicleDragState {
  readonly dragging: AssignDrag | null
  readonly over: string | null
  readonly blocked: string | null
  readonly overReason: string | null
}

export const online = (v: VehicleState): boolean => v.link !== 'lost'

export function kindLabel(v: Pick<VehicleState, 'kind' | 'vtol'>, dict: Dict): string {
  if (v.kind === 'plane') return v.vtol ? dict.asKindQuadPlane : dict.asKindPlane
  if (v.kind === 'copter') return dict.asKindCopter
  return v.kind === 'rover' ? dict.asKindRover : dict.asKindOther
}

/** Online first, then by name; kept to those whose name, kind or mode holds `filter`. */
export function shownVehicles(vehicles: readonly VehicleState[], filter: string, dict: Dict): VehicleState[] {
  const q = filter.trim().toLowerCase()
  const hay = (v: VehicleState) => `${v.name} ${kindLabel(v, dict)} ${v.kind} ${v.mode}`.toLowerCase()
  return vehicles
    .filter((v) => q === '' || hay(v).includes(q))
    .sort((a, b) => Number(online(b)) - Number(online(a)) || a.name.localeCompare(b.name))
}

/** What every card's view is worked out from. */
export interface ViewContext {
  readonly assignments: Assignments
  readonly byId: ReadonlyMap<number, LibraryPlan>
  readonly colours: ReadonlyMap<number, string>
  readonly endurance: ReadonlyMap<number, number | null>
  readonly targets: ReadonlySet<number>
  readonly flash: ReadonlyMap<number, string>
  readonly picked: number | null
  readonly drag: VehicleDragState
  readonly dict: Dict
}

function reasonOf(plan: LibraryPlan | undefined, v: VehicleState, dict: Dict): string | null {
  const key = plan === undefined ? null : compatibility(plan.mission, v.kind)
  return key === null ? null : dict[key]
}

export function viewOf(v: VehicleState, ctx: ViewContext): VehicleCardView {
  const { assignments, byId, drag, picked, dict } = ctx
  const a = assignments.get(v.sysid)
  const plan = a?.plan_id == null ? undefined : byId.get(a.plan_id)
  const activeId = drag.dragging?.planId ?? picked
  const active = activeId === null ? undefined : byId.get(activeId)
  const ownWhy = reasonOf(plan, v, dict)
  const activeWhy = reasonOf(active, v, dict)
  const dropWhy = drag.blocked === String(v.sysid) ? drag.overReason : null
  const fit = activeId === null ? null : activeWhy !== null || dropWhy !== null ? 'cannot' : 'can'
  return {
    v,
    online: online(v),
    noPosition: !hasPosition(v),
    kindLabel: kindLabel(v, dict),
    plan: plan === undefined ? null : { id: plan.id, name: plan.name, colour: ctx.colours.get(plan.id) ?? 'var(--text-4)' },
    status: cardStatus(a, plan, online(v)),
    why: ownWhy ?? activeWhy ?? dropWhy,
    fit,
    picking: picked !== null,
    over: drag.over === String(v.sysid),
    battery: plan === undefined ? null : batteryPct(plan.mission, v.kind, ctx.endurance.get(v.sysid) ?? null),
    writable: ctx.targets.has(v.sysid),
    flash: ctx.flash.get(v.sysid) ?? null,
  }
}
