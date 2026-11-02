import { describe, expect, it } from 'vitest'
import type { VehicleState } from '../../shared/api/types'
import { toMercator } from './air'
import { vehicleAirData, vehicleModels } from './vehicleAir'
import type { Mission } from '../../shared/api/types'

const v = (sysid: number, alt_rel: number, lon = 138.47829, lat = 35.479883) => ({ sysid, lat, lon, alt_rel, gps: { fix: 3 }, link: 'ok', armed: true, mode: 'LOITER', ground_speed: 0, climb: 0 }) as unknown as VehicleState

describe('vehicleModels', () => {
  it('gives each airframe its own model: a VTOL plane is a QuadPlane, unknown kinds fly as copters', () => {
    const at = (sysid: number, kind: string, vtol?: boolean) => ({ ...v(sysid, 0), kind, ...(vtol === undefined ? {} : { vtol }) }) as unknown as VehicleState
    const all = new Map([[1, at(1, 'copter')], [2, at(2, 'plane', true)], [3, at(3, 'plane')], [4, at(4, 'rover')], [5, at(5, 'other')]])
    expect(vehicleModels(all, null, new Map()).map((m) => m.model)).toEqual(['copter', 'quadplane', 'plane', 'rover', 'copter'])
  })
})

describe('vehicleAirData', () => {
  const homes = new Map([[1, { lat: 35.479883, lon: 138.47829 }]])
  it('gives a flying vehicle a post from the ground to its altitude, amber when selected', () => {
    const d = vehicleAirData(new Map([[1, v(1, 30)]]), 1, homes, new Map(), () => 100)
    expect(d.posts).toHaveLength(1)
    expect(d.posts[0]![1]!.z).toBeGreaterThan(d.posts[0]![0]!.z)
    expect(d.posts[0]![0]!.c).toEqual([0xf2 / 255, 0xb5 / 255, 0x44 / 255])
    expect(d.discs.features).toHaveLength(1)
    expect(d.alts.get(1)).toBe(130)
  })
  it('a landed (disarmed) vehicle stands on the ground with no post', () => {
    const d = vehicleAirData(new Map([[1, { ...v(1, 0.4), armed: false } as VehicleState]]), null, homes, new Map(), () => 100)
    expect(d.posts).toHaveLength(0)
    expect(d.alts.get(1)).toBe(100)
  })
  it('falls back to the first track point for home, and to the ground while the DEM is missing', () => {
    const tracks = new Map([[2, [[138.46829, 35.469883, 0, 0]] as const]])
    expect(vehicleAirData(new Map([[2, v(2, 20)]]), null, new Map(), tracks, () => 50).alts.get(2)).toBe(70)
    const none = vehicleAirData(new Map([[2, v(2, 20)]]), null, new Map(), tracks, () => null)
    expect(none.alts.get(2)).toBeNull()
    expect(none.posts).toHaveLength(0)
  })

  it('draws each track in the air at home ground + its recorded altitude, in Mission Planner purple', () => {
    const tracks = new Map([[1, [[138.47829, 35.479883, 0, 0], [138.47929, 35.479883, 40, 1000]] as const]])
    const d = vehicleAirData(new Map([[1, v(1, 40)]]), 1, homes, tracks, () => 100)
    expect(d.lines).toHaveLength(1)
    const [a, b] = d.lines[0]!
    expect(a!.z).toBeCloseTo(toMercator(138.47829, 35.479883, 100).z, 12)
    expect(b!.z).toBeCloseTo(toMercator(138.47929, 35.479883, 140).z, 12)
    expect(a!.c).toEqual([0x80 / 255, 0, 0x80 / 255])
  })
  it('adds the mission like the planner: climb-coloured legs, posts and the altitude of each positioned item', () => {
    const item = (command: number, lat: number, alt: number) => ({ command, frame: 'rel' as const, params: [0, 0, 0, 0] as [number, number, number, number], lat, lon: 138.47829, alt, autocontinue: true })
    const mission = { id: null, name: 'm', sysid: 1, default_alt: 50, default_frame: 'rel', speed: 8, home: null, items: [item(22, 35.479883, 50), item(16, 35.480883, 50), item(178, 0, 0)] } as unknown as Mission
    const d = vehicleAirData(new Map(), null, homes, new Map(), () => 100, mission)
    expect(d.lines).toHaveLength(1) // one leg T → 2, level → cyan
    expect(d.lines[0]![0]!.c).toEqual([0x9c / 255, 0xc9 / 255, 1])
    expect(d.posts).toHaveLength(2)
    expect(d.missionAlts).toEqual([150, 150])
  })

  it('starts the velocity vector at the vehicle in the air and climbs with it (10 s ahead)', () => {
    const flying = { ...v(1, 30), armed: true, mode: 'LOITER', link: 'ok', gps: { fix: 3 }, cog: 90, ground_speed: 5, climb: 2 } as unknown as VehicleState
    const d = vehicleAirData(new Map([[1, flying]]), 1, homes, new Map(), () => 100)
    expect(d.lines).toHaveLength(1)
    const [a, b] = d.lines[0]!
    expect(a!.z).toBeCloseTo(toMercator(138.47829, 35.479883, 130).z, 12)
    expect(b!.z).toBeCloseTo(toMercator(138.47829, 35.479883, 150).z, 12) // +2 m/s for 10 s
    expect(b!.x).toBeGreaterThan(a!.x) // east
    expect(a!.c).toEqual([1, 1, 1]) // white for the selected vehicle, like 2D
  })
  it('draws the line to the navigation target at flight altitude with a post down to the ground', () => {
    const nav = { ...v(1, 30), armed: true, mode: 'AUTO', link: 'ok', gps: { fix: 3 }, ground_speed: 0, climb: 0, nav: { target_bearing: 0, wp_dist: 100 } } as unknown as VehicleState
    const d = vehicleAirData(new Map([[1, nav]]), null, homes, new Map(), () => 100)
    expect(d.lines).toHaveLength(1)
    const [a, b] = d.lines[0]!
    expect(b!.z).toBeCloseTo(a!.z, 9) // same altitude (z scales a little with latitude)
    expect(b!.y).toBeLessThan(a!.y) // north
    expect(d.posts).toHaveLength(2) // the vehicle and the target
  })
})
