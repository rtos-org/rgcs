import { describe, expect, it } from 'vitest'
import { cornerBlend, ramp, rampTime } from './scurve'

describe('jerk-limited speed ramp (AC_WPNav S-curve, snap ignored)', () => {
  it('reaches the speed through jerk / constant accel / jerk phases', () => {
    expect(rampTime(10, 2.5, 1)).toBeCloseTo(6.5)
    expect(ramp(10, 2.5, 1, 2.5)).toMatchObject({ v: expect.closeTo(3.125, 6), a: expect.closeTo(2.5, 6) })
    expect(ramp(10, 2.5, 1, 6.5).v).toBeCloseTo(10)
    // symmetric profile: the distance is the mean speed times the time
    expect(ramp(10, 2.5, 1, 6.5).s).toBeCloseTo(32.5)
    expect(ramp(10, 2.5, 1, 8.5).s).toBeCloseTo(52.5)
  })
  it('a slow target never reaches the full acceleration', () => {
    expect(rampTime(4, 2.5, 1)).toBeCloseTo(4)
    expect(ramp(4, 2.5, 1, 4).s).toBeCloseTo(8)
  })
})

describe('fast-waypoint corner (SCurve::advance_target_along_track)', () => {
  const lim = { accel: 2.5, jerk: 1, accelCorner: 5, radius: 2 }
  it('a right angle at 10 m/s is rounded with its mid point just inside WP_RADIUS', () => {
    const pts = cornerBlend({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }, 10, 10, lim)
    const closest = Math.min(...pts.map((p) => Math.hypot(p.x, p.y)))
    expect(closest).toBeLessThan(2)
    expect(closest).toBeGreaterThan(1)
    // the turn starts on the incoming leg and ends on the outgoing one, symmetric
    expect(pts[0]!.x).toBeCloseTo(0)
    expect(pts[0]!.y).toBeLessThan(-3)
    expect(pts.at(-1)!.y).toBeCloseTo(0)
    expect(pts.at(-1)!.x).toBeCloseTo(-pts[0]!.y)
  })
  it('a bigger WP_RADIUS cuts the corner more', () => {
    const small = cornerBlend({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }, 10, 10, lim)
    const big = cornerBlend({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 1, y: 0, z: 0 }, 10, 10, { ...lim, radius: 10 })
    expect(-big[0]!.y).toBeGreaterThan(-small[0]!.y)
  })
  it('straight on, the blend stays on the line', () => {
    const pts = cornerBlend({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 0 }, 10, 10, lim)
    expect(pts.every((p) => Math.abs(p.x) < 1e-9)).toBe(true)
  })
})
