import { describe, expect, it, vi } from 'vitest'
import { toLocal } from '../mission/arc'
import type { LatLon } from '../mission/geo'
import type { ElevAt } from '../map/air'
import { surveyGeometry, type SurveyGeometry } from './generate'
import { gsdCm } from './photo'
import { ALPHA7R4, defaultSpec, type SurveySpec } from './spec'
import { groundRange, worstCase } from './worst'

const O: LatLon = { lat: 36.25, lon: 139.0 }
const M_LAT = 110_540
const M_LON = 111_320 * Math.cos((36.25 * Math.PI) / 180)
const at = (e: number, n: number): LatLon => ({ lat: O.lat + n / M_LAT, lon: O.lon + e / M_LON })
// 400 m east-west x 300 m north-south
const RECT = [at(0, 0), at(400, 0), at(400, 300), at(0, 300)]
const spec = (o: Partial<SurveySpec> = {}): SurveySpec => ({ ...defaultSpec(RECT, ALPHA7R4, 'plane'), angleDeg: 90, start: 'nw', ...o })
const geom = (s: SurveySpec): SurveyGeometry => {
  const g = surveyGeometry(s, null)
  if (!g) throw new Error('no lanes')
  return g
}
const eastOf = (lon: number, lat: number) => toLocal(O, { lat, lon }).x
/** Flat 0 m west of x = 50, rising to 100 m at x = 350, flat 100 m east of it. */
const ramp: ElevAt = (lon, lat) => Math.min(100, Math.max(0, ((eastOf(lon, lat) - 50) / 300) * 100))

describe('groundRange', () => {
  it('a thin diagonal sliver samples at most 2000 points (the grid is sized on its bounding box)', () => {
    // 20 km diagonal, 2 m wide: tiny area, huge bounding box
    const sliver = [at(0, 0), at(20_000, 20_000), at(20_002, 20_000), at(2, 0)]
    const elevAt = vi.fn<ElevAt>(() => 7)
    const started = performance.now()
    expect(groundRange(sliver, elevAt)).toEqual({ min: 7, max: 7 })
    // a 10 m grid over the 20 km box would test 4 million cells first
    expect(performance.now() - started).toBeLessThan(1500)
    expect(elevAt.mock.calls.length).toBeLessThanOrEqual(2000)
  })

  it('min and max of the ground inside the polygon', () => {
    expect(groundRange(RECT, ramp)).toEqual({ min: 0, max: 100 })
    expect(groundRange(RECT, () => 42)).toEqual({ min: 42, max: 42 })
  })

  it('ignores samples outside the polygon', () => {
    const tri = [at(0, 0), at(200, 0), at(0, 200)]
    // ground 500 m only beyond the hypotenuse (x + y > 200)
    const outside: ElevAt = (lon, lat) => {
      const p = toLocal(O, { lat, lon })
      return p.x + p.y > 200 ? 500 : 10
    }
    expect(groundRange(tri, outside)).toEqual({ min: 10, max: 10 })
  })

  it('at most 2000 samples, at least 10 m apart', () => {
    let n = 0
    const count: ElevAt = () => (n++, 0)
    groundRange([at(0, 0), at(5000, 0), at(5000, 5000), at(0, 5000)], count)
    expect(n).toBeGreaterThan(1500)
    expect(n).toBeLessThanOrEqual(2000)
    n = 0
    groundRange(RECT, count) // 120 000 m² / 10 m² cells
    expect(n).toBeLessThanOrEqual(1200)
    expect(n).toBeGreaterThan(1000)
  })

  it('null when no sample has data; samples without data are skipped', () => {
    expect(groundRange(RECT, () => null)).toBeNull()
    const half: ElevAt = (lon, lat) => (eastOf(lon, lat) < 200 ? 5 : null)
    expect(groundRange(RECT, half)).toEqual({ min: 5, max: 5 })
  })
})

describe('worstCase', () => {
  it('GSD at the lowest ground, overlaps at the highest ground (fixed trigger distance and spacing)', () => {
    const s = spec()
    const w = worstCase(s, geom(s), { min: 0, max: 50 }, 0)
    expect(w.gsdCm).toBeCloseTo(gsdCm(ALPHA7R4, 100), 9)
    // at 50 m AGL: along 34 m vs 13.6 m trigger distance, across 51 m vs 30.6 m spacing
    expect(w.frontPct).toBeCloseTo(60, 6)
    expect(w.sidePct).toBeCloseTo(40, 6)
    expect(w.minGsdCm).toBeCloseTo(gsdCm(ALPHA7R4, 50), 9)
  })

  it('flat ground at home level gives the set values', () => {
    const s = spec()
    const w = worstCase(s, geom(s), { min: 300, max: 300 }, 300)
    expect(w.frontPct).toBeCloseTo(80, 6)
    expect(w.sidePct).toBeCloseTo(70, 6)
    expect(w.gsdCm).toBeCloseTo(gsdCm(ALPHA7R4, 100), 9)
  })

  it('a slope rising 0 → 100 m west to east: worst front overlap below 80, worst GSD at 100 m AGL', () => {
    const s = spec()
    const range = groundRange(RECT, ramp)!
    const w = worstCase(s, geom(s), range, 0)
    expect(w.frontPct).toBeLessThan(80)
    expect(w.gsdCm).toBe(gsdCm(ALPHA7R4, 100))
  })

  it('ground at or above the flight altitude: no overlap at all', () => {
    const s = spec()
    const w = worstCase(s, geom(s), { min: 0, max: 120 }, 0)
    expect(w.frontPct).toBe(-100)
    expect(w.sidePct).toBe(-100)
  })
})
