// The assignment board's right panel (spec 2026-10-31 §3.3): a filter, the vehicle cards in at
// most two columns (online first, then by name) in a list that scrolls inside the panel, and the
// pinned footer that writes every changed vehicle. Presentational: the board owns the filter,
// the pick, the drag and every action.
import type { MouseEvent, RefObject } from 'react'
import type { VehicleState } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { IconSearch, IconUpload } from '../../shared/ui/icons'
import type { DragPropsFn } from './board'
import { writeTargets } from './logic'
import type { Assignments } from './store'
import type { TapTarget } from './taps'
import type { LibraryPlan } from './usePlanLibrary'
import { VehicleCard } from './VehicleCard'
import { online, shownVehicles, viewOf, type VehicleDragState, type ViewContext } from './vehicleView'

export type { VehicleDragState }

export interface VehicleCardsProps {
  readonly vehicles: readonly VehicleState[]
  readonly assignments: Assignments
  readonly plans: readonly LibraryPlan[]
  readonly colours: ReadonlyMap<number, string>
  /** 飛行可能時間 (min) per sysid, for 電池 目安. */
  readonly endurance: ReadonlyMap<number, number | null>
  readonly picked: number | null
  readonly drag: VehicleDragState
  readonly dragProps: DragPropsFn
  /** The list that scrolls; pass it to `useCardDrag` for auto-scroll at the edges. */
  readonly scrollRef?: RefObject<HTMLDivElement | null>
  readonly filter: string
  readonly onFilter: (q: string) => void
  /** Short per-card messages (位置が分かりません …), by sysid. */
  readonly flash: ReadonlyMap<number, string>
  readonly onTap: (target: TapTarget) => void
  readonly onUnassign: (sysid: number) => void
  readonly onWrite: (sysid: number) => void
  readonly onWriteAll: () => void
  readonly dict: Dict
}

function Footer({ count, onWriteAll, dict }: { readonly count: number; readonly onWriteAll: () => void; readonly dict: Dict }) {
  return (
    <div className="as-foot">
      <button type="button" className="btn btn-primary as-write-all" disabled={count === 0} onClick={onWriteAll}>
        <IconUpload />
        {count > 0 ? dict.asWriteN.replace('{n}', String(count)) : dict.asWriteNone}
      </button>
      <span className="as-footnote">{dict.asWriteNote}</span>
    </div>
  )
}

export function VehicleCards({ vehicles, assignments, plans, colours, endurance, picked, drag, dragProps, scrollRef, filter, onFilter, flash, onTap, onUnassign, onWrite, onWriteAll, dict }: VehicleCardsProps) {
  const targets = new Set(writeTargets(vehicles, assignments, plans))
  const ctx: ViewContext = { assignments, byId: new Map(plans.map((p) => [p.id, p])), colours, endurance, targets, flash, picked, drag, dict }
  const list = shownVehicles(vehicles, filter, dict)
  const onEmpty = (e: MouseEvent) => {
    if (e.target === e.currentTarget) onTap({ kind: 'empty' })
  }
  const count = dict.asOnlineOf.replace('{n}', String(vehicles.filter(online).length)).replace('{m}', String(vehicles.length))
  return (
    <div className="as-panel">
      <div className="as-ph">
        <h2>{dict.asVehicles}</h2>
        <span className="as-count num">{count}</span>
      </div>
      <label className="as-search">
        <IconSearch />
        <input type="text" value={filter} placeholder={dict.asFilterVehiclesPh} aria-label={dict.asFilterVehicles} onChange={(e) => onFilter(e.target.value)} />
      </label>
      <div className="as-scroll" ref={scrollRef} data-testid="as-vehicle-list" onClick={onEmpty}>
        {list.length === 0 && <p className="as-hint">{dict.asNoVehicles}</p>}
        <div className="as-vgrid" onClick={onEmpty}>
          {list.map((v) => (
            <VehicleCard key={v.sysid} view={viewOf(v, ctx)} dragProps={dragProps} onTap={onTap} onUnassign={onUnassign} onWrite={onWrite} dict={dict} />
          ))}
        </div>
      </div>
      <Footer count={targets.size} onWriteAll={onWriteAll} dict={dict} />
    </div>
  )
}
