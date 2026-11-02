// The assignment board's left panel (spec 2026-10-31 §3.2): every saved plan as a card that can
// be dragged onto a vehicle or tapped to pick. A plan with unsaved edits is locked: it cannot be
// dragged, and a tap says why. Presentational: the board owns the filter, the pick and the drag.
import { useEffect, useMemo, useState, type KeyboardEvent, type MouseEvent } from 'react'
import type { Dict } from '../../shared/i18n'
import { IconGripVertical, IconLock, IconSearch } from '../../shared/ui/icons'
import { km, mmss } from '../mission/labels'
import { fromMission } from '../mission/model'
import { compareRows } from '../plans/compare'
import { isActivation, type AssignDrag, type DragPropsFn } from './board'
import { compatibility } from './logic'
import type { TapTarget } from './taps'
import type { LibraryPlan } from './usePlanLibrary'

/** How long the locked-plan note stays on its card. */
export const NOTE_MS = 2400

export interface PlanCardsProps {
  /** null while the library loads. */
  readonly plans: readonly LibraryPlan[] | null
  readonly colours: ReadonlyMap<number, string>
  /** Vehicles assigned to each plan id; a missing id is 0. */
  readonly counts: ReadonlyMap<number, number>
  readonly picked: number | null
  readonly dragging: AssignDrag | null
  readonly dragProps: DragPropsFn
  readonly filter: string
  readonly onFilter: (q: string) => void
  readonly onTap: (target: TapTarget) => void
  readonly dict: Dict
}

interface CardFigures {
  readonly distanceM: number
  readonly durationS: number
  readonly ground: boolean
}

function figures(p: LibraryPlan): CardFigures {
  const [row] = compareRows([{ key: '', draft: fromMission(p.mission), enduranceMin: null }])
  return { distanceM: row?.distanceM ?? 0, durationS: row?.durationS ?? 0, ground: compatibility(p.mission, 'rover') === null }
}

const matches = (q: string) => (p: LibraryPlan): boolean => q === '' || p.name.toLowerCase().includes(q)

function Tag({ dirty, count, dict }: { readonly dirty: boolean; readonly count: number; readonly dict: Dict }) {
  if (dirty) return <span className="as-ptag warn">{dict.asDirty}</span>
  if (count > 0) return <span className="as-ptag">{dict.asAssignedN.replace('{n}', String(count))}</span>
  return <span className="as-ptag none">{dict.asUnassigned}</span>
}

interface CardProps {
  readonly plan: LibraryPlan
  readonly fig: CardFigures
  readonly colour: string
  readonly count: number
  readonly picked: boolean
  readonly lifting: boolean
  readonly note: boolean
  readonly dragProps: DragPropsFn
  readonly onTap: (id: number) => void
  readonly dict: Dict
}

function PlanCard({ plan, fig, colour, count, picked, lifting, note, dragProps, onTap, dict }: CardProps) {
  const cls = ['as-pcard', picked ? 'picked' : '', lifting ? 'lifting' : '', plan.dirty ? 'dirty' : ''].filter(Boolean).join(' ')
  const onKeyDown = (e: KeyboardEvent) => {
    if (!isActivation(e.key)) return
    e.preventDefault()
    onTap(plan.id)
  }
  return (
    <div
      className={cls}
      role="button"
      tabIndex={0}
      aria-pressed={picked}
      aria-label={plan.name}
      data-plan={plan.id}
      {...dragProps({ planId: plan.id, from: null }, !plan.dirty)}
      onClick={() => onTap(plan.id)}
      onKeyDown={onKeyDown}
    >
      <span className="as-chip" style={{ background: colour }} aria-hidden="true" />
      <span className="as-pname">{plan.name}</span>
      {plan.dirty ? <IconLock className="as-grip" /> : <IconGripVertical className="as-grip" />}
      <span className="as-pmeta num">
        <span>{km(fig.distanceM)}</span>
        <span>{mmss(fig.durationS)}</span>
        <span>{fig.ground ? dict.asGround : dict.asTakesOff}</span>
        <Tag dirty={plan.dirty} count={count} dict={dict} />
      </span>
      {note && (
        <span className="as-why as-pnote" role="status">
          {dict.asDirtyWhy}
        </span>
      )}
    </div>
  )
}

/** The id of the locked plan whose note shows, cleared after NOTE_MS. */
function useLockedNote(): readonly [number | null, (id: number) => void] {
  const [note, setNote] = useState<{ readonly id: number; readonly seq: number } | null>(null)
  useEffect(() => {
    if (note === null) return
    const timer = setTimeout(() => setNote(null), NOTE_MS)
    return () => clearTimeout(timer)
  }, [note])
  const show = (id: number) => setNote((n) => ({ id, seq: (n?.seq ?? 0) + 1 }))
  return [note?.id ?? null, show]
}

export function PlanHint({ dict }: { readonly dict: Dict }) {
  return (
    <p className="as-hint">
      <b>{dict.asHintDrag}</b>
      {dict.asHintDragRest}
      <b>{dict.asHintTap}</b>
      {dict.asHintTapRest}
      <b>{dict.asHintDouble}</b>
      {dict.asHintDoubleRest}
    </p>
  )
}

export function PlanCards({ plans, colours, counts, picked, dragging, dragProps, filter, onFilter, onTap, dict }: PlanCardsProps) {
  const [noteId, showNote] = useLockedNote()
  const figs = useMemo(() => new Map((plans ?? []).map((p) => [p.id, figures(p)])), [plans])
  const list = (plans ?? []).filter(matches(filter.trim().toLowerCase()))
  const tapPlan = (id: number) => {
    if (plans?.find((p) => p.id === id)?.dirty) showNote(id)
    onTap({ kind: 'plan', id })
  }
  const onEmpty = (e: MouseEvent) => {
    if (e.target === e.currentTarget) onTap({ kind: 'empty' })
  }
  return (
    <div className="as-panel">
      <div className="as-ph">
        <h2>{dict.asPlans}</h2>
        <span className="as-count num">{plans?.length ?? ''}</span>
      </div>
      <label className="as-search">
        <IconSearch />
        <input type="text" value={filter} placeholder={dict.asFilterPlans} aria-label={dict.asFilterPlans} onChange={(e) => onFilter(e.target.value)} />
      </label>
      <PlanHint dict={dict} />
      <div className="as-scroll" data-testid="as-plan-list" onClick={onEmpty}>
        {plans === null && <p className="as-hint">{dict.asLoadingPlans}</p>}
        {plans !== null && list.length === 0 && <p className="as-hint">{dict.asNoPlans}</p>}
        <div className="as-plist" onClick={onEmpty}>
          {list.map((p) => (
            <PlanCard
              key={p.id}
              plan={p}
              fig={figs.get(p.id) ?? figures(p)}
              colour={colours.get(p.id) ?? 'var(--text-4)'}
              count={counts.get(p.id) ?? 0}
              picked={picked === p.id}
              lifting={dragging?.planId === p.id && dragging.from === null}
              note={noteId === p.id}
              dragProps={dragProps}
              onTap={tapPlan}
              dict={dict}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

/** The small card that follows the pointer while dragging (drawn by the board at `x`, `y`). */
export function DragGhost({ name, colour, x, y }: { readonly name: string; readonly colour: string; readonly x: number; readonly y: number }) {
  return (
    <div className="as-ghost" style={{ left: x, top: y }} aria-hidden="true">
      <span className="as-chip" style={{ background: colour }} />
      {name}
    </div>
  )
}
