import type { SysId } from '../shared/api/types'
import type { Dict } from '../shared/i18n'
import { LogPill } from '../features/log/LogPill'
import type { LogState } from '../features/log/store'

interface Props {
  readonly log: LogState
  readonly names: ReadonlyMap<SysId, string>
  readonly dict: Dict
  readonly clock: string
  /** 「全体」 lead (not in maintenance). */
  readonly lead: boolean
  readonly onToggle: () => void
  readonly deadmanLost?: boolean
}

/** Bottom-centre footer (prototype footer): the log pill, then the clock. */
export function Footer({ log, names, dict, clock, lead, onToggle, deadmanLost = false }: Props) {
  return (
    <footer className="g-ctl float map-c footer-log">
      <LogPill log={log} names={names} dict={dict} lead={lead} deadmanLost={deadmanLost} onToggle={onToggle} />
      {clock && (
        <span className="num t3 footer-clock" style={{ flex: 'none' }}>
          {clock}
        </span>
      )}
    </footer>
  )
}
