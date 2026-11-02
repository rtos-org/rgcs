import { describe, expect, it, vi } from 'vitest'
import type { VehicleState } from '../../shared/api/types'
import { TracksStore } from './tracksStore'

const v = (sysid: number, lon: number, fix = 3, alt_rel = 0): VehicleState => ({
  sysid, name: 'x', kind: 'copter', mode: '', armed: false, lat: 36, lon, alt_rel, alt_msl: 0, hdg: null,
  ground_speed: 0, climb: 0, battery: { pct: null, volt: 0, current: null }, link: 'ok', last_rx_ms: 0,
  gps: { fix, sats: 0, hdop: null }, warn: false, unread: 0,
})
const MIN = 60_000

describe('TracksStore', () => {
  it('accumulates positioned vehicles with altitude and time, notifying only on change', () => {
    const s = new TracksStore()
    const listener = vi.fn()
    s.subscribe(listener)
    s.ingest(new Map([[1, v(1, 139, 3, 20)], [2, v(2, 140, 0)]]), 1000)
    s.ingest(new Map([[1, v(1, 139.001, 3, 25)]]), 2000)
    s.ingest(new Map([[1, v(1, 139.001, 3, 25)]]), 3000) // jitter-free repeat: no change
    expect(s.getState().get(1)).toEqual([[139, 36, 20, 1000], [139.001, 36, 25, 2000]])
    expect(s.getState().has(2)).toBe(false)
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('drops points older than the kept minutes, also while the vehicle hovers', () => {
    const s = new TracksStore()
    s.setKeepMinutes(1)
    s.ingest(new Map([[1, v(1, 139)]]), 0)
    s.ingest(new Map([[1, v(1, 139.001)]]), 30_000)
    s.ingest(new Map([[1, v(1, 139.001)]]), 70_000) // no movement, but the first point expired
    expect(s.getState().get(1)).toEqual([[139.001, 36, 0, 30_000]])
  })

  it('a shorter setting trims at once; 0 keeps no track', () => {
    const s = new TracksStore()
    s.ingest(new Map([[1, v(1, 139)]]), Date.now() - 5 * MIN)
    s.ingest(new Map([[1, v(1, 139.001)]]), Date.now())
    s.setKeepMinutes(2)
    expect(s.getState().get(1)).toHaveLength(1)
    s.setKeepMinutes(0)
    expect(s.getState().size).toBe(0)
    s.ingest(new Map([[1, v(1, 139.002)]]), Date.now())
    expect(s.getState().size).toBe(0)
  })
})
