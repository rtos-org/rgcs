import { describe, expect, it } from 'vitest'
import { arcAngleThrough, arcLengthM, arcPoints, legPath, toLocal } from './arc'

// Around Kamikochi: 100 m east of A is B; P is 20 m north of the chord midpoint.
const A = { lat: 36.25, lon: 137.6 }
const east = (m: number) => m / (111_320 * Math.cos((36.25 * Math.PI) / 180))
const north = (m: number) => m / 110_540
const B = { lat: 36.25, lon: 137.6 + east(100) }
const P = { lat: 36.25 + north(20), lon: 137.6 + east(50) }
const P_SOUTH = { lat: 36.25 - north(20), lon: 137.6 + east(50) }
// half chord 50, sagitta 20 → r = 72.5 m, θ = 2·asin(50 / 72.5) ≈ 87.2°
const THETA = (2 * Math.asin(50 / 72.5) * 180) / Math.PI

describe('arc (NAV_ARC_WAYPOINT, MAV_CMD 36: param1 = arc angle, + clockwise)', () => {
  it('finds the angle of the arc from A through P to B; a bulge to the left of travel is clockwise (+)', () => {
    expect(arcAngleThrough(A, P, B)).toBeCloseTo(THETA, 0)
    expect(arcAngleThrough(A, P_SOUTH, B)).toBeCloseTo(-THETA, 0)
  })
  it('a point on the chord is a straight leg, and the angle stays within ±359°', () => {
    expect(arcAngleThrough(A, { lat: 36.25, lon: 137.6 + east(50) }, B)).toBe(0)
    expect(Math.abs(arcAngleThrough(A, { lat: 36.25 + north(0.01), lon: 137.6 + east(100.001) }, B))).toBeLessThanOrEqual(359)
  })
  it('samples the arc from A to B through the bulge', () => {
    const pts = arcPoints(A, B, THETA, 16)
    expect(pts[0]).toEqual(A)
    expect(pts.at(-1)!.lat).toBeCloseTo(B.lat, 9)
    expect(pts.at(-1)!.lon).toBeCloseTo(B.lon, 9)
    const mid = toLocal(A, pts[8]!)
    expect(mid.x).toBeCloseTo(50, 0)
    expect(mid.y).toBeCloseTo(20, 0)
    expect(toLocal(A, arcPoints(A, B, -THETA, 16)[8]!).y).toBeCloseTo(-20, 0)
  })
  it('bends the way ArduPilot flies it (SITL Copter 4.7-dev, 2026-10-20: ±90° from A to 100 m N / 100 m E)', () => {
    // flown: +90° passed within 0.6 m of (E 29.3, N 70.7), −90° within 0.9 m of (E 70.7, N 29.3), r ≈ 100 m
    const ne = { lat: 36.25 + north(100), lon: 137.6 + east(100) }
    const cw = toLocal(A, arcPoints(A, ne, 90, 16)[8]!)
    const ccw = toLocal(A, arcPoints(A, ne, -90, 16)[8]!)
    expect([cw.x, cw.y].map((v) => Math.round(v))).toEqual([29, 71])
    expect([ccw.x, ccw.y].map((v) => Math.round(v))).toEqual([71, 29])
  })
  it('an angle under 1° flies straight', () => {
    expect(arcPoints(A, B, 0.5)).toEqual([A, B])
    expect(arcLengthM(A, B, 0)).toBeCloseTo(100, 0)
  })
  it('measures the arc length (r·θ)', () => {
    expect(arcLengthM(A, B, THETA)).toBeCloseTo((72.5 * THETA * Math.PI) / 180, 0)
  })
  it('legPath bends only into an ARC_WAYPOINT', () => {
    const wp = { command: 16, frame: 'rel' as const, params: [0, 0, 0, 0] as [number, number, number, number], lat: B.lat, lon: B.lon, alt: 50, autocontinue: true }
    expect(legPath(A, wp)).toHaveLength(2)
    expect(legPath(A, { ...wp, command: 36, params: [THETA, 0, 0, 0] }).length).toBeGreaterThan(8)
  })
})
