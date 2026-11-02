import { useRef, useState, type DragEvent, type HTMLAttributes, type MouseEvent } from 'react'
import type { VehicleKind } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { listSegments, SurveyRow } from '../survey/SurveyRow'
import { haversineM, hasPosition, type LatLon } from './geo'
import { itemSummary, km } from './labels'
import type { DraftItem, DraftSurvey } from './model'
import { WpRow } from './MissionRow'

interface Props {
  readonly items: readonly DraftItem[]
  /** Surveys: each shows as one collapsible group row over its read-only items. */
  readonly surveys?: readonly DraftSurvey[]
  /** For the survey rows' photo counts (start corner "home"). */
  readonly home?: LatLon | null
  readonly selected: ReadonlySet<number>
  readonly kind: VehicleKind | null
  readonly dict: Dict
  readonly onSelect: (uid: number, additive: boolean, range: boolean) => void
  readonly onReorder: (uid: number, dir: -1 | 1) => void
  /** Drag & drop: move these items to the slot before index `before`. */
  readonly onMove: (uids: ReadonlySet<number>, before: number) => void
  readonly onContext: (uid: number, x: number, y: number) => void
}

const NO_SURVEYS: readonly DraftSurvey[] = []

/** Metres from the previous positioned item (0 for the first and for non-positioned items). */
function legDistances(items: readonly DraftItem[]): readonly number[] {
  const out: number[] = []
  let prev: DraftItem | null = null
  for (const it of items) {
    if (!hasPosition(it) || it.command === 201) {
      out.push(0)
      continue
    }
    out.push(prev ? haversineM(prev.lat, prev.lon, it.lat, it.lon) : 0)
    prev = it
  }
  return out
}

/** The slot a drop over a row spanning [first, last] means: before it in the upper half, after it in the lower. */
function slotAt(e: DragEvent<HTMLElement>, first: number, last: number): number {
  const r = e.currentTarget.getBoundingClientRect()
  return e.clientY < r.top + r.height / 2 ? first : last + 1
}

/** Drag state and the handlers of a row (or survey group) spanning items [first, last]. */
function useDrag(total: number, onMove: Props['onMove']) {
  const dragging = useRef<ReadonlySet<number> | null>(null)
  const [slot, setSlot] = useState<number | null>(null)
  const end = () => {
    dragging.current = null
    setSlot(null)
  }
  const attrs = (carried: () => ReadonlySet<number>, first: number, last: number): HTMLAttributes<HTMLDivElement> => ({
    draggable: true,
    onDragStart: (e) => {
      const uids = carried()
      dragging.current = uids
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', [...uids].join(','))
    },
    onDragOver: (e) => {
      if (!dragging.current) return
      e.preventDefault()
      const next = slotAt(e, first, last)
      // "after row i" and "before row i + 1" are one slot: mark it on the lower row
      if (next !== slot) setSlot(next)
    },
    onDrop: (e) => {
      e.preventDefault()
      if (dragging.current) onMove(dragging.current, slotAt(e, first, last))
      end()
    },
    onDragEnd: end,
  })
  const marks = (first: number, last: number) => `${slot === first ? ' drop-before' : ''}${slot === total && last === total - 1 ? ' drop-after' : ''}`
  return { attrs, marks }
}

/** The rows' sub-lines, the list split into items and survey groups, and up / down that jump over a group. */
function rowModel({ items, surveys = NO_SURVEYS, kind, dict, onReorder, onMove }: Props) {
  const legs = legDistances(items)
  // leg distance and the item's fields; a dash only when there is nothing at all (no "255 m · —")
  const sub = (it: DraftItem, i: number) => [legs[i]! > 0 ? km(legs[i]!) : '', itemSummary(it, kind, dict)].filter(Boolean).join(' · ') || '—'
  const segments = listSegments(items, surveys)
  const groups = segments.flatMap((seg) => (seg.kind === 'survey' ? [{ first: seg.first, last: seg.first + seg.survey.uids.length - 1 }] : []))
  /** Up / down next to a survey jumps over the whole group instead of entering it. */
  const step = (uid: number, i: number, dir: -1 | 1) => {
    const g = groups.find((x) => x.first <= i + dir && i + dir <= x.last)
    if (g) onMove(new Set([uid]), dir < 0 ? g.first : g.last + 1)
    else onReorder(uid, dir)
  }
  return { sub, segments, step }
}

/** Prototype `.wrow` list: badge, Japanese command name + MAV id, summary line, up / down; surveys grouped. */
export function MissionList(props: Props) {
  const { items, home = null, selected, dict, onSelect, onMove, onContext } = props
  const drag = useDrag(items.length, onMove)
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set())
  if (items.length === 0) return <div className="t3 wp-empty">{dict.mNoWp}</div>
  const click = (uid: number) => (e: MouseEvent) => onSelect(uid, e.metaKey || e.ctrlKey, e.shiftKey)
  const { sub, segments, step } = rowModel(props)
  const toggle = (id: string) => setOpen((o) => (o.has(id) ? new Set([...o].filter((x) => x !== id)) : new Set([...o, id])))

  const plainRow = (i: number) => {
    const it = items[i]!
    const sel = selected.has(it.uid)
    const attrs: HTMLAttributes<HTMLDivElement> = {
      ...drag.attrs(() => (sel ? selected : new Set([it.uid])), i, i),
      onContextMenu: (e) => {
        e.preventDefault()
        onContext(it.uid, e.clientX, e.clientY)
      },
    }
    const reorder = { canUp: i > 0, canDown: i < items.length - 1, onReorder: (dir: -1 | 1) => step(it.uid, i, dir) }
    return <WpRow key={it.uid} item={it} seq={i + 1} sel={sel} sub={sub(it, i)} dict={dict} className={drag.marks(i, i)} attrs={attrs} reorder={reorder} onClick={click(it.uid)} />
  }
  const surveyGroup = (s: DraftSurvey, first: number) => {
    const last = first + s.uids.length - 1
    const kids = items.slice(first, last + 1)
    return (
      <SurveyRow
        key={s.id}
        survey={s}
        items={kids}
        home={home}
        dict={dict}
        sel={kids.some((it) => selected.has(it.uid))}
        open={open.has(s.id)}
        onToggle={() => toggle(s.id)}
        headAttrs={drag.attrs(() => new Set(s.uids), first, last)}
        headClass={drag.marks(first, last)}
        onHeadClick={click(s.uids[0]!)}
        renderItem={(it, k) => <WpRow key={it.uid} item={it} seq={first + k + 1} sel={selected.has(it.uid)} sub={sub(it, first + k)} dict={dict} className=" sv-child" onClick={click(it.uid)} />}
      />
    )
  }
  return (
    <div className="wp-list" role="listbox" aria-label={dict.mWaypoints}>
      {segments.map((seg) => (seg.kind === 'item' ? plainRow(seg.index) : surveyGroup(seg.survey, seg.first)))}
    </div>
  )
}
