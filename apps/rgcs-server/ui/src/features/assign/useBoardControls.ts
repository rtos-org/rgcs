// What the assignment board does with taps, double-taps and drops (spec 2026-10-31 §4): assign
// through the store, refuse a plan that does not suit the vehicle (and say why on its card),
// move a chip between vehicles, and frame a card on the map. Each change is reported
// (`onChange`) for the undo toast.
import { useEffect, useState, type RefObject } from 'react'
import type { VehicleState } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import type { LatLon } from '../mission/geo'
import { focusPoints } from './assignOverlay'
import type { AssignDrag } from './board'
import { compatibility } from './logic'
import type { AssignmentStore, Assignments } from './store'
import { escape, initialTaps, tap, type TapAction, type TapState, type TapTarget } from './taps'
import type { Change } from './undo'
import { useCardDrag, type CardDrag } from './useCardDrag'
import type { LibraryPlan } from './usePlanLibrary'

export interface BoardControlsArgs {
  readonly plans: readonly LibraryPlan[]
  readonly vehicles: readonly VehicleState[]
  readonly assignments: Assignments
  readonly store: AssignmentStore
  readonly dict: Dict
  /** A short message on one vehicle card. */
  readonly flash: (sysid: number, text: string) => void
  /** What an assign, replace, move or unassign changed (one call per action). */
  readonly onChange: (changes: readonly Change[]) => void
  readonly onFit: (points: readonly LatLon[]) => void
  readonly scrollRef: RefObject<HTMLDivElement | null>
}

export interface BoardControls {
  readonly picked: number | null
  readonly drag: CardDrag<AssignDrag>
  readonly onTap: (target: TapTarget) => void
  readonly onUnassign: (sysid: number) => void
}

/** Why `planId` cannot go to `sysid` (copy), or null when it can. */
export function misfit(plans: readonly LibraryPlan[], vehicles: readonly VehicleState[], planId: number, sysid: number, dict: Dict): string | null {
  const plan = plans.find((p) => p.id === planId)
  const v = vehicles.find((x) => x.sysid === sysid)
  if (plan === undefined || v === undefined) return null
  const key = compatibility(plan.mission, v.kind)
  return key === null ? null : dict[key]
}

/** Esc drops the pick (a running drag cancels itself). */
function useEscape(setTaps: (fn: (s: TapState) => TapState) => void): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setTaps(escape)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [setTaps])
}

/** A double-tap frames the card on the map, or says the vehicle's position is unknown. */
function focus(target: TapTarget, a: BoardControlsArgs): void {
  if (target.kind === 'empty') return
  const to = target.kind === 'plan' ? { plan: target.id } : { vehicle: target.sysid }
  const r = focusPoints(to, a.plans, a.vehicles, a.assignments)
  if ('error' in r) {
    if (target.kind === 'vehicle') a.flash(target.sysid, a.dict.asNoPosition)
  } else if (r.points.length > 0) a.onFit(r.points)
}

export function useBoardControls(a: BoardControlsArgs): BoardControls {
  const [taps, setTaps] = useState<TapState>(initialTaps)
  useEscape(setTaps)

  const planOf = (sysid: number): number | null => a.assignments.get(sysid)?.plan_id ?? null

  /** Sets `sysid`'s plan; a vehicle already holding it sends nothing. */
  const change = (sysid: number, planId: number | null): Change[] => {
    const before = planOf(sysid)
    if (before === planId) return []
    void a.store.set(sysid, planId)
    return [{ sysid, before, after: planId }]
  }

  const report = (changes: readonly Change[]) => {
    if (changes.length > 0) a.onChange(changes)
  }

  const run = (action: TapAction) => {
    if (typeof action === 'string' || 'locked' in action) return // the plan card shows its own note
    if ('assign' in action) report(change(action.assign[1], action.assign[0]))
    else if ('blocked' in action) {
      const [planId, sysid] = action.blocked
      a.flash(sysid, misfit(a.plans, a.vehicles, planId, sysid, a.dict) ?? '')
    } else focus(action.focus, a)
  }

  const onTap = (target: TapTarget) => {
    const r = tap(taps, target, Date.now(), {
      canPick: (id) => a.plans.find((p) => p.id === id)?.dirty !== true,
      canAssign: (planId, sysid) => misfit(a.plans, a.vehicles, planId, sysid, a.dict) === null,
    })
    setTaps(r.state)
    run(r.action)
  }

  const drag = useCardDrag<AssignDrag>({
    canDrop: (p, target) => misfit(a.plans, a.vehicles, p.planId, Number(target), a.dict),
    onDrop: (p, target) => {
      const sysid = Number(target)
      if (p.from === sysid) return
      // a move: the source lets go first
      const from = p.from === null ? [] : change(p.from, null)
      report([...from, ...change(sysid, p.planId)])
    },
    scrollRef: a.scrollRef,
  })

  const onUnassign = (sysid: number) => report(change(sysid, null))

  return { picked: taps.picked, drag, onTap, onUnassign }
}
