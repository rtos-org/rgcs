import { describe, expect, it } from 'vitest'
import { DOUBLE_TAP_MS, escape, initialTaps, tap, type TapTarget } from './taps'

const plan = (id: number): TapTarget => ({ kind: 'plan', id })
const vehicle = (sysid: number): TapTarget => ({ kind: 'vehicle', sysid })
const empty: TapTarget = { kind: 'empty' }
const LATER = DOUBLE_TAP_MS + 100

describe('tap', () => {
  it('tap_picks_and_retap_unpicks', () => {
    const a = tap(initialTaps, plan(1), 1000)
    expect(a.action).toBe('pick')
    expect(a.state.picked).toBe(1)
    const b = tap(a.state, plan(1), 1000 + LATER)
    expect(b.action).toBe('unpick')
    expect(b.state.picked).toBeNull()
  })

  it('double_tap_on_a_plan_focuses_and_keeps_it_picked', () => {
    const a = tap(initialTaps, plan(1), 1000)
    const b = tap(a.state, plan(1), 1200)
    expect(b.action).toEqual({ focus: plan(1) })
    expect(b.state.picked).toBe(1)
    // a third quick tap starts a new sequence, not another double
    const c = tap(b.state, plan(1), 1300)
    expect(c.action).toBe('unpick')
  })

  it('double tap on an already picked plan still leaves it picked', () => {
    const a = tap(initialTaps, plan(1), 1000)
    const b = tap(a.state, plan(1), 1000 + LATER)
    expect(b.state.picked).toBeNull()
    const c = tap(b.state, plan(1), 1000 + LATER + 100)
    expect(c.action).toEqual({ focus: plan(1) })
    expect(c.state.picked).toBe(1)
  })

  it('tap_on_a_vehicle_assigns_the_picked_plan_and_keeps_it_picked', () => {
    const a = tap(initialTaps, plan(4), 1000)
    const b = tap(a.state, vehicle(2), 2000)
    expect(b.action).toEqual({ assign: [4, 2] })
    expect(b.state.picked).toBe(4)
    const c = tap(b.state, vehicle(3), 3000)
    expect(c.action).toEqual({ assign: [4, 3] })
    expect(c.state.picked).toBe(4)
  })

  it('tap on a vehicle without a pick does nothing', () => {
    const a = tap(initialTaps, vehicle(2), 1000)
    expect(a.action).toBe('none')
    expect(a.state.picked).toBeNull()
    const b = tap(a.state, vehicle(2), 1100)
    expect(b.action).toEqual({ focus: vehicle(2) })
  })

  it('double_tap_on_a_vehicle_assigns_once_then_focuses', () => {
    const a = tap(initialTaps, plan(4), 1000)
    const b = tap(a.state, vehicle(2), 2000)
    const c = tap(b.state, vehicle(2), 2150)
    expect([b.action, c.action]).toEqual([{ assign: [4, 2] }, { focus: vehicle(2) }])
    expect(c.state.picked).toBe(4)
  })

  it('empty_or_esc_unpicks', () => {
    const a = tap(initialTaps, plan(1), 1000)
    const b = tap(a.state, empty, 2000)
    expect(b.action).toBe('unpick')
    expect(b.state.picked).toBeNull()
    expect(tap(b.state, empty, 3000).action).toBe('none')
    expect(escape(a.state).picked).toBeNull()
    expect(escape(initialTaps)).toBe(initialTaps)
  })

  it('blocked_and_locked', () => {
    const canAssign = (planId: number, sysid: number) => !(planId === 4 && sysid === 9)
    const canPick = (planId: number) => planId !== 7
    const ctx = { canAssign, canPick }
    const a = tap(initialTaps, plan(4), 1000, ctx)
    const b = tap(a.state, vehicle(9), 2000, ctx)
    expect(b.action).toEqual({ blocked: [4, 9] })
    expect(b.state.picked).toBe(4)
    const c = tap(b.state, plan(7), 3000, ctx)
    expect(c.action).toEqual({ locked: 7 })
    expect(c.state.picked).toBe(4)
    const d = tap(c.state, plan(7), 3100, ctx)
    expect(d.action).toEqual({ focus: plan(7) })
    expect(d.state.picked).toBe(4)
  })

  it('taps_on_different_targets_are_not_a_double', () => {
    const a = tap(initialTaps, plan(1), 1000)
    const b = tap(a.state, plan(2), 1100)
    expect(b.action).toBe('pick')
    expect(b.state.picked).toBe(2)
    const c = tap(b.state, vehicle(2), 1200)
    expect(c.action).toEqual({ assign: [2, 2] })
    const d = tap(c.state, vehicle(3), 1300)
    expect(d.action).toEqual({ assign: [2, 3] })
  })

  it('does not mutate the input state', () => {
    const s = Object.freeze({ picked: null, last: null })
    expect(() => tap(s, plan(1), 1000)).not.toThrow()
    expect(s.picked).toBeNull()
  })
})
