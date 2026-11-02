// One vehicle card of the assignment board (spec 2026-10-31 §3.3, §5): who it is, the plan in
// its slot, why a plan does not suit it, the write status, the battery estimate and its own
// 書き込む. The card is a drop target (`data-drop`) and a tap target; the filled slot drags.
import type { KeyboardEvent, PointerEvent as ReactPointerEvent, MouseEvent, ReactNode } from 'react'
import type { VehicleState } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { KindIcon } from '../../shared/ui/KindIcon'
import { IconCheck, IconClose, IconHelp, IconPending, IconRefresh, IconUpload, IconWarn } from '../../shared/ui/icons'
import { isActivation, type DragPropsFn } from './board'
import type { CardStatus } from './logic'
import type { TapTarget } from './taps'

/** Everything a card shows, worked out by `VehicleCards`. */
export interface VehicleCardView {
  readonly v: VehicleState
  readonly online: boolean
  readonly noPosition: boolean
  readonly kindLabel: string
  readonly plan: { readonly id: number; readonly name: string; readonly colour: string } | null
  readonly status: CardStatus
  /** The red reason line: the assigned plan's misfit, else the active plan's, else the drop's. */
  readonly why: string | null
  /** A plan is picked or dragged: whether it may land here; null when none is. */
  readonly fit: 'can' | 'cannot' | null
  readonly picking: boolean
  readonly over: boolean
  readonly battery: number | null
  readonly writable: boolean
  readonly flash: string | null
}

export interface VehicleCardProps {
  readonly view: VehicleCardView
  readonly dragProps: DragPropsFn
  readonly onTap: (target: TapTarget) => void
  readonly onUnassign: (sysid: number) => void
  readonly onWrite: (sysid: number) => void
  readonly dict: Dict
}

const BADGES: Record<Exclude<CardStatus, 'none'>, { readonly cls: string; readonly icon: ReactNode; readonly key: 'asStOk' | 'asStPending' | 'asStUpdated' | 'asStUnknown' }> = {
  ok: { cls: 'ok', icon: <IconCheck size={12} />, key: 'asStOk' },
  pending: { cls: 'wait', icon: <IconPending />, key: 'asStPending' },
  updated: { cls: 'wait', icon: <IconRefresh size={12} />, key: 'asStUpdated' },
  unknown: { cls: '', icon: <IconHelp />, key: 'asStUnknown' },
}

export function StatusBadge({ status, dict }: { readonly status: CardStatus; readonly dict: Dict }) {
  if (status === 'none') return null
  const b = BADGES[status]
  return (
    <span className={b.cls ? `as-badge ${b.cls}` : 'as-badge'}>
      {b.icon}
      {dict[b.key]}
    </span>
  )
}

const batteryClass = (pct: number): string => (pct > 100 ? 'as-bat num red' : pct > 70 ? 'as-bat num amber' : 'as-bat num')

/** A control inside the card: its press must neither start the slot's drag nor tap the card. */
const own = (fn: () => void) => ({
  onPointerDown: (e: ReactPointerEvent) => e.stopPropagation(),
  onClick: (e: MouseEvent) => {
    e.stopPropagation()
    fn()
  },
})

function Sub({ view, dict }: { readonly view: VehicleCardView; readonly dict: Dict }) {
  const { v } = view
  if (!view.online) return <div className="as-vsub num"><span>{dict.asOffline}</span></div>
  return (
    <div className="as-vsub num">
      <span className={v.armed ? 'as-mode armed' : 'as-mode'}>{v.armed ? `ARMED ${v.mode}` : v.mode}</span>
      {v.battery.pct !== null && <span>{`${v.battery.pct}%`}</span>}
      {view.noPosition && <span className="as-nogps">{dict.asGpsNone}</span>}
    </div>
  )
}

function Slot({ view, dragProps, onUnassign, dict }: Pick<VehicleCardProps, 'view' | 'dragProps' | 'onUnassign' | 'dict'>) {
  const { plan, v } = view
  if (plan === null) {
    const text = view.fit === 'cannot' ? dict.asCannotPlace : view.picking ? dict.asTapToAssign : dict.asDropHere
    return <div className="as-slot">{text}</div>
  }
  return (
    <div className="as-slot filled" {...dragProps({ planId: plan.id, from: v.sysid }, true)}>
      <span className="as-chip" style={{ background: plan.colour }} aria-hidden="true" />
      <span className="as-sname">{plan.name}</span>
      <button type="button" className="as-x" aria-label={dict.asUnassignOf.replace('{name}', v.name)} {...own(() => onUnassign(v.sysid))}>
        <IconClose size={15} />
      </button>
    </div>
  )
}

function Foot({ view, onWrite, dict }: Pick<VehicleCardProps, 'view' | 'onWrite' | 'dict'>) {
  const { v } = view
  return (
    <div className="as-vfoot">
      {view.plan !== null && <StatusBadge status={view.status} dict={dict} />}
      {v.armed && (
        <span className="as-badge fly">
          <IconWarn size={12} />
          {dict.asFlying}
        </span>
      )}
      {view.battery !== null && (
        <span className={batteryClass(view.battery)} title={dict.asBatteryEstNote}>
          {dict.asBatteryEst.replace('{n}', String(view.battery))}
        </span>
      )}
      {view.writable && (
        <button type="button" className="btn btn-sm as-write" aria-label={dict.asWriteTo.replace('{name}', v.name)} {...own(() => onWrite(v.sysid))}>
          <IconUpload size={14} />
          {dict.asWrite}
        </button>
      )}
    </div>
  )
}

const cardClass = (view: VehicleCardView): string =>
  ['as-vcard', view.online ? '' : 'off', view.v.armed ? 'armed' : '', view.over ? 'over' : view.fit ?? ''].filter(Boolean).join(' ')

export function VehicleCard({ view, dragProps, onTap, onUnassign, onWrite, dict }: VehicleCardProps) {
  const { v } = view
  const tapMe = () => onTap({ kind: 'vehicle', sysid: v.sysid })
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.target !== e.currentTarget || !isActivation(e.key)) return
    e.preventDefault()
    tapMe()
  }
  return (
    <div className={cardClass(view)} role="button" tabIndex={0} aria-label={v.name} data-drop={v.sysid} onClick={tapMe} onKeyDown={onKeyDown}>
      <div className="as-vtop">
        <KindIcon kind={v.kind} size={18} />
        <span className="as-vname">{v.name}</span>
        <span className="as-vkind">{view.kindLabel}</span>
        <span className={view.online ? 'as-dot' : 'as-dot off'} title={view.online ? dict.asOnline : dict.asOffline} />
      </div>
      <Sub view={view} dict={dict} />
      <Slot view={view} dragProps={dragProps} onUnassign={onUnassign} dict={dict} />
      {view.why !== null && <div className="as-why">{view.why}</div>}
      <Foot view={view} onWrite={onWrite} dict={dict} />
      {/* a flash that repeats the reason line (an incompatible tap) adds nothing */}
      {view.flash !== null && view.flash !== view.why && <div className="as-flash" role="status">{view.flash}</div>}
    </div>
  )
}
