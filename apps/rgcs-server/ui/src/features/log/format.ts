import type { LogEntry, SysId } from '../../shared/api/types'
import { cmdLabel, type Dict } from '../../shared/i18n'
import { messageText } from '../detail/format'

/** Refusal codes (lowercase MAV_RESULT names, timeout, link_closed); `failed` adds nothing to 失敗. */
const REASONS: Record<string, keyof Dict | null> = {
  failed: null,
  denied: 'rsDenied',
  unsupported: 'rsUnsupported',
  temporarily_rejected: 'rsTemporarilyRejected',
  timeout: 'rsTimeout',
  link_closed: 'rsLinkClosed',
}

function reasonText(reason: string, dict: Dict): string {
  if (!(reason in REASONS)) return reason
  const key = REASONS[reason]
  return key ? dict[key] : ''
}

/** Command entries are "<cmd>" or "<cmd> <reason>" (server message_log); shown as "<label> 成功|失敗 <reason>". */
function commandText(e: LogEntry, dict: Dict): string {
  const [cmd = '', ...rest] = e.text.split(' ')
  const outcome = e.severity === 'error' ? dict.failed : dict.ok
  return [cmdLabel(cmd, dict), outcome, reasonText(rest.join(' '), dict)].filter(Boolean).join(' ')
}

/** Link codes and command names are translated; vehicle text stays verbatim. */
export function entryText(e: LogEntry, dict: Dict): string {
  if (e.source === 'command') return commandText(e, dict)
  return messageText(e.text, dict)
}

/** The vehicle's name, or システム for entries without one. */
export function entrySource(e: LogEntry, names: ReadonlyMap<SysId, string>, dict: Dict): string {
  if (e.sysid === null) return dict.logSystem
  return names.get(e.sysid) ?? `#${e.sysid}`
}
