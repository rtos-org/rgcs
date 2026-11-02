import { useState } from 'react'
import { KindIcon } from '../../shared/ui/KindIcon'
import type { Dict } from '../../shared/i18n'
import type { VehicleCommand, VehicleState } from '../../shared/api/types'
import { cmdLabel } from '../../shared/i18n'
import { IconCollapse, IconMenu, IconPin, IconSortAlerts } from '../../shared/ui/icons'
import { saveVehicleSort, sortVehicles, useVehicleSort } from './sort'
import { matches } from './format'
import { VehicleRow } from './VehicleRow'
import { dotClass } from './format'

interface Props {
  readonly vehicles: readonly VehicleState[]
  readonly selected: number | null
  readonly dict: Dict
  readonly onSelect: (sysid: number) => void
  readonly onFollow?: (sysid: number) => void
  readonly following?: number | null
  /** `rail` collapses the panel to a 60 px column of icons. */
  readonly aside?: 'full' | 'rail'
  readonly onToggleAside?: () => void
  /** Fleet pause / RTL (shown with two or more vehicles that have a link). */
  readonly onFleet?: (command: VehicleCommand) => void
  /** Vehicles with an active AI 緊急介入 alert (danger highlight on the row). */
  readonly guarded?: ReadonlySet<number>
}

const FLEET: readonly VehicleCommand[] = [{ cmd: 'pause' }, { cmd: 'rtl' }]

function FleetRow({ dict, onFleet }: { dict: Dict; onFleet: (c: VehicleCommand) => void }) {
  return (
    <div className="fleet-row">
      {FLEET.map((c) => (
        <button key={c.cmd} type="button" className={`btn btn-ghost btn-sm${c.cmd === 'pause' ? ' caution' : ''}`} onClick={() => onFleet(c)}>
          {`${dict.fleet} ${cmdLabel(c.cmd, dict)}`}
        </button>
      ))}
    </div>
  )
}

export function VehicleList({ vehicles, selected, dict, onSelect, onFollow, following = null, aside = 'full', onToggleAside, onFleet, guarded }: Props) {
  const [query, setQuery] = useState('')
  const sort = useVehicleSort()
  const shown = sortVehicles(vehicles.filter((v) => matches(v, query, dict)), sort)
  if (aside === 'rail') {
    return (
      <aside className="g panel float float-l" aria-label={dict.vehicles}>
        <div className="vrail">
          <button type="button" className="btn-icon" aria-label={dict.expand} title={dict.expand} onClick={onToggleAside}>
            <IconMenu />
          </button>
          {vehicles.map((v) => (
            <button key={v.sysid} type="button" className={`btn-icon${v.sysid === selected ? ' sel' : ''}${guarded?.has(v.sysid) ? ' guard' : ''}`} title={v.name} aria-label={v.name} onClick={() => onSelect(v.sysid)}>
              <KindIcon kind={v.kind} size={20} />
              <span className={dotClass(v)} style={{ width: 7, height: 7 }} />
            </button>
          ))}
        </div>
      </aside>
    )
  }
  return (
    <aside className="g panel float float-l" aria-label={dict.vehicles}>
      <div className="panel-h">
        <span className="h1">{dict.vehicles}</span>
        <span className="h1 t2" style={{ fontWeight: 300 }}>
          {vehicles.length}
        </span>
        <div className="grow" />
        <button type="button" className={`btn-icon${sort === 'alerts' ? ' on' : ''}`} title={dict.sortAlerts} aria-label={dict.sortAlerts} aria-pressed={sort === 'alerts'} onClick={() => saveVehicleSort(sort === 'alerts' ? 'id' : 'alerts')}>
          <IconSortAlerts />
        </button>
        <button type="button" className="btn-icon" title={dict.pinned} aria-label={dict.pinned} disabled>
          <IconPin />
        </button>
        {onToggleAside && (
          <button type="button" className="btn-icon" title={dict.collapse} aria-label={dict.collapse} onClick={onToggleAside}>
            <IconCollapse />
          </button>
        )}
      </div>
      <div className="vlist-search">
        <input className="in" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={dict.filterVehicles} aria-label={dict.filterVehicles} />
      </div>
      {onFleet && vehicles.filter((v) => v.link !== 'lost').length >= 2 && vehicles.some((v) => v.armed && v.link !== 'lost') && <FleetRow dict={dict} onFleet={onFleet} />}
      <div className="vlist-body" role="listbox">
        {shown.length === 0 && <div className="empty">{dict.noVehicles}</div>}
        {shown.map((v) => (
          <VehicleRow key={v.sysid} vehicle={v} selected={v.sysid === selected} dict={dict} onSelect={onSelect} onFollow={onFollow} following={following === v.sysid} guard={guarded?.has(v.sysid) ?? false} />
        ))}
      </div>
    </aside>
  )
}
