import type { SysId } from '../shared/api/types'
import type { Dict } from '../shared/i18n'
import { LogSheet } from '../features/log/LogSheet'
import type { LogState } from '../features/log/store'
import { vehicleStore } from '../features/vehicles/store'
import { Footer } from './Footer'

interface Props {
  readonly log: LogState
  readonly names: ReadonlyMap<SysId, string>
  readonly dict: Dict
  readonly clock: string
  readonly lead: boolean
  readonly deadmanLost: boolean
  readonly onFocusVehicle?: (sysid: SysId) => void
}

/** The log pill and its history sheet; rendered inside the stage so they centre on its free width (`--aside-w` / `--right-w`). */
export function LogDock({ log, names, dict, clock, lead, deadmanLost, onFocusVehicle }: Props) {
  return (
    <>
      {log.open && <LogSheet log={log} names={names} dict={dict} onFilter={(filter) => vehicleStore.logAction({ k: 'filter', filter })} onClose={() => vehicleStore.logAction({ k: 'close' })} onFocusVehicle={onFocusVehicle} />}
      <Footer log={log} names={names} dict={dict} clock={clock} lead={lead} onToggle={() => vehicleStore.logAction(log.open ? { k: 'close' } : { k: 'open' })} deadmanLost={deadmanLost} />
    </>
  )
}
