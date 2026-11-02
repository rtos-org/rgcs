import type { Severity, VehicleMessage } from '../shared/api/types'

/** A `VehicleMessage` fixture with the derived fields the server fills in (level, ackable …). */
export function vm(m: { id: number; sysid: number; severity: number; text: string; ts: number }, extra: Partial<VehicleMessage> = {}): VehicleMessage {
  const level: Severity = m.severity <= 3 ? 'error' : m.severity === 4 ? 'warn' : 'info'
  return {
    ...m,
    level,
    source: 'vehicle',
    ackable: level === 'warn' || level === 'error',
    acked_by: null,
    acked_at: null,
    ...extra,
  }
}
