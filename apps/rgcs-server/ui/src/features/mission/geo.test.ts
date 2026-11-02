import { describe, expect, it } from 'vitest'
import type { MissionItem } from '../../shared/api/types'
import { haversineM, midpoint, pathGeoJson, remainingDistanceM, placeTakeoffs } from './geo'

const item = (command: number, lat: number, lon: number, alt: number): MissionItem => ({ command, frame: 'rel', params: [0, 0, 0, 0], lat, lon, alt, autocontinue: true })

describe('geo', () => {
  it('path_geojson_normalises_altitude_between_min_and_max', () => {
    const items = [item(22, 35.481883, 138.48029, 30), item(178, 0, 0, 0), item(16, 35.482883, 138.48129, 80), item(16, 35.483883, 138.48229, 55), item(20, 0, 0, 0)]
    const fc = pathGeoJson(items, null)
    expect(fc.features).toHaveLength(2)
    expect(fc.features[0]?.properties).toEqual({ seq: 3, alt_t: 1 })
    expect(fc.features[1]?.properties).toEqual({ seq: 4, alt_t: 0.5 })
    expect(fc.features[0]?.geometry).toEqual({ type: 'LineString', coordinates: [[138.48029, 35.481883], [138.48129, 35.482883]] })
    const withHome = pathGeoJson(items, { lat: 35.479883, lon: 138.47829, alt: 0 })
    expect(withHome.features).toHaveLength(3)
    expect(withHome.features[0]?.properties.seq).toBe(1)
    expect(pathGeoJson([item(22, 36.1, 139.1, 30)], null).features).toEqual([])
    expect(midpoint({ lat: 36, lon: 139 }, { lat: 37, lon: 140 })).toEqual({ lat: 36.5, lon: 139.5 })
    expect(haversineM(35.481883, 138.48029, 35.481883, 138.49139)).toBeCloseTo(1000, -2)
  })

  it('remaining_distance_sums_vehicle_to_current_plus_rest', () => {
    const items = [item(22, 35.481883, 138.48029, 30), item(16, 35.481883, 138.49139, 60), item(16, 35.481883, 138.50249, 60), item(20, 0, 0, 0)]
    const vehicle = { lat: 35.481883, lon: 138.48584 }
    const r = remainingDistanceM(items, 2, vehicle)
    expect(r).not.toBeNull()
    expect(r!).toBeGreaterThan(1450)
    expect(r!).toBeLessThan(1550)
    expect(remainingDistanceM(items, 2, null)).toBeCloseTo(1000, -2)
    expect(remainingDistanceM(items, 0, vehicle)).toBeNull()
    expect(remainingDistanceM(items, 9, vehicle)).toBeNull()
    expect(remainingDistanceM(items, 4, vehicle)).toBe(0)
  })
})

describe('takeoff shown above home', () => {
  it('places takeoff items (with or without coordinates) at the home for drawing; others untouched', () => {
    const it0 = { command: 22, frame: 'rel' as const, params: [0, 0, 0, 0] as [number, number, number, number], lat: 0, lon: 0, alt: 50, autocontinue: true }
    const vt = { ...it0, command: 84, lat: 36.3, lon: 137.7 }
    const wp = { ...it0, command: 16, lat: 36.26, lon: 137.64 }
    const home = { lat: 36.2509, lon: 137.6385 }
    const out = placeTakeoffs([it0, vt, wp], home)
    expect(out.map((i) => [i.lat, i.lon])).toEqual([[36.2509, 137.6385], [36.2509, 137.6385], [36.26, 137.64]])
    expect(out[2]).toBe(wp)
    const none = [it0, wp]
    expect(placeTakeoffs(none, null)).toBe(none)
  })
})
