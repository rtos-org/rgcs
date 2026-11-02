import { describe, expect, it } from 'vitest'
import type { VehicleState } from '../../shared/api/types'
import { FOLLOW_DEADBAND_PX, arrivalTarget, firstView, follow3dCamera, followTarget, needsRecenter, padding } from './follow'

describe('map padding', () => {
  it('matches the panel widths', () => {
    expect(padding('full', true)).toEqual({ top: 72, left: 320, right: 396, bottom: 60 })
    expect(padding('full', false)).toEqual({ top: 72, left: 320, right: 0, bottom: 60 })
    expect(padding('rail', true)).toEqual({ top: 72, left: 84, right: 396, bottom: 60 })
    expect(padding('none', false)).toEqual({ top: 72, left: 0, right: 0, bottom: 60 })
  })
})

describe('followTarget', () => {
  const v = (sysid: number, fix: number): VehicleState => ({
    sysid, name: 'x', kind: 'copter', mode: '', armed: false, lat: 36, lon: 139, alt_rel: 0, alt_msl: 0, hdg: null,
    ground_speed: 0, climb: 0, battery: { pct: null, volt: 0, current: null }, link: 'ok', last_rx_ms: 0,
    gps: { fix, sats: 0, hdop: null }, warn: false, unread: 0,
  })
  it('returns the followed vehicle position only when it has one', () => {
    const vehicles = new Map([[1, v(1, 3)], [2, v(2, 0)]])
    expect(followTarget(vehicles, 1)).toEqual([139, 36])
    expect(followTarget(vehicles, 2)).toBeNull()
    expect(followTarget(vehicles, 9)).toBeNull()
    expect(followTarget(vehicles, null)).toBeNull()
  })
})

describe('arrivalTarget (entering the operations view)', () => {
  const at = (sysid: number, lat: number, lon: number, link: VehicleState['link'] = 'ok'): VehicleState => ({
    sysid, name: 'x', kind: 'plane', mode: '', armed: false, lat, lon, alt_rel: 0, alt_msl: 0, hdg: null,
    ground_speed: 0, climb: 0, battery: { pct: null, volt: 0, current: null }, link, last_rx_ms: 0,
    gps: { fix: 3, sats: 10, hdop: null }, warn: false, unread: 0,
  })
  const centre: [number, number] = [139, 36]
  it('one connected vehicle: that vehicle', () => {
    expect(arrivalTarget(new Map([[1, at(1, 35, 138)]]), null, centre)).toBe(1)
  })
  it('several: the selected one when it is connected, else the one nearest the map centre', () => {
    const vs = new Map([[1, at(1, 30, 130)], [2, at(2, 36.01, 139.01)], [3, at(3, 36.5, 139.5)]])
    expect(arrivalTarget(vs, 3, centre)).toBe(3)
    expect(arrivalTarget(vs, null, centre)).toBe(2)
    expect(arrivalTarget(vs, 9, centre)).toBe(2)
  })
  it('skips lost links and vehicles without a position; none left gives null', () => {
    const vs = new Map([[1, at(1, 36, 139, 'lost')], [2, at(2, 0, 0)], [3, at(3, 37, 140)]])
    expect(arrivalTarget(vs, 1, centre)).toBe(3)
    expect(arrivalTarget(new Map([[1, at(1, 36, 139, 'lost')]]), null, centre)).toBeNull()
  })
})

describe('needsRecenter', () => {
  it('ignores GPS jitter of a hovering vehicle (a few pixels) and follows real movement', () => {
    expect(needsRecenter({ x: 500, y: 400 }, { x: 501, y: 401 })).toBe(false)
    expect(needsRecenter({ x: 500, y: 400 }, { x: 500 + FOLLOW_DEADBAND_PX + 1, y: 400 })).toBe(true)
    expect(needsRecenter({ x: 500, y: 400 }, { x: 500, y: 380 })).toBe(true)
  })
})

describe('follow3dCamera (3D: from behind and above, the vehicle in the air at the centre)', () => {
  const veh = (over: Partial<VehicleState> = {}) => ({ sysid: 1, lat: 36.25, lon: 137.64, hdg: 90, cog: 80, gps: { fix: 3 }, ...over }) as unknown as VehicleState
  const cam = { lng: 137.64, lat: 36.25, bearing: 90, elevation: 1600 }
  it('centres on the vehicle at its altitude, looking along its heading', () => {
    expect(follow3dCamera(veh(), 1650, null)).toEqual({ center: [137.64, 36.25], bearing: 90, elevation: 1650 })
  })
  it('falls back to the course when there is no heading', () => {
    expect(follow3dCamera(veh({ hdg: null }), 1650, null)?.bearing).toBe(80)
  })
  it('ignores GPS / yaw / altitude noise inside the dead bands, and moves past them', () => {
    expect(follow3dCamera(veh({ lon: 137.640001, hdg: 91 }), 1600.5, cam)).toBeNull()
    expect(follow3dCamera(veh({ lon: 137.6402 }), 1600, cam)?.center).toEqual([137.6402, 36.25])
    expect(follow3dCamera(veh({ hdg: 100 }), 1600, cam)?.bearing).toBe(100)
    expect(follow3dCamera(veh(), 1605, cam)?.elevation).toBe(1605)
  })
  it('treats 359° and 1° as 2° apart', () => {
    expect(follow3dCamera(veh({ hdg: 1 }), 1600, { ...cam, bearing: -1 })).toBeNull()
  })
})

describe('firstView', () => {
  const at = (sysid: number, lat: number, lon: number, fix = 3): VehicleState => ({
    sysid, name: 'x', kind: 'copter', mode: '', armed: false, lat, lon, alt_rel: 0, alt_msl: 0, hdg: null,
    ground_speed: 0, climb: 0, battery: { pct: null, volt: 0, current: null }, link: 'ok', last_rx_ms: 0,
    gps: { fix, sats: 0, hdop: null }, warn: false, unread: 0,
  })
  const map = (...vs: VehicleState[]) => new Map(vs.map((x) => [x.sysid, x]))
  it('is nothing until a vehicle has a position', () => {
    expect(firstView(map())).toBeNull()
    expect(firstView(map(at(1, 0, 0, 0)))).toBeNull()
  })
  it('centres on a single vehicle and frames several (vehicles without a fix are left out)', () => {
    expect(firstView(map(at(1, 36.25, 137.63)))).toEqual({ center: [137.63, 36.25] })
    expect(firstView(map(at(1, 36.25, 137.63), at(2, 36.2, 137.7), at(3, 0, 0, 0)))).toEqual({ bounds: [[137.63, 36.2], [137.7, 36.25]] })
  })
  it('several vehicles at one spot centre like one', () => {
    expect(firstView(map(at(1, 36.25, 137.63), at(2, 36.25, 137.63)))).toEqual({ center: [137.63, 36.25] })
  })
})
