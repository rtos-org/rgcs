import { useState } from 'react'
import type { LogEntry, SysId } from '../../shared/api/types'
import { msgStamp } from '../../shared/format/time'
import type { Dict } from '../../shared/i18n'
import { IconChevron } from '../../shared/ui/icons'
import { entryText } from '../log/format'
import { SevIcon } from '../log/SevIcon'
import { isAlert } from '../log/store'
import { lastForVehicle, pendingAlerts } from './messages'

interface Props {
  readonly sysid: SysId
  readonly entries: readonly LogEntry[]
  readonly dict: Dict
  readonly onAck: (sysid: SysId, id: number) => void
  readonly onOpenLog: (sysid: SysId) => void
}

function Row({ e, dict, onAck }: { readonly e: LogEntry; readonly dict: Dict; readonly onAck: () => void }) {
  // the day the row was first drawn: enough to date an old alert, and pure during render
  const [now] = useState(() => Date.now())
  const acked = isAlert(e) && e.acked_by !== null
  const body = e.source === 'link' && e.text === 'comms_delay' ? dict.commDelayBody : ''
  return (
    <div className={['msg', e.severity, acked ? 'done' : ''].filter(Boolean).join(' ')} data-testid="msg">
      <SevIcon severity={e.severity} size={16} />
      <div style={{ minWidth: 0 }}>
        <div className="row" style={{ gap: 10, fontSize: 13.5 }}>
          <span className="num t3">{msgStamp(e.ts, now, dict.yesterday)}</span>
          <span className="ttl ell" style={{ fontWeight: 500 }}>
            {entryText(e, dict)}
          </span>
        </div>
        {body && (
          <div className="t3" style={{ fontSize: 12, marginTop: 2 }}>
            {body}
          </div>
        )}
      </div>
      {e.ackable && !acked && (
        <button type="button" className={e.severity === 'error' ? 'ackbtn err' : 'ackbtn'} onClick={onAck}>
          {dict.ack}
        </button>
      )}
      {acked && <span className="acked">{dict.acked}</span>}
    </div>
  )
}

/** メッセージ (prototype detail panel): the newest pending alert, else the newest entry (lastForVehicle); alerts carry 確認. */
export function DetailMessages({ sysid, entries, dict, onAck, onOpenLog }: Props) {
  const list = lastForVehicle(entries, sysid)
  const pending = pendingAlerts(entries, sysid)
  return (
    <>
      <div className="row" style={{ gap: 10, padding: '14px 16px 6px' }}>
        <span className="h2">{dict.messages}</span>
        <div className="grow" />
        {pending > 0 && (
          <span className="count" title={dict.needAck}>
            {pending}
          </span>
        )}
        <button type="button" className="btn-icon sm" title={dict.logTitle} aria-label={dict.logTitle} onClick={() => onOpenLog(sysid)}>
          <IconChevron />
        </button>
      </div>
      {list.map((e) => (
        <Row key={e.id} e={e} dict={dict} onAck={() => onAck(sysid, e.id)} />
      ))}
      {list.length === 0 && (
        <div className="t4" style={{ padding: '6px 16px 14px', fontSize: 12 }}>
          {dict.logEmpty}
        </div>
      )}
    </>
  )
}
