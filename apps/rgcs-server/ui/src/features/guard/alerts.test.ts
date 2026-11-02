import { describe, expect, it } from 'vitest'
import { guardAlert } from '../ai/fixtures'
import { activeSysids, applyGuardAlert, guardedVehicles, newestFirst, pruneAlerts, soundingIds, type AlertMap } from './alerts'

const EMPTY: AlertMap = new Map()

describe('applyGuardAlert', () => {
  it('keeps one entry per id with the latest phase', () => {
    const m1 = applyGuardAlert(EMPTY, guardAlert({ phase: 'alerting' }), 1_000)
    const m2 = applyGuardAlert(m1, guardAlert({ phase: 'countdown', deadline_ms: 6_000, ts: 1_000 }), 1_000)
    expect(m2.size).toBe(1)
    expect(m2.get('g-1')?.phase).toBe('countdown')
    expect(m1.get('g-1')?.phase).toBe('alerting') // immutable
  })

  it('drops a cleared alert', () => {
    const m = applyGuardAlert(applyGuardAlert(EMPTY, guardAlert(), 1_000), guardAlert({ phase: 'cleared' }), 2_000)
    expect(m.size).toBe(0)
  })

  it('keeps taken_over for 10 s, then drops it', () => {
    const t = 50_000
    const m = applyGuardAlert(EMPTY, guardAlert({ phase: 'taken_over', sound: false }), t)
    expect(pruneAlerts(m, t + 9_000).has('g-1')).toBe(true)
    expect(pruneAlerts(m, t + 11_000).has('g-1')).toBe(false)
    const other = guardAlert({ id: 'g-2', sysid: 4 })
    expect(applyGuardAlert(m, other, t + 11_000).has('g-1')).toBe(false)
  })

  it('keeps a mode-change takeover (and its tone) until cleared', () => {
    const t = 50_000
    const m1 = applyGuardAlert(EMPTY, guardAlert({ phase: 'alerting', sound: true }), t)
    const m2 = applyGuardAlert(m1, guardAlert({ phase: 'taken_over', taken_over_by: 'mode_change', vehicle_mode: 'LAND', sound: false }), t)
    expect(pruneAlerts(m2, t + 60_000).has('g-1')).toBe(true)
    expect(soundingIds(m2)).toEqual(['g-1'])
    expect([...activeSysids(m2)]).toEqual([3])
    expect(applyGuardAlert(m2, guardAlert({ phase: 'cleared' }), t + 61_000).size).toBe(0)
  })

  it('rebases the deadline onto the local clock (server clock skew does not matter)', () => {
    // server clock 1 h behind: ts 1_000, deadline 6_000 → 5 s left from the receipt time
    const m = applyGuardAlert(EMPTY, guardAlert({ phase: 'countdown', ts: 1_000, deadline_ms: 6_000 }), 3_601_000)
    expect(m.get('g-1')?.deadline_ms).toBe(3_606_000)
  })

  it('latches the tone through countdown and stops it on takeover or cancel', () => {
    const m1 = applyGuardAlert(EMPTY, guardAlert({ phase: 'alerting', sound: true }), 1_000)
    const m2 = applyGuardAlert(m1, guardAlert({ phase: 'countdown', sound: false, deadline_ms: 6_000, ts: 1_000 }), 1_000)
    expect(soundingIds(m2)).toEqual(['g-1'])
    const due = applyGuardAlert(m2, guardAlert({ phase: 'due', sound: false }), 1_500)
    expect(soundingIds(due)).toEqual(['g-1'])
    const m3 = applyGuardAlert(m2, guardAlert({ phase: 'cancelled', sound: false }), 2_000)
    expect(soundingIds(m3)).toEqual([])
    const m4 = applyGuardAlert(m3, guardAlert({ phase: 'unanswered', sound: true }), 3_000)
    expect(soundingIds(m4)).toEqual(['g-1'])
    const m5 = applyGuardAlert(m4, guardAlert({ phase: 'taken_over', sound: false }), 4_000)
    expect(soundingIds(m5)).toEqual([])
  })
})

describe('activeSysids', () => {
  it('lists vehicles with a live alert (not taken over)', () => {
    const m = applyGuardAlert(applyGuardAlert(EMPTY, guardAlert(), 1_000), guardAlert({ id: 'g-5', sysid: 5, phase: 'taken_over' }), 1_000)
    expect([...activeSysids(m)]).toEqual([3])
  })
})

describe('newestFirst', () => {
  it('orders by first arrival, newest first, and keeps the order on updates', () => {
    const a = applyGuardAlert(EMPTY, guardAlert({ id: 'g-1', sysid: 3 }), 1_000)
    const b = applyGuardAlert(a, guardAlert({ id: 'g-2', sysid: 4 }), 2_000)
    const c = applyGuardAlert(b, guardAlert({ id: 'g-1', sysid: 3, phase: 'countdown', deadline_ms: 9_000, ts: 3_000 }), 3_000)
    expect(newestFirst(c).map((x) => x.id)).toEqual(['g-2', 'g-1'])
  })
})

describe('guardedVehicles', () => {
  it('ORs the guard into the warn flag without touching other vehicles', () => {
    const v = (sysid: number) => ({ sysid, warn: false }) as never
    const vehicles = new Map([[3, v(3)], [4, v(4)]])
    const out = guardedVehicles(vehicles, new Set([3]))
    expect(out.get(3)).toMatchObject({ warn: true })
    expect(out.get(4)).toBe(vehicles.get(4))
    expect(guardedVehicles(vehicles, new Set())).toBe(vehicles)
  })
})
