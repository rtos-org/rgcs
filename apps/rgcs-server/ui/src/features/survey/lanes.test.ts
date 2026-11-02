import { describe, expect, it } from 'vitest'
import type { LatLon } from '../mission/geo'
import { toLocal } from '../mission/arc'
import { buildLanes, orderLanes, polygonAreaM2, type Lane } from './lanes'

const O: LatLon = { lat: 36.25, lon: 139.0 }
const M_LAT = 110_540
const M_LON = 111_320 * Math.cos((36.25 * Math.PI) / 180)
/** Point `e` m east and `n` m north of O. */
const at = (e: number, n: number): LatLon => ({ lat: O.lat + n / M_LAT, lon: O.lon + e / M_LON })
const len = (l: Lane) => Math.hypot(toLocal(l.a, l.b).x, toLocal(l.a, l.b).y)

// 300 m east-west x 200 m north-south
const RECT = [at(0, 0), at(300, 0), at(300, 200), at(0, 200)]

describe('buildLanes', () => {
  it('rectangle at 90 degrees: 4 lanes of 300 m', () => {
    const lanes = buildLanes(RECT, 90, 50, 0, 0)!
    expect(lanes).toHaveLength(4)
    for (const l of lanes) expect(len(l)).toBeCloseTo(300, 0)
    expect(lanes.map((l) => l.y)).toEqual([...lanes.map((l) => l.y)].sort((a, b) => a - b))
    expect(lanes[1].y - lanes[0].y).toBeCloseTo(50, 6)
  })
  it('across margin adds a lane, along margin lengthens', () => {
    const lanes = buildLanes(RECT, 90, 50, 10, 25)!
    expect(lanes).toHaveLength(5)
    for (const l of lanes) expect(len(l)).toBeCloseTo(320, 0)
  })
  it('lane at bearing 0 runs north-south', () => {
    const lanes = buildLanes(RECT, 0, 50, 0, 0)!
    expect(lanes).toHaveLength(6)
    const d = toLocal(lanes[0].a, lanes[0].b)
    expect(Math.abs(d.x)).toBeLessThan(0.5)
    expect(Math.abs(d.y)).toBeCloseTo(200, 0)
  })
  it('concave U gives two lanes at the same y', () => {
    const u = [at(0, 0), at(300, 0), at(300, 200), at(200, 200), at(200, 50), at(100, 50), at(100, 200), at(0, 200)]
    const lanes = buildLanes(u, 90, 50, 0, 0)!
    const top = lanes.filter((l) => Math.abs(l.y - lanes[0].y) < 1e-6)
    expect(top).toHaveLength(2)
    expect(len(top[0])).toBeCloseTo(100, 0)
  })
  it('an exact multiple of the spacing does not gain a lane', () => {
    const strip = [at(0, 0), at(300, 0), at(300, 100), at(0, 100)]
    expect(buildLanes(strip, 90, 50, 0, 0)).toHaveLength(2)
    expect(buildLanes(strip, 90, 25, 0, 0)).toHaveLength(4)
  })
  it('null for invalid polygons', () => {
    expect(buildLanes([], 0, 50, 0, 0)).toBeNull()
    // a guard: more rows than MAX_LANES are never built
    expect(buildLanes(RECT, 90, 0.01, 0, 0)).toBeNull()
    expect(buildLanes([at(0, 0), at(10, 10)], 0, 50, 0, 0)).toBeNull()
    expect(buildLanes([at(0, 0), at(100, 100), at(100, 0), at(0, 100)], 0, 50, 0, 0)).toBeNull()
    expect(buildLanes([at(0, 0), at(0.5, 0), at(0, 0.5)], 0, 50, 0, 0)).toBeNull()
  })
})

describe('polygonAreaM2', () => {
  it('rectangle', () => expect(polygonAreaM2(RECT) / 60000).toBeCloseTo(1, 2))
})

describe('orderLanes', () => {
  const row = (n: number): Lane[] => Array.from({ length: n }, (_, y) => ({ a: O, b: O, y }))
  it('skip 0', () => expect(orderLanes(row(6), 0, 1)).toEqual([0, 1, 2, 3, 4, 5]))
  it('skip 1', () => expect(orderLanes(row(6), 1, 1)).toEqual([0, 2, 4, 1, 3, 5]))
  it('skip 2', () => expect(orderLanes(row(5), 2, 1)).toEqual([0, 3, 1, 4, 2]))
})
