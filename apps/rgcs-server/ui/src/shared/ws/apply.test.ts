import { describe, expect, it } from 'vitest'
import type { VehicleState } from '../api/types'
import { applyDiff } from './apply'

const base: VehicleState = {
  sysid: 1,
  name: 'UAV-01',
  kind: 'copter',
  mode: 'LOITER',
  armed: false,
  lat: 35.479883,
  lon: 138.47829,
  alt_rel: 80,
  alt_msl: 412,
  hdg: 15,
  ground_speed: 8.1,
  climb: 0,
  battery: { pct: 62, volt: 22.8, current: 12.5 },
  link: 'ok',
  last_rx_ms: 0,
  gps: { fix: 3, sats: 14, hdop: 1.2 },
  warn: false,
  unread: 0,
}

describe('applyDiff', () => {
  it('overrides only the fields present in the diff', () => {
    const next = applyDiff(base, { mode: 'AUTO', alt_rel: 81.5 })
    expect(next.mode).toBe('AUTO')
    expect(next.alt_rel).toBe(81.5)
    expect(next.lat).toBe(base.lat)
    expect(base.mode).toBe('LOITER')
  })

  it('accepts null for a heading that became unknown', () => {
    expect(applyDiff(base, { hdg: null }).hdg).toBeNull()
  })

  it('returns an equal object for an empty diff', () => {
    expect(applyDiff(base, {})).toEqual(base)
  })
})
