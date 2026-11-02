import { apiFetch } from '../../shared/api/client'
import type { LogEntry, SysId } from '../../shared/api/types'

/** Acknowledges a warning / error; idempotent, the first acknowledgement stands. */
export function ackMessage(sysid: SysId, id: number): Promise<LogEntry> {
  return apiFetch<LogEntry>(`/api/vehicles/${sysid}/messages/${id}/ack`, { method: 'POST' })
}
