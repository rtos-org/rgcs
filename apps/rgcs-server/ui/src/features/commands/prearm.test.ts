import { describe, expect, it } from 'vitest'
import type { LogEntry } from '../../shared/api/types'
import { prearmReasons } from './prearm'

const e = (id: number, sysid: number, text: string, ts: number, source: LogEntry['source'] = 'vehicle'): LogEntry => ({ id, ts, sysid, source, severity: 'warn', text, ackable: false, acked_by: null, acked_at: null })
const NOW = 100_000

describe('prearmReasons', () => {
  it('lists the vehicle\'s recent PreArm / Arm refusals, newest first, without repeats, at most 3', () => {
    const entries = [
      e(6, 1, 'PreArm: Compass not calibrated', NOW - 1000),
      e(5, 1, 'Arm: Throttle too high', NOW - 2000),
      e(4, 1, 'PreArm: Compass not calibrated', NOW - 3000),
      e(3, 2, 'PreArm: GPS bad', NOW - 1000),
      e(2, 1, 'Mode LOITER', NOW - 1000),
      e(1, 1, 'PreArm: Battery low', NOW - 4000),
      e(0, 1, 'PreArm: RC not calibrated', NOW - 5000),
    ]
    expect(prearmReasons(entries, 1, NOW)).toEqual(['PreArm: Compass not calibrated', 'Arm: Throttle too high', 'PreArm: Battery low'])
  })
  it('ignores entries older than 30 s and non-vehicle sources', () => {
    expect(prearmReasons([e(1, 1, 'PreArm: GPS bad', NOW - 31_000), e(2, 1, 'PreArm: x', NOW, 'system')], 1, NOW)).toEqual([])
  })
})
