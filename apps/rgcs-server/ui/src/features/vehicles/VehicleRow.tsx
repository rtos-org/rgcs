import type { Dict } from '../../shared/i18n'
import { KindIcon } from '../../shared/ui/KindIcon'
import type { VehicleState } from '../../shared/api/types'
import { IconAltitude, IconFollow, IconHouse, IconNav, IconSignal, IconSpeed } from '../../shared/ui/icons'
import { altText, battText, dotClass, homeDistText, speedText } from './format'
import { BattBar } from './BattBar'
import { ModeBadge } from './ModeBadge'

interface Props {
  readonly vehicle: VehicleState
  readonly selected: boolean
  readonly dict: Dict
  readonly onSelect: (sysid: number) => void
  readonly onFollow?: (sysid: number) => void
  readonly following?: boolean
  /** An active AI 緊急介入 alert on this vehicle. */
  readonly guard?: boolean
}

function signalTop(v: VehicleState): string {
  if (v.link === 'lost') return 'var(--danger)'
  if (v.link === 'delay') return 'var(--caution)'
  return 'var(--text)'
}

/** Prototype `.vrow`: icon column, name row (dot, name, mode, following, battery), stat row. Double-click follows (memory: ops map). */
export function VehicleRow({ vehicle: v, selected, dict, onSelect, onFollow, following = false, guard = false }: Props) {
  return (
    <div
      className={`vrow${selected ? ' sel' : ''}${guard ? ' guard' : ''}`}
      role="option"
      aria-selected={selected}
      tabIndex={0}
      title={onFollow ? dict.followHint : undefined}
      onClick={() => onSelect(v.sysid)}
      onDoubleClick={() => onFollow?.(v.sysid)}
      onKeyDown={(e) => e.key === 'Enter' && onSelect(v.sysid)}
    >
      <div className="lead">
        <KindIcon kind={v.kind} />
        {v.hdg !== null && (
          <span className="hdg" role="img" aria-label={`${dict.instHeading} ${Math.round(v.hdg)}°`} title={`${dict.instHeading} ${Math.round(v.hdg)}°`}>
            <span style={{ transform: `rotate(${Math.round(v.hdg)}deg)` }}>
              <IconNav />
            </span>
          </span>
        )}
      </div>
      <div className="row">
        <span className={dotClass(v)} data-testid="dot" />
        <span className="nm">{v.name}</span>
        <ModeBadge v={v} dict={dict} />
        {following && (
          <span className="follow-mark" title={dict.following} aria-label={dict.following} role="img">
            <IconFollow />
          </span>
        )}
        {v.unread > 0 && (
          <span className="warn-count num" aria-label={`${dict.unreadAlerts} ${v.unread}`} title={dict.unreadAlerts}>
            {v.unread}
          </span>
        )}
        <div className="grow" />
        <BattBar v={v} dict={dict} />
        <span className="num batt-text">{battText(v)}</span>
      </div>
      <div className="row num stat">
        {v.kind === 'rover' ? (
          <span className="row alt" style={{ gap: 4 }} title={dict.fromHome}>
            <IconHouse size={14} />
            {homeDistText(v)}
          </span>
        ) : (
          <>
            <IconAltitude size={15} />
            <span className="alt">{altText(v)}</span>
          </>
        )}
        <IconSpeed />
        <span className="spd">{speedText(v)}</span>
        <div className="grow" />
        <IconSignal top={signalTop(v)} />
      </div>
    </div>
  )
}
