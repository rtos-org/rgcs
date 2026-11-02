import { describe, expect, it } from 'vitest'
import type { Home, MissionItem } from '../../shared/api/types'
import { arcPoints } from '../mission/arc'
import { COPTER_DEFAULTS } from './copterParams'
import { predictCopter } from './copterPath'
import { toLatLon, toXy, type Xy } from './geom'

const home: Home = { lat: 36.25, lon: 137.6, alt: 1500 }
const at = (xy: Xy) => toLatLon(home, xy)
const item = (command: number, xy: Xy | null, alt: number, params: [number, number, number, number] = [0, 0, 0, 0]): MissionItem => {
  const p = xy ? at(xy) : { lat: 0, lon: 0 }
  return { command, frame: 'rel', params, lat: p.lat, lon: p.lon, alt, autocontinue: true }
}
const local = (items: MissionItem[], p = COPTER_DEFAULTS) => predictCopter(items, home, p).map((pt) => ({ ...toXy(home, pt), alt: pt.alt }))
const r = (pt: Xy, c: Xy) => Math.hypot(pt.x - c.x, pt.y - c.y)
const nearest = (path: { x: number; y: number }[], c: Xy) => Math.min(...path.map((pt) => r(pt, c)))

describe('predicted ArduCopter path (AUTO)', () => {
  it('takes off straight up where it stands, then flies straight to the waypoint', () => {
    const path = local([item(22, null, 30), item(16, { x: 0, y: 200 }, 30)])
    expect(path[0]).toMatchObject({ alt: 0 })
    expect(path.some((pt) => r(pt, { x: 0, y: 0 }) < 0.01 && Math.abs(pt.alt - 30) < 1e-6)).toBe(true)
    expect(r(path.at(-1)!, { x: 0, y: 200 })).toBeLessThan(0.01)
    expect(path.every((pt) => Math.abs(pt.x) < 0.01)).toBe(true)
  })

  it('climbs along a leg in a straight 3D line', () => {
    const path = local([item(22, null, 30), item(16, { x: 0, y: 400 }, 50), item(16, { x: 0, y: 400 }, 50, [5, 0, 0, 0])])
    const half = path.find((pt) => pt.y >= 200)!
    expect(half.alt).toBeCloseTo(30 + (20 * half.y) / 400, 1)
  })

  it('rounds a corner it flies through (WP_RADIUS), but stops exactly on one with a hold time', () => {
    const corner = { x: 0, y: 300 }
    const through = local([item(22, null, 30), item(16, corner, 30), item(16, { x: 300, y: 300 }, 30)])
    expect(nearest(through, corner)).toBeGreaterThan(0.5)
    expect(nearest(through, corner)).toBeLessThan(2)
    const held = local([item(22, null, 30), item(16, corner, 30, [3, 0, 0, 0]), item(16, { x: 300, y: 300 }, 30)])
    expect(nearest(held, corner)).toBeLessThan(0.01)
  })

  it('a waypoint without coordinates only changes height where the vehicle is', () => {
    const path = local([item(22, null, 30), item(16, { x: 0, y: 100 }, 30, [1, 0, 0, 0]), item(16, null, 60)])
    expect(r(path.at(-1)!, { x: 0, y: 100 })).toBeLessThan(0.01)
    expect(path.at(-1)!.alt).toBeCloseTo(60)
  })

  it('LOITER_TURNS flies to the nearest edge of the circle and goes round the given turns', () => {
    const c = { x: 0, y: 300 }
    const path = local([item(22, null, 30), item(18, c, 30, [2, 0, 50, 0]), item(16, { x: 0, y: 600 }, 30)])
    const edge = path.find((pt) => Math.abs(r(pt, c) - 50) < 0.5)!
    expect(edge.x).toBeCloseTo(0, 0)
    expect(edge.y).toBeCloseTo(250, 0)
    const onCircle = path.filter((pt) => Math.abs(r(pt, c) - 50) < 0.5)
    // two full turns at 10° steps
    expect(onCircle.length).toBeGreaterThanOrEqual(72)
    expect(r(path.at(-1)!, { x: 0, y: 600 })).toBeLessThan(0.01)
  })

  it('LOITER_TURNS is clockwise, or counter-clockwise for a negative radius', () => {
    const c = { x: 0, y: 300 }
    const second = (rad: number) => local([item(22, null, 30), item(18, c, 30, [1, 0, rad, 0])]).filter((pt) => Math.abs(r(pt, c) - 50) < 0.5)[1]!
    // from the south edge, clockwise (seen from above) heads west
    expect(second(50).x).toBeLessThan(0)
    expect(second(-50).x).toBeGreaterThan(0)
  })

  it('RTL climbs to RTL_ALT first when lower, flies home at that height and lands', () => {
    const path = local([item(22, null, 10), item(16, { x: 0, y: 200 }, 10), item(20, null, 0)])
    const i = path.findIndex((pt) => pt.alt > 10.5)
    expect(r(path[i]!, { x: 0, y: 200 })).toBeLessThan(0.01)
    expect(Math.max(...path.map((pt) => pt.alt))).toBeCloseTo(15)
    expect(path.at(-1)).toMatchObject({ alt: 0 })
    expect(r(path.at(-1)!, { x: 0, y: 0 })).toBeLessThan(0.01)
  })

  it('RTL keeps a higher altitude, capped by the cone near home', () => {
    const high = local([item(22, null, 50), item(16, { x: 0, y: 200 }, 50), item(20, null, 0)])
    expect(Math.max(...high.map((pt) => pt.alt))).toBeCloseTo(50)
    const near = local([item(22, null, 10), item(16, { x: 0, y: 3 }, 10, [1, 0, 0, 0]), item(20, null, 0)], { ...COPTER_DEFAULTS, rtlAlt: 30 })
    // 3 m from home with RTL_CONE_SLOPE 3: at most 9 m, but never below where it already is
    expect(Math.max(...near.map((pt) => pt.alt))).toBeCloseTo(10)
  })

  it('LAND with a position flies there level, then descends', () => {
    const path = local([item(22, null, 30), item(21, { x: 100, y: 0 }, 0)])
    const over = path.find((pt) => r(pt, { x: 100, y: 0 }) < 0.01)!
    expect(over.alt).toBeCloseTo(30)
    expect(path.at(-1)).toMatchObject({ alt: 0 })
  })

  it('spline waypoints pass through each point on a curve', () => {
    const a = { x: 0, y: 200 }
    const b = { x: 200, y: 300 }
    const path = local([item(22, null, 30), item(82, a, 30), item(82, b, 30), item(16, { x: 400, y: 200 }, 30)])
    expect(nearest(path, a)).toBeLessThan(0.01)
    expect(nearest(path, b)).toBeLessThan(0.01)
    // curved: between a and b the path leaves the chord
    const ab = path.filter((pt) => pt.x > 20 && pt.x < 180)
    const off = Math.max(...ab.map((pt) => Math.abs((pt.y - 200) - (pt.x / 200) * 100)))
    expect(off).toBeGreaterThan(5)
  })

  it('ARC_WAYPOINT follows the arc the planner draws', () => {
    const a = { x: 0, y: 200 }
    const b = { x: 200, y: 200 }
    const path = local([item(22, null, 30), item(16, a, 30, [1, 0, 0, 0]), item(36, b, 30, [90, 0, 0, 0])])
    const ref = arcPoints(at(a), at(b), 90).map((q) => toXy(home, q))
    const mid = ref[Math.floor(ref.length / 2)]!
    expect(nearest(path, mid)).toBeLessThan(1)
  })
})
