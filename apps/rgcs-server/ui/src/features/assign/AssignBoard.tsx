// The flight plan screen's 割当 mode (spec 2026-10-31 §3, §4): saved plans on the left, vehicles
// on the right, the map in between. It owns the filters, the pick, the drag, the hovered card
// and the per-card messages; the planner draws what it reports (`onOverlay`) and frames what it
// asks for (`onFit`). The plan library loads afresh each time the board opens, since another
// operator may have saved plans meanwhile. It hands the write sheet's lines to the planner (`onWrite`)
// and shows the undo toast for the last change.
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { VehicleState } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import type { LatLon } from '../mission/geo'
import { useEndurance } from '../plans/useEndurance'
import { fitAllPoints, type Highlight } from './assignOverlay'
import type { SheetLine } from '../plans/BatchWriteSheet'
import type { BoardOverlay } from './board'
import { boardLines } from './boardWrite'
import { planColours, writeTargets, type ColourRow } from './logic'
import { DragGhost, PlanCards } from './PlanCards'
import { assignmentStore, useAssignments, type AssignmentStore, type Assignments } from './store'
import { useBoardControls } from './useBoardControls'
import { undoText, type Change, type Undo } from './undo'
import { UndoToast } from './UndoToast'
import { useFlash } from './useFlash'
import { usePlanLibrary, type LibraryPlan, type PlanLibraryDeps } from './usePlanLibrary'
import { VehicleCards } from './VehicleCards'

export { FLASH_MS } from './useFlash'

export interface AssignBoardProps {
  readonly vehicles: readonly VehicleState[]
  /** The planner's open rows: an open plan keeps its row colour. */
  readonly openRows: readonly ColourRow[]
  readonly dict: Dict
  /** What the map draws; null when the board closes. */
  readonly onOverlay: (overlay: BoardOverlay | null) => void
  /** Frames points on the map, clear of the panels. */
  readonly onFit: (points: readonly LatLon[]) => void
  /** Opens the write sheet: a vehicle card's 書き込む (that vehicle) or the footer's 変更のある n 機に書き込む. */
  readonly onWrite: (lines: readonly SheetLine[]) => void
  /** Test seams. */
  readonly store?: AssignmentStore
  readonly library?: PlanLibraryDeps
}

const NO_PLANS: readonly LibraryPlan[] = []

/** Vehicles assigned to each plan id. */
function countsOf(assignments: Assignments): Map<number, number> {
  const ids = [...assignments.values()].flatMap((a) => (a.plan_id === null ? [] : [a.plan_id]))
  return ids.reduce((m, id) => m.set(id, (m.get(id) ?? 0) + 1), new Map<number, number>())
}

function hoverOf(target: EventTarget): Highlight {
  if (!(target instanceof Element)) return null
  const plan = target.closest('[data-plan]')?.getAttribute('data-plan')
  if (plan) return { plan: Number(plan) }
  const vehicle = target.closest('[data-drop]')?.getAttribute('data-drop')
  return vehicle ? { vehicle: Number(vehicle) } : null
}

const sameHighlight = (x: Highlight, y: Highlight): boolean => JSON.stringify(x) === JSON.stringify(y)

/** The hovered card, for the map's highlight (pointer only; touch highlights the pick). */
function useHover() {
  const [hover, setHover] = useState<Highlight>(null)
  const onPointerOver = (e: ReactPointerEvent) => {
    const next = hoverOf(e.target)
    setHover((h) => (sameHighlight(h, next) ? h : next))
  }
  return { hover, props: { onPointerOver, onPointerLeave: () => setHover(null) } }
}

/** Frames every plan and positioned vehicle once, when the plans first arrive. */
function useFitOnOpen(plans: readonly LibraryPlan[] | null, vehicles: readonly VehicleState[], onFit: (points: readonly LatLon[]) => void): void {
  const done = useRef(false)
  useEffect(() => {
    if (done.current || plans === null) return
    done.current = true
    const points = fitAllPoints(plans, vehicles)
    if (points.length > 0) onFit(points)
  }, [plans, vehicles, onFit])
}

function useOverlay(overlay: BoardOverlay, onOverlay: (o: BoardOverlay | null) => void): void {
  useEffect(() => onOverlay(overlay), [overlay, onOverlay])
  useEffect(() => () => onOverlay(null), [onOverlay])
}

/** The last change's toast; undo restores each vehicle's previous plan, last change first. */
function useUndo(store: AssignmentStore) {
  const [undo, setUndo] = useState<Undo | null>(null)
  const close = useCallback(() => setUndo(null), [])
  const run = (u: Undo) => {
    u.changes.toReversed().forEach((c) => void store.set(c.sysid, c.before))
    setUndo(null)
  }
  return { undo, setUndo, close, run }
}

export function AssignBoard({ vehicles, openRows, dict, onOverlay, onFit, onWrite, store = assignmentStore, library }: AssignBoardProps) {
  const lib = usePlanLibrary(library)
  const plans = lib.plans ?? NO_PLANS
  const assignments = useAssignments(store)
  const [planFilter, setPlanFilter] = useState('')
  const [vehicleFilter, setVehicleFilter] = useState('')
  const [flash, showFlash] = useFlash()
  const scrollRef = useRef<HTMLDivElement>(null)
  const undo = useUndo(store)
  const onChange = (changes: readonly Change[]) => {
    const text = undoText(changes, { plans, vehicles }, dict)
    if (text !== null) undo.setUndo({ text, changes })
  }
  const ctl = useBoardControls({ plans, vehicles, assignments, store, dict, flash: showFlash, onChange, onFit, scrollRef })
  const { hover, props: hoverProps } = useHover()
  const colours = useMemo(() => planColours(openRows, plans), [openRows, plans])
  const counts = useMemo(() => countsOf(assignments), [assignments])
  const holders = [...assignments.values()].flatMap((a) => (a.plan_id === null ? [] : [a.sysid]))
  const endurance = useEndurance(holders)
  const active = ctl.drag.dragging?.planId ?? ctl.picked
  const activeHl = useMemo<Highlight>(() => (active === null ? null : { plan: active }), [active])
  const highlight = hover ?? activeHl
  const overlay = useMemo<BoardOverlay>(() => ({ plans, colours, assignments, highlight }), [plans, colours, assignments, highlight])
  useOverlay(overlay, onOverlay)
  useFitOnOpen(lib.plans, vehicles, onFit)
  const ghost = ctl.drag.dragging === null ? undefined : plans.find((p) => p.id === ctl.drag.dragging?.planId)
  const { dragging, over, blocked, overReason } = ctl.drag
  const writeCtx = { vehicles, assignments, plans, colours }
  const writeOne = (sysid: number) => onWrite(boardLines([sysid], writeCtx))
  const writeAll = () => onWrite(boardLines(writeTargets(vehicles, assignments, plans), writeCtx))

  return (
    <>
      <aside className="g panel float float-l as-left" aria-label={dict.asPlans} {...hoverProps}>
        <PlanCards plans={lib.plans} colours={colours} counts={counts} picked={ctl.picked} dragging={dragging} dragProps={ctl.drag.dragProps} filter={planFilter} onFilter={setPlanFilter} onTap={ctl.onTap} dict={dict} />
        {lib.error !== null && <p className="as-hint as-err" role="alert">{lib.error}</p>}
      </aside>
      <aside className="g panel float float-r as-right" aria-label={dict.asVehicles} {...hoverProps}>
        <VehicleCards vehicles={vehicles} assignments={assignments} plans={plans} colours={colours} endurance={endurance} picked={ctl.picked} drag={{ dragging, over, blocked, overReason }}
          dragProps={ctl.drag.dragProps} scrollRef={scrollRef} filter={vehicleFilter} onFilter={setVehicleFilter} flash={flash}
          onTap={ctl.onTap} onUnassign={ctl.onUnassign} onWrite={writeOne} onWriteAll={writeAll} dict={dict} />
      </aside>
      <UndoToast undo={undo.undo} dict={dict} onUndo={undo.run} onClose={undo.close} />
      {ghost && <DragGhost name={ghost.name} colour={colours.get(ghost.id) ?? 'var(--text-4)'} x={ctl.drag.x} y={ctl.drag.y} />}
    </>
  )
}
