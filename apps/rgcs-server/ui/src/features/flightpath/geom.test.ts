import { describe, expect, it } from 'vitest'
import { arcAngles, entryTangent, exitTangent, fillet, toLatLon, toXy } from './geom'

const c = { x: 0, y: 0 }
const near = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y)

describe('flight path geometry (local metres: x east, y north)', () => {
  it('converts to local metres and back around an origin', () => {
    const o = { lat: 36.25, lon: 137.6 }
    const p = toLatLon(o, { x: 100, y: -50 })
    const back = toXy(o, p)
    expect(back.x).toBeCloseTo(100, 3)
    expect(back.y).toBeCloseTo(-50, 3)
  })
  it('joins a clockwise circle on the side that keeps turning right', () => {
    // coming from the south toward a circle of 50 m: clockwise travel enters on the west side
    const t = entryTangent({ x: 0, y: -200 }, c, 50, true)!
    expect(Math.hypot(t.x, t.y)).toBeCloseTo(50, 6)
    expect(t.x).toBeLessThan(0)
    expect(entryTangent({ x: 0, y: -200 }, c, 50, false)!.x).toBeGreaterThan(0)
    expect(entryTangent({ x: 10, y: 0 }, c, 50, true)).toBeNull()
  })
  it('leaves the circle on the tangent that points at the next waypoint', () => {
    // next waypoint due north; clockwise travel leaves from the west side heading north
    const e = exitTangent({ x: 0, y: 200 }, c, 50, true)!
    expect(Math.hypot(e.x, e.y)).toBeCloseTo(50, 6)
    expect(e.x).toBeLessThan(0)
    expect(exitTangent({ x: 0, y: 200 }, c, 50, false)!.x).toBeGreaterThan(0)
  })
  it('walks the circle in the flying direction, adding whole turns', () => {
    const cw = arcAngles(Math.PI / 2, 0, true, 0, 10)
    expect(cw[0]).toBeCloseTo(Math.PI / 2)
    expect(cw.at(-1)).toBeCloseTo(0)
    expect(cw.every((a, i) => i === 0 || a < cw[i - 1]!)).toBe(true)
    const ccwTwo = arcAngles(0, 0, false, 2, 10)
    expect(ccwTwo.at(-1)! - ccwTwo[0]!).toBeCloseTo(4 * Math.PI)
  })
  it('rounds a corner with a fillet that starts before the waypoint and stays inside it', () => {
    // A (0,-300) → B (0,0) → C (300,0): a right turn of 90°
    const pts = fillet({ x: 0, y: -300 }, { x: 0, y: 0 }, { x: 300, y: 0 }, 50)
    expect(near(pts[0]!, { x: 0, y: -50 })).toBeLessThan(1e-6)
    expect(near(pts.at(-1)!, { x: 50, y: 0 })).toBeLessThan(1e-6)
    const closest = Math.min(...pts.map((p) => near(p, { x: 0, y: 0 })))
    expect(closest).toBeCloseTo(50 * (Math.SQRT2 - 1), 0)
    // a straight continuation needs no fillet; a short leg shrinks it
    expect(fillet({ x: 0, y: -300 }, { x: 0, y: 0 }, { x: 0, y: 300 }, 50)).toEqual([{ x: 0, y: 0 }])
    expect(near(fillet({ x: 0, y: -40 }, { x: 0, y: 0 }, { x: 300, y: 0 }, 50)[0]!, { x: 0, y: -20 })).toBeLessThan(1e-6)
  })
})
