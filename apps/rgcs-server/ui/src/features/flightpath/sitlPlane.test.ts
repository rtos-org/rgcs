// Regression against an ArduPlane SITL flight (QuadPlane, no wind, 2026-10-21): the predicted path
// must follow the flown track through the 173° corner at WP8 and home again after the mission.
import { describe, expect, it } from 'vitest'
import type { Home, MissionItem } from '../../shared/api/types'
import sitl from './__fixtures__/sitlPlane.json'
import { toXy, type Xy } from './geom'
import { planeParams } from './params'
import { predictPlane } from './planePath'

const home: Home = sitl.home
const items = sitl.items as MissionItem[]
const { params } = planeParams(new Map(Object.entries(sitl.params)))
const path = predictPlane(items, home, params).map((p) => toXy(home, p))
const flown = (pts: readonly (readonly number[])[]): Xy[] => pts.map(([lat, lon]) => toXy(home, { lat: lat!, lon: lon! }))

/** Distance from `q` to the nearest piece of the predicted path. */
function off(q: Xy): number {
  return path.slice(1).reduce((best, b, k) => {
    const a = path[k]!
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len2 = dx * dx + dy * dy
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((q.x - a.x) * dx + (q.y - a.y) * dy) / len2)) : 0
    return Math.min(best, Math.hypot(q.x - a.x - t * dx, q.y - a.y - t * dy))
  }, Infinity)
}
const mean = (xs: readonly number[]) => xs.reduce((s, x) => s + x, 0) / xs.length

describe('predicted plane path against the SITL flight', () => {
  it('flies on to WP8 and turns there (accepted 91 m out), not ~400 m early', () => {
    const wp8 = toXy(home, items[7]!)
    expect(Math.min(...path.map((p) => Math.hypot(p.x - wp8.x, p.y - wp8.y)))).toBeLessThan(100)
  })

  it('follows the WP7 → WP8 → WP9 legs, the overshoot after the corner included', () => {
    expect(mean(flown(sitl.flown.seq8).map(off))).toBeLessThan(25)
    expect(mean(flown(sitl.flown.seq9).map(off))).toBeLessThan(25)
  })

  it('the WP3 / WP4 corners stay as close as before (14.1 / 18.5 m before the fix)', () => {
    expect(Math.max(...flown(sitl.flown.seq3).map(off))).toBeLessThan(14.5)
    expect(Math.max(...flown(sitl.flown.seq4).map(off))).toBeLessThan(19)
  })

  it('returns home after the last waypoint (mission end switches to RTL)', () => {
    expect(mean(flown(sitl.flown.rtl).map(off))).toBeLessThan(25)
  })
})
