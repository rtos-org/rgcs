import { describe, expect, it } from 'vitest'
import type { MissionItem, VehicleState } from '../../shared/api/types'
import { climbColor, itemAmsl, mercatorLine, vehicleAmsl, type ElevAt } from './air'

const flat = (h: number): ElevAt => () => h
const none: ElevAt = () => null
const v = (over: Partial<VehicleState> = {}) => ({ sysid: 1, kind: 'copter', armed: true, lat: 35.479883, lon: 138.47829, alt_rel: 30, alt_msl: 430 }) as unknown as VehicleState & typeof over
const item = (frame: MissionItem['frame'], alt: number): MissionItem => ({ command: 16, frame, params: [0, 0, 0, 0], lat: 35.489883, lon: 138.48829, alt, autocontinue: true })
const HOME = { lat: 35.479883, lon: 138.47829 }

describe('vehicleAmsl', () => {
  it('is the ground at home plus the relative altitude (not alt_msl)', () => {
    expect(vehicleAmsl(v(), HOME, flat(100))).toEqual({ ground: 100, amsl: 130 })
  })
  it('uses the ground under the vehicle for its post', () => {
    const elev: ElevAt = (lon) => (lon === HOME.lon ? 100 : 120)
    expect(vehicleAmsl({ ...v(), lon: 139.4 } as VehicleState, HOME, elev)).toEqual({ ground: 120, amsl: 130 })
  })
  it('falls back to the home ground when the tile under the vehicle is missing', () => {
    const elev: ElevAt = (lon) => (lon === HOME.lon ? 100 : null)
    expect(vehicleAmsl({ ...v(), lon: 139.4 } as VehicleState, HOME, elev)).toEqual({ ground: 100, amsl: 130 })
  })
  it('is null without a home, without ground at home, or without a position', () => {
    expect(vehicleAmsl(v(), null, flat(100))).toBeNull()
    expect(vehicleAmsl(v(), HOME, none)).toBeNull()
    expect(vehicleAmsl({ ...v(), lat: 0, lon: 0 } as VehicleState, HOME, flat(100))).toBeNull()
  })
  it('never draws a flying vehicle below the ground under it', () => {
    // SITL's world is flat at home: 350 m away the DEM is 40 m higher than the home ground
    const elev: ElevAt = (lon) => (lon === HOME.lon ? 100 : 140)
    const flying = { ...v(), lon: 139.4, armed: true, kind: 'copter' } as VehicleState
    expect(vehicleAmsl(flying, HOME, elev)).toEqual({ ground: 140, amsl: 140 })
  })
  it('puts a rover and a disarmed vehicle on the ground under it', () => {
    const elev: ElevAt = (lon) => (lon === HOME.lon ? 100 : 140)
    const rover = { ...v(), lon: 139.4, alt_rel: 0, armed: true, kind: 'rover' } as VehicleState
    expect(vehicleAmsl(rover, HOME, elev)).toEqual({ ground: 140, amsl: 140 })
    const low = (lon: number) => (lon === HOME.lon ? 100 : 80)
    const landed = { ...v(), lon: 139.4, alt_rel: 0.4, armed: false, kind: 'copter' } as VehicleState
    expect(vehicleAmsl(landed, HOME, low)).toEqual({ ground: 80, amsl: 80 })
  })
  it('never returns NaN', () => {
    expect(vehicleAmsl({ ...v(), alt_rel: Number.NaN } as VehicleState, HOME, flat(100))).toBeNull()
  })
})

describe('itemAmsl', () => {
  it('Rel adds the home ground, Abs is absolute, Ter adds the ground under the item', () => {
    const elev: ElevAt = (lon) => (lon === HOME.lon ? 100 : 150)
    expect(itemAmsl(item('rel', 80), HOME, elev)).toBe(180)
    expect(itemAmsl(item('abs', 480), HOME, elev)).toBe(480)
    expect(itemAmsl(item('ter', 40), HOME, elev)).toBe(190)
  })
  it('is null when the ground it needs is unknown', () => {
    expect(itemAmsl(item('rel', 80), null, flat(100))).toBeNull()
    expect(itemAmsl(item('ter', 40), HOME, none)).toBeNull()
    expect(itemAmsl(item('abs', 480), null, none)).toBe(480)
  })
})

describe('climbColor', () => {
  const CYAN = [0x9c / 255, 0xc9 / 255, 1]
  const RED = [0xff / 255, 0x69 / 255, 0x61 / 255]
  const AMBER = [0xf2 / 255, 0xb5 / 255, 0x44 / 255]
  const VIOLET = [0xd8 / 255, 0xa8 / 255, 1]
  it('is cyan when level and red from a 45° climb', () => {
    expect(climbColor(0, 100)).toEqual(CYAN)
    expect(climbColor(100, 100)).toEqual(RED)
    expect(climbColor(300, 100)).toEqual(RED)
  })
  it('passes through mint (not grey) on a gentle climb', () => {
    const c = climbColor(Math.tan(Math.PI / 16) * 100, 100)
    c.forEach((x, i) => expect(x).toBeCloseTo([0x8f / 255, 0xe3 / 255, 0xa6 / 255][i]!, 9))
  })
  it('passes amber half way and turns red for a vertical climb', () => {
    climbColor(Math.tan(Math.PI / 8) * 100, 100).forEach((c, i) => expect(c).toBeCloseTo(AMBER[i]!, 9))
    expect(climbColor(10, 0)).toEqual(RED)
  })
  it('turns violet for a steep descent', () => {
    expect(climbColor(-100, 100)).toEqual(VIOLET)
    expect(climbColor(-10, 0)).toEqual(VIOLET)
  })
  it('is cyan for a point (no length)', () => {
    expect(climbColor(0, 0)).toEqual(CYAN)
  })
})

describe('mercatorLine', () => {
  it('converts to mercator units with the altitude in z', () => {
    const [a, b] = mercatorLine([
      { lon: 0, lat: 0, amsl: 0, color: [1, 0, 0] },
      { lon: 0, lat: 0, amsl: 1000, color: [0, 1, 0] },
    ])
    expect(a!.x).toBeCloseTo(0.5)
    expect(a!.y).toBeCloseTo(0.5)
    expect(a!.z).toBe(0)
    expect(b!.z).toBeGreaterThan(0)
    expect(b!.c).toEqual([0, 1, 0])
  })
})
