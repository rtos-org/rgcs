import type { LogEntry, SysId } from '../../shared/api/types'

/** The detail panel shows one log entry of the vehicle; the header's > opens the full log. */
export const DETAIL_MESSAGES = 1

const isPending = (e: LogEntry): boolean => e.ackable && e.acked_by === null

/** While an alert waits for 確認 the slot shows the newest such alert (with its button), else the newest entry. */
export function lastForVehicle(entries: readonly LogEntry[], sysid: SysId): readonly LogEntry[] {
  const own = entries.filter((e) => e.sysid === sysid)
  const pending = own.filter(isPending)
  return (pending.length > 0 ? pending : own).slice(0, DETAIL_MESSAGES)
}

/** Warnings / errors of the vehicle still waiting for a 確認. */
export function pendingAlerts(entries: readonly LogEntry[], sysid: SysId): number {
  return entries.filter((e) => e.sysid === sysid && isPending(e)).length
}
