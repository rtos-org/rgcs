import { describe, expect, it } from 'vitest'
import type { LogEntry } from '../../shared/api/types'
import { lastForVehicle, pendingAlerts } from './messages'

const e = (id: number, over: Partial<LogEntry> = {}): LogEntry => ({ id, ts: id, sysid: 1, source: 'vehicle', severity: 'warn', text: `m${id}`, ackable: true, acked_by: null, acked_at: null, ...over })

describe('detail messages', () => {
  it('takes the newest one of the vehicle', () => {
    const list = [e(5, { sysid: 2 }), e(4), e(3), e(2), e(1)]
    expect(lastForVehicle(list, 1).map((x) => x.id)).toEqual([4])
  })

  it('shows the newest unacknowledged alert while any is pending, not a newer info line', () => {
    const info = { severity: 'info' as const, ackable: false }
    const list = [e(6, info), e(5, { acked_by: 'admin', acked_at: 1 }), e(4), e(3), e(2, { sysid: 2 })]
    expect(lastForVehicle(list, 1).map((x) => x.id)).toEqual([4])
    const settled = [e(6, info), e(5, { acked_by: 'admin', acked_at: 1 })]
    expect(lastForVehicle(settled, 1).map((x) => x.id)).toEqual([6])
  })

  it('counts ackable alerts that nobody acknowledged', () => {
    const list = [e(4), e(3, { acked_by: 'admin', acked_at: 1 }), e(2, { ackable: false, source: 'command', severity: 'error' }), e(1, { sysid: 2 })]
    expect(pendingAlerts(list, 1)).toBe(1)
  })
})
