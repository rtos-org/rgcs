import { useState } from 'react'
import type { SysId } from '../../shared/api/types'
import { msgStamp } from '../../shared/format/time'
import type { Dict } from '../../shared/i18n'
import { IconClose } from '../../shared/ui/icons'
import { entrySource, entryText } from './format'
import { SevIcon } from './SevIcon'
import { isAlert, type LogFilter, type LogState } from './store'

interface Props {
  readonly log: LogState
  readonly names: ReadonlyMap<SysId, string>
  readonly dict: Dict
  readonly onFilter: (f: LogFilter) => void
  readonly onClose: () => void
  /** Selects the entry's vehicle and centres the map on it (operator proposal 9). */
  readonly onFocusVehicle?: (sysid: SysId) => void
}

function shown(log: LogState) {
  const f = log.filter
  if (f === 'all') return log.entries
  if (f === 'alerts') return log.entries.filter(isAlert)
  return log.entries.filter((e) => e.sysid === f)
}

function Filters({ log, names, dict, onFilter }: Omit<Props, 'onClose'>) {
  const f = log.filter
  const buttons: [LogFilter, string][] = [['all', dict.logAll], ['alerts', dict.logAlerts], ...(typeof f === 'number' ? [[f, names.get(f) ?? `#${f}`] as [LogFilter, string]] : [])]
  return (
    <div className="rg-seg" style={{ height: 32 }}>
      {buttons.map(([key, label]) => (
        <button key={String(key)} type="button" className={key === f ? 'on' : ''} onClick={() => onFilter(key)} style={{ padding: '0 10px' }}>
          {label}
        </button>
      ))}
    </div>
  )
}

/** メッセージ履歴 (prototype `.logsheet`): filters, newest 500 rows, the note about older entries. */
export function LogSheet({ log, names, dict, onFilter, onClose, onFocusVehicle }: Props) {
  // when the sheet opened: dates entries not from that day, pure during render
  const [now] = useState(() => Date.now())
  const rows = shown(log)
  return (
    <div className="g-strong float map-c logsheet" role="dialog" aria-label={dict.logTitle}>
      <div className="row" style={{ gap: 10, padding: '14px 12px 10px 18px' }}>
        <span className="h2">{dict.logTitle}</span>
        <span className="t3 num">{rows.length}</span>
        <div className="grow" />
        <Filters log={log} names={names} dict={dict} onFilter={onFilter} />
        <button type="button" className="btn-icon sm" aria-label={dict.close} onClick={onClose}>
          <IconClose size={18} />
        </button>
      </div>
      <div className="list">
        {rows.map((e) => (
          <div key={e.id} className={`logrow ${e.severity}`} data-testid="logrow">
            <SevIcon severity={e.severity} size={15} />
            <span className="num t3">{msgStamp(e.ts, now, dict.yesterday)}</span>
            {e.sysid !== null && onFocusVehicle ? (
              <button type="button" className="src link" title={dict.focusVehicle} onClick={() => onFocusVehicle(e.sysid!)}>
                {entrySource(e, names, dict)}
              </button>
            ) : (
              <span className="src">{entrySource(e, names, dict)}</span>
            )}
            <span className="txt ell">{entryText(e, dict)}</span>
          </div>
        ))}
        {rows.length === 0 && (
          <div className="t4" style={{ padding: 18, textAlign: 'center' }}>
            {dict.logEmpty}
          </div>
        )}
      </div>
      <div
        className="t4"
        style={{
          padding: '8px 18px 12px',
          fontSize: 11,
          borderTop: '1px solid var(--line-soft)',
        }}
      >
        {dict.logKeep}
      </div>
    </div>
  )
}
