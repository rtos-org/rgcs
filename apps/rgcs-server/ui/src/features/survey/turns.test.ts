import { describe, expect, it } from 'vitest'
import type { Xy } from '../mission/arc'
import { ARC_SPLIT_DEG, arcEnd, planTurn, splitArc, type TurnArc } from './turns'

const RAD = Math.PI / 180
const near = (p: Xy, q: Xy, tol = 0.01) => Math.hypot(p.x - q.x, p.y - q.y) <= tol
/** Unit travel direction at maths angle `deg` on an arc turning with `sweep` (+ = clockwise). */
const tangent = (deg: number, sweep: number): Xy => ({
  x: Math.sign(sweep) * Math.sin(deg * RAD),
  y: -Math.sign(sweep) * Math.cos(deg * RAD),
})
const angleBetween = (a: Xy, b: Xy) => Math.acos(Math.max(-1, Math.min(1, a.x * b.x + a.y * b.y))) / RAD
const arcStart = (a: TurnArc): Xy => ({ x: a.center.x + a.r * Math.cos(a.from * RAD), y: a.center.y + a.r * Math.sin(a.from * RAD) })

// heading 90 (east): along-track = +x, the left side is north (+y)
describe('planTurn: U turn (d >= 2R)', () => {
  const end = { x: 300, y: 0 }
  const start = { x: 300, y: 120 }
  const t = planTurn(end, start, 90, 50)
  it('is a u with two quarter arcs', () => {
    expect(t.kind).toBe('u')
    expect(t.arcs).toHaveLength(2)
    for (const a of t.arcs) {
      expect(Math.abs(a.sweepDeg)).toBeCloseTo(90, 6)
      expect(a.r).toBeCloseTo(50, 6)
    }
  })
  it('a left-hand next lane turns counter-clockwise (negative sweep)', () => {
    expect(t.arcs.map((a) => Math.sign(a.sweepDeg))).toEqual([-1, -1])
    const right = planTurn(end, { x: 300, y: -120 }, 90, 50)
    expect(right.arcs.map((a) => Math.sign(a.sweepDeg))).toEqual([1, 1])
  })
  it('stays within R beyond x_turn and ends at start', () => {
    for (const p of t.points) expect(p.x).toBeLessThanOrEqual(300 + 50 + 0.01)
    expect(near(t.points[0], end)).toBe(true)
    expect(near(t.points[t.points.length - 1], start)).toBe(true)
  })
  it('arcs are joined by a straight of d - 2R', () => {
    const gap = arcStart(t.arcs[1])
    const e = arcEnd(t.arcs[0])
    expect(Math.hypot(gap.x - e.x, gap.y - e.y)).toBeCloseTo(20, 6)
    expect(near(arcStart(t.arcs[0]), end)).toBe(true)
    expect(near(arcEnd(t.arcs[1]), start)).toBe(true)
  })
})

describe('planTurn: omega turn (d < 2R)', () => {
  const end = { x: 300, y: 0 }
  const left = planTurn(end, { x: 300, y: 30 }, 90, 57.22)
  const right = planTurn(end, { x: 300, y: -30 }, 90, 57.22)
  it('is an omega with three arcs', () => {
    expect(left.kind).toBe('omega')
    expect(left.arcs).toHaveLength(3)
    expect(right.kind).toBe('omega')
  })
  it('sweep signs alternate +, -, + to the left and mirror to the right', () => {
    expect(left.arcs.map((a) => Math.sign(a.sweepDeg))).toEqual([1, -1, 1])
    expect(right.arcs.map((a) => Math.sign(a.sweepDeg))).toEqual([-1, 1, -1])
  })
  it('turns 180 degrees in total', () => {
    expect(left.arcs.reduce((s, a) => s + a.sweepDeg, 0)).toBeCloseTo(-180, 6)
    expect(right.arcs.reduce((s, a) => s + a.sweepDeg, 0)).toBeCloseTo(180, 6)
  })
  it('consecutive arcs meet and are tangent', () => {
    for (const t of [left, right]) {
      for (let i = 0; i + 1 < t.arcs.length; i++) {
        const a = t.arcs[i]
        const b = t.arcs[i + 1]
        expect(near(arcEnd(a), arcStart(b))).toBe(true)
        const ta = tangent(a.from - a.sweepDeg, a.sweepDeg)
        const tb = tangent(b.from, b.sweepDeg)
        expect(angleBetween(ta, tb)).toBeLessThan(0.5)
      }
    }
  })
  it('enters on the lane heading and leaves on the reverse heading', () => {
    const a0 = left.arcs[0]
    const a2 = left.arcs[2]
    expect(angleBetween(tangent(a0.from, a0.sweepDeg), { x: 1, y: 0 })).toBeLessThan(0.5)
    expect(angleBetween(tangent(a2.from - a2.sweepDeg, a2.sweepDeg), { x: -1, y: 0 })).toBeLessThan(0.5)
    expect(near(left.points[left.points.length - 1], { x: 300, y: 30 })).toBe(true)
  })
})

describe('planTurn: frame and lane ends', () => {
  it('unequal lane ends put the turn beyond the farther end', () => {
    const t = planTurn({ x: 300, y: 0 }, { x: 260, y: 120 }, 90, 50)
    expect(near(arcStart(t.arcs[0]), { x: 300, y: 0 })).toBe(true)
    expect(near(arcEnd(t.arcs[1]), { x: 300, y: 120 })).toBe(true)
    expect(Math.max(...t.points.map((p) => p.x))).toBeCloseTo(350, 6)
    expect(near(t.points[t.points.length - 1], { x: 260, y: 120 })).toBe(true)
  })
  it('a start beyond the end extends the finished lane', () => {
    const t = planTurn({ x: 260, y: 0 }, { x: 300, y: 120 }, 90, 50)
    expect(near(arcStart(t.arcs[0]), { x: 300, y: 0 })).toBe(true)
    expect(near(t.points[0], { x: 260, y: 0 })).toBe(true)
  })
  it('heading 0 (north): the left side is west', () => {
    const t = planTurn({ x: 0, y: 300 }, { x: -120, y: 300 }, 0, 50)
    expect(t.arcs.map((a) => Math.sign(a.sweepDeg))).toEqual([-1, -1])
    for (const p of t.points) expect(p.y).toBeLessThanOrEqual(350.01)
    expect(Math.max(...t.points.map((p) => p.y))).toBeCloseTo(350, 6)
    expect(near(t.points[t.points.length - 1], { x: -120, y: 300 })).toBe(true)
  })
  it('an oblique heading keeps the omega tangent to both lanes', () => {
    const h = 37
    const u = { x: Math.sin(h * RAD), y: Math.cos(h * RAD) }
    const v = { x: -u.y, y: u.x } // left of travel
    const end = { x: 10, y: 20 }
    const start = { x: end.x + 20 * v.x, y: end.y + 20 * v.y }
    const t = planTurn(end, start, h, 40)
    expect(t.kind).toBe('omega')
    const a0 = t.arcs[0]
    const a2 = t.arcs[2]
    expect(angleBetween(tangent(a0.from, a0.sweepDeg), u)).toBeLessThan(0.5)
    expect(angleBetween(tangent(a2.from - a2.sweepDeg, a2.sweepDeg), { x: -u.x, y: -u.y })).toBeLessThan(0.5)
    expect(near(arcEnd(a2), start)).toBe(true)
  })
})

describe('splitArc', () => {
  const arc = (sweepDeg: number): TurnArc => ({ center: { x: 0, y: 0 }, r: 10, from: 90, sweepDeg })
  it('splits into segments of at most ARC_SPLIT_DEG', () => {
    expect(ARC_SPLIT_DEG).toBe(30)
    expect(splitArc(arc(90))).toHaveLength(3)
    expect(splitArc(arc(200))).toHaveLength(7)
    expect(splitArc(arc(-200))).toHaveLength(7)
  })
  it('excludes the start and ends at the arc end, clockwise for +', () => {
    const pts = splitArc(arc(90))
    expect(near(pts[0], { x: 5, y: 10 * Math.cos(30 * RAD) })).toBe(true)
    expect(near(pts[2], { x: 10, y: 0 })).toBe(true)
    expect(near(pts[2], arcEnd(arc(90)))).toBe(true)
    expect(near(splitArc(arc(-90))[2], { x: -10, y: 0 })).toBe(true)
  })
})
