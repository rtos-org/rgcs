import { describe, expect, it } from 'vitest'
import { bearingOf, fanLengthPx, fanPath, footprint, hfovAt, isNadir } from './gimbal'

const M_PER_DEG_LAT = 111_320
const north = (lat0: number, lat: number) => (lat - lat0) * M_PER_DEG_LAT

describe('gimbal geometry', () => {
  it('bearing_wraps', () => {
    expect(bearingOf(10, 30)).toBe(340)
    expect(bearingOf(350, -20)).toBe(10)
    expect(bearingOf(90, 0)).toBe(90)
  })

  it('hfov_narrows_with_zoom', () => {
    expect(hfovAt(62, 1)).toBeCloseTo(62, 6)
    expect(hfovAt(62, 165)).toBeCloseTo(0.417, 2)
    expect(hfovAt(62, 2)).toBeCloseTo(33.44, 1)
  })

  it('fan_shortens_when_looking_down', () => {
    expect(fanLengthPx(0)).toBe(112)
    expect(fanLengthPx(-90)).toBe(48)
    expect(fanLengthPx(-45)).toBeLessThan(fanLengthPx(-10))
  })

  it('nadir_ring_when_looking_down', () => {
    expect(isNadir(-80)).toBe(true)
    expect(isNadir(-90)).toBe(true)
    expect(isNadir(-79.9)).toBe(false)
  })

  it('fan_path_is_a_wedge_up_from_the_centre_with_a_4_degree_minimum', () => {
    expect(fanPath(62, 0)).toMatch(/^M120,120 L\d+(\.\d)?,\d+(\.\d)? A112,112 0 0 1 \d+(\.\d)?,\d+(\.\d)? Z$/)
    const narrow = fanPath(0.4, 0).match(/L([\d.]+),/)![1]
    expect(120 - Number(narrow)).toBeCloseTo(112 * Math.sin((2 * Math.PI) / 180), 0)
  })

  it('projection_falls_back_above_the_horizon', () => {
    expect(footprint(36, 139, 100, 0, 0, 5, 62)).toBeNull()
    expect(footprint(36, 139, 100, 0, 0, -2, 62)).toBeNull() // hits beyond 1.5 km
    const poly = footprint(36, 139, 100, 0, 0, -45, 62)!
    expect(poly).toHaveLength(4)
    const [tl, tr, br, bl] = poly.map(([lng, lat]) => ({ lng, lat }))
    // heading north, looking 45° down from 100 m: the image spans ≈ 49 m … 202 m ahead
    expect(north(36, bl!.lat)).toBeCloseTo(49, -1)
    expect(north(36, tl!.lat)).toBeGreaterThan(190)
    expect(tl!.lng).toBeLessThan(139)
    expect(tr!.lng).toBeGreaterThan(139)
    expect(br!.lng).toBeGreaterThan(139)
  })

  it('projection_turns_with_heading_and_yaw', () => {
    // heading 90 (east), gimbal yaw 0 → looks east
    const east = footprint(36, 139, 100, 90, 0, -60, 62)!
    expect(east.every(([lng]) => lng > 139)).toBe(true)
    // heading 90, yaw 90 → bearing 0: looks north
    const turned = footprint(36, 139, 100, 90, 90, -60, 62)!
    expect(turned.every(([, lat]) => lat > 36)).toBe(true)
  })
})
