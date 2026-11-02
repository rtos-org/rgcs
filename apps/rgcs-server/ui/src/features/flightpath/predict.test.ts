import { describe, expect, it } from 'vitest'
import type { Home, MissionItem } from '../../shared/api/types'
import { COPTER_PARAM_NAMES } from './copterParams'
import { PLANE_DEFAULTS, PLANE_PARAM_NAMES } from './params'
import { pathModel, pathParamNames, predictFor } from './predict'

const takeoff: MissionItem = { command: 22, frame: 'rel', params: [0, 0, 0, 0], lat: 0, lon: 0, alt: 40, autocontinue: true }
const plan = (home: Home | null) => ({ items: [takeoff], mission: { home } })
const qp = { kind: 'plane' as const, params: { ...PLANE_DEFAULTS, quadplane: true } }

describe('predictFor', () => {
  it('starts from the plan home, else from the vehicle home, else predicts nothing', () => {
    const planHome = { lat: 36.25, lon: 137.6, alt: 1500 }
    expect(predictFor(plan(planHome), qp, null)!.home).toEqual({ lat: 36.25, lon: 137.6 })
    const fromVehicle = predictFor(plan(null), qp, { lat: 36.3, lon: 137.7, alt: 1490 })!
    expect(fromVehicle.home).toEqual({ lat: 36.3, lon: 137.7 })
    expect(fromVehicle.points.at(-1)!.alt).toBe(40)
    expect(predictFor(plan(null), qp, null)).toBeNull()
  })

  it('a copter climbs straight up on its takeoff too', () => {
    const copter = pathModel('copter', new Map())!
    const path = predictFor(plan({ lat: 36.25, lon: 137.6, alt: 1500 }), copter, null)!
    expect(path.points.map((p) => p.alt)).toEqual([0, 40])
  })
})

describe('predictFor missionEnd', () => {
  it('marks where the mission part ends: before the plane RTL tail, the whole copter path', () => {
    const home = { lat: 36.25, lon: 137.6, alt: 1500 }
    const wp: MissionItem = { ...takeoff, command: 16, lat: 36.26, lon: 137.6, alt: 40 }
    const plane = predictFor({ items: [takeoff, wp], mission: { home } }, { kind: 'plane', params: PLANE_DEFAULTS }, null)!
    expect(plane.missionEnd).toBeGreaterThan(1)
    expect(plane.missionEnd).toBeLessThan(plane.points.length)
    const copter = predictFor({ items: [takeoff, wp], mission: { home } }, pathModel('copter', new Map())!, null)!
    expect(copter.missionEnd).toBe(copter.points.length)
  })
})

describe('pathModel', () => {
  it('planes and copters have a model (each asks for its own parameters); rovers and unknown vehicles none', () => {
    expect(pathModel('plane', new Map([['AIRSPEED_CRUISE', 20]]))).toMatchObject({ kind: 'plane', params: { airspeed: 20 } })
    expect(pathModel('copter', new Map([['WP_SPD', 6]]))).toMatchObject({ kind: 'copter', params: { speed: 6 } })
    expect(pathModel('rover', new Map())).toBeNull()
    expect(pathModel(null, new Map())).toBeNull()
    expect(pathParamNames('plane')).toBe(PLANE_PARAM_NAMES)
    expect(pathParamNames('copter')).toBe(COPTER_PARAM_NAMES)
    expect(pathParamNames('rover')).toEqual([])
  })
})
