import { describe, expect, it } from 'vitest'
import type { MissionItem } from '../../shared/api/types'
import { arcLengthM, toLocal } from './arc'
import { CMDS } from './cmds'
import { elevProfile } from './elevProfile'
import { hasPosition, pathGeoJson, remainingDistanceM } from './geo'
import { midHandles } from './mapEdit'
import { missionAirData } from './missionAir'
import { stats } from './summary'

const east = (m: number) => m / (111_320 * Math.cos((36.25 * Math.PI) / 180))
const it_ = (command: number, lonM: number, p1 = 0): MissionItem => ({ command, frame: 'rel', params: [p1, 0, 0, 0], lat: 36.25, lon: 137.6 + east(lonM), alt: 50, autocontinue: true })
const items = [it_(22, 0), it_(36, 100, 90)]
const draft = { mission: { id: null, name: 'm', sysid: null, default_alt: 50, default_frame: 'rel' as const, speed: 8, home: null, fence: [], rally: [] }, items: items.map((x, i) => ({ ...x, uid: i + 1 })), surveys: [], nextUid: 3 }
const ARC = arcLengthM({ lat: 36.25, lon: 137.6 }, { lat: 36.25, lon: 137.6 + east(100) }, 90)

describe('ARC_WAYPOINT across the planner', () => {
  it('is a positioned NAV command with its arc angle as param1 (copter)', () => {
    expect(CMDS.ARC_WAYPOINT).toMatchObject({ id: 36, mav: 'MAV_CMD_NAV_ARC_WAYPOINT', pos: true, alt: true })
    expect(CMDS.ARC_WAYPOINT!.fields[0]).toMatchObject({ p: 1, key: 'arcAngle', min: -359, max: 359 })
    expect(hasPosition(items[1]!)).toBe(true)
  })
  it('the 2D path bends along the arc (to the left of travel for a clockwise angle)', () => {
    const leg = pathGeoJson(items, null).features[0]!.geometry.coordinates
    expect(leg.length).toBeGreaterThan(8)
    const mid = toLocal({ lat: 36.25, lon: 137.6 }, { lon: leg[Math.floor(leg.length / 2)]![0]!, lat: leg[Math.floor(leg.length / 2)]![1]! })
    expect(mid.y).toBeGreaterThan(15) // north of an eastward chord
  })
  it('distances count the arc length', () => {
    expect(stats(items, null, 10).distance_m).toBeCloseTo(ARC, 0)
    expect(remainingDistanceM(items, 2, { lat: 36.25, lon: 137.6 })).toBeCloseTo(ARC, 0)
  })
  it('the + handle sits on the arc', () => {
    const h = midHandles(draft)[0]!
    expect(toLocal({ lat: 36.25, lon: 137.6 }, h).y).toBeGreaterThan(15)
  })
  it('the 3D line and the elevation profile follow the arc', () => {
    const air = missionAirData(draft, new Set(), () => 100)
    expect(air.lines[0]!.length).toBeGreaterThan(8)
    expect(elevProfile(draft, () => 100)!.total).toBeCloseTo(ARC, 0)
  })
})

describe('degenerate arcs (review 2026-10-19)', () => {
  const at = (command: number, lonM: number, p1: number) => ({ ...it_(command, lonM, p1), uid: 0 })
  const plan = (list: MissionItem[]) => ({ ...draft, items: list.map((x, i) => ({ ...x, uid: i + 1 })) })
  it('a pasted arc on top of its original (zero chord) or a sub-degree arc draws straight, without throwing', () => {
    for (const d of [plan([it_(22, 0), at(36, 100, 90), at(36, 100, 90)]), plan([it_(22, 0), at(36, 2000, 0.5)])]) {
      expect(() => missionAirData(d, new Set(), () => 100)).not.toThrow()
      expect(() => elevProfile(d, () => 100)).not.toThrow()
    }
  })
})
