import type { LogEntry, SysId } from '../../shared/api/types'
import { hhmmss } from '../../shared/format/time'
import type { Dict } from '../../shared/i18n'
import { IconChevronDown, IconChevronUp, IconWarn } from '../../shared/ui/icons'
import { entrySource, entryText } from './format'
import { SevIcon } from './SevIcon'
import type { LogState } from './store'

interface Props {
  readonly log: LogState
  readonly names: ReadonlyMap<SysId, string>
  readonly dict: Dict
  /** 「全体」 before the entry (not in maintenance). */
  readonly lead: boolean
  readonly deadmanLost: boolean
  readonly onToggle: () => void
}

function Latest({ entry, names, dict }: { readonly entry: LogEntry; readonly names: ReadonlyMap<SysId, string>; readonly dict: Dict }) {
  return (
    <>
      <SevIcon severity={entry.severity} size={16} />
      <span className="num t3" style={{ flex: 'none' }}>
        {hhmmss(entry.ts)}
      </span>
      <span className="t2" style={{ flex: 'none', fontWeight: 500 }}>
        {entrySource(entry, names, dict)}
      </span>
      <span className="ell" style={{ flex: 1 }}>
        {entryText(entry, dict)}
      </span>
    </>
  )
}

/** The footer's one-line log (prototype `button.logpill`): newest entry, unread-alert badge, chevron. */
export function LogPill({ log, names, dict, lead, deadmanLost, onToggle }: Props) {
  const latest = log.entries[0]
  return (
    <button type="button" className="logpill" onClick={onToggle} title={dict.logTitle} aria-label={dict.logTitle} aria-expanded={log.open}>
      {lead && (
        <>
          <span style={{ fontWeight: 500, flex: 'none' }}>{dict.all}</span>
          <span
            style={{
              width: 1,
              height: 16,
              background: 'var(--line-hi)',
              flex: 'none',
            }}
          />
        </>
      )}
      {deadmanLost ? (
        <>
          <SevIcon severity="error" size={16} />
          <span className="ell" style={{ flex: 1 }}>
            {dict.joystickLost}
          </span>
        </>
      ) : latest ? (
        <Latest entry={latest} names={names} dict={dict} />
      ) : (
        <span className="ell t3" style={{ flex: 1 }}>
          {dict.logEmpty}
        </span>
      )}
      {log.unreadAlerts > 0 && (
        <span className="newbadge" title={dict.logNewAlerts}>
          <IconWarn size={12} />
          {log.unreadAlerts}
        </span>
      )}
      <span className="t3" style={{ flex: 'none', display: 'grid' }}>
        {log.open ? <IconChevronDown /> : <IconChevronUp />}
      </span>
    </button>
  )
}
