import { describe, expect, it } from 'vitest'
import type { MissionItem } from '../../shared/api/types'
import { dictionaries } from '../../shared/i18n'
import { findingText, localWarnings, stats } from './summary'

const item = (command: number, lat: number, lon: number, alt: number, p1 = 0): MissionItem => ({ command, frame: 'rel', params: [p1, 0, 0, 0], lat, lon, alt, autocontinue: true })

describe('summary', () => {
  it('stats_match_the_core_rule', () => {
    const items = [item(22, 35.481883, 138.48029, 30), item(16, 35.481883, 138.49139, 80, 10)]
    const s = stats(items, null, 8)
    expect(s.distance_m).toBeGreaterThan(990)
    expect(s.distance_m).toBeLessThan(1010)
    expect(s.duration_s).toBeGreaterThan(123)
    expect(s.duration_s).toBeLessThan(137)
    expect(s.max_alt).toBe(80)
    expect(stats([], null, 8)).toEqual({ distance_m: 0, duration_s: 0, max_alt: 0 })
    const withHome = stats(items, { lat: 35.481883, lon: 138.46929, alt: 0 }, 8)
    expect(withHome.distance_m).toBeGreaterThan(s.distance_m + 900)
  })

  it('warnings_cover_first_not_takeoff_and_mixed_frames', () => {
    expect(localWarnings([], 8).map((w) => w.code)).toEqual(['empty'])
    const bad = [item(16, 36.1, 139.1, 50), { ...item(16, 36.2, 139.2, 50), frame: 'abs' as const }]
    const codes = localWarnings(bad, 8).map((w) => w.code)
    expect(codes).toContain('first_not_takeoff')
    expect(codes).toContain('mixed_frames')
    expect(codes).toContain('no_land_or_rtl')
    // ~700 m leg: well under the 20-minute long-flight proxy
    const ok = [item(22, 36.1, 139.1, 30), item(16, 36.105, 139.105, 50), item(20, 0, 0, 0)]
    expect(localWarnings(ok, 8)).toEqual([])
    const far = [item(22, 36.1, 139.1, 30), item(16, 37.1, 139.1, 50), item(20, 0, 0, 0)]
    expect(localWarnings(far, 8).map((w) => w.code)).toEqual(['long_flight'])
  })
  it('a QuadPlane mission may start with VTOL_TAKEOFF and end with VTOL_LAND', () => {
    const codes = localWarnings([item(84, 0, 0, 40), item(16, 36.1, 139.1, 60), item(85, 0, 0, 0)], 8).map((w) => w.code)
    expect(codes).not.toContain('first_not_takeoff')
    expect(codes).not.toContain('no_land_or_rtl')
  })
  it('a rover mission with a TAKEOFF item is warned that rovers ignore it', () => {
    const codes = localWarnings([item(22, 0, 0, 30), item(16, 36.25, 137.63, 0)], 8, 'rover').map((w) => w.code)
    expect(codes).toContain('rover_takeoff')
    expect(localWarnings([item(22, 0, 0, 30), item(16, 36.25, 137.63, 0), item(20, 0, 0, 0)], 8, 'copter').map((w) => w.code)).not.toContain('rover_takeoff')
  })
  it('a rover mission needs no takeoff and may end on a waypoint', () => {
    const wps = [item(16, 36.25, 137.63, 0), item(16, 36.251, 137.631, 0)]
    const codes = localWarnings(wps, 2, 'rover').map((w) => w.code)
    expect(codes).not.toContain('first_not_takeoff')
    expect(codes).not.toContain('no_land_or_rtl')
    expect(localWarnings(wps, 2, 'copter').map((w) => w.code)).toContain('first_not_takeoff')
  })
})

describe('findingText', () => {
  it('translates the server param_ignored warning in both languages', () => {
    expect(findingText('param_ignored', dictionaries.ja)).toContain('ArduPilot')
    expect(findingText('param_ignored', dictionaries.en)).toContain('ArduPilot')
    expect(findingText('param_ignored', dictionaries.ja)).not.toBe(findingText('param_ignored', dictionaries.en))
  })
})
