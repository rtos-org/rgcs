import { describe, expect, it } from 'vitest'
import { emptyDraft } from './model'
import { rallyDefaultAlt, addRally, addZone, appendVertex, circleRing, fenceFindings, moveCircle, moveRally, moveVertex, removeRally, removeVertex, removeZone, setRadius, setRallyAlt } from './geofenceModel'

const ll = (lat: number, lon: number) => ({ lat, lon })

describe('fence editing', () => {
  it('adds a polygon zone and grows it vertex by vertex, immutably', () => {
    const d0 = emptyDraft()
    const d1 = addZone(d0, { kind: 'polygon', inclusion: true, vertices: [ll(36, 137)] })
    expect(d0.mission.fence).toEqual([])
    const d2 = appendVertex(appendVertex(d1, 0, ll(36, 137.01)), 0, ll(36.01, 137.01))
    expect(d2.mission.fence[0]).toEqual({ kind: 'polygon', inclusion: true, vertices: [ll(36, 137), ll(36, 137.01), ll(36.01, 137.01)] })
    expect(moveVertex(d2, 0, 1, ll(36, 137.02)).mission.fence[0]).toMatchObject({ vertices: [ll(36, 137), ll(36, 137.02), ll(36.01, 137.01)] })
    expect(removeVertex(d2, 0, 0).mission.fence[0]).toMatchObject({ vertices: [ll(36, 137.01), ll(36.01, 137.01)] })
    expect(removeZone(d2, 0).mission.fence).toEqual([])
  })
  it('moves and resizes a circle (radius at least 1 m)', () => {
    const d = addZone(emptyDraft(), { kind: 'circle', inclusion: false, center: ll(36, 137), radius: 100 })
    expect(moveCircle(d, 0, ll(36.1, 137.1)).mission.fence[0]).toMatchObject({ center: ll(36.1, 137.1), radius: 100 })
    expect(setRadius(d, 0, 250).mission.fence[0]).toMatchObject({ radius: 250 })
    expect(setRadius(d, 0, -5).mission.fence[0]).toMatchObject({ radius: 1 })
    // vertex edits do nothing to a circle
    expect(appendVertex(d, 0, ll(1, 1))).toBe(d)
  })
  it('lists the problems ArduPilot would refuse, per zone', () => {
    const d = addZone(addZone(emptyDraft(), { kind: 'polygon', inclusion: true, vertices: [ll(36, 137), ll(36, 137.01)] }), { kind: 'circle', inclusion: true, center: ll(36, 137), radius: 50 })
    expect(fenceFindings(d.mission.fence)).toEqual([{ zone: 0, code: 'fence_vertices' }])
  })
  it('draws a circle as a closed ring of points', () => {
    const ring = circleRing(ll(36, 137), 100, 32)
    expect(ring).toHaveLength(33)
    expect(ring[0]).toEqual(ring[32])
    const north = (ring[0]!.lat - 36) * 110_540
    expect(north).toBeCloseTo(100, 0)
  })
})

describe('rally editing', () => {
  it('adds, moves, re-heights and removes rally points', () => {
    const d1 = addRally(emptyDraft(), ll(36.25, 137.63), 60)
    expect(d1.mission.rally).toEqual([{ lat: 36.25, lon: 137.63, alt: 60 }])
    const d2 = moveRally(d1, 0, ll(36.26, 137.64))
    expect(d2.mission.rally[0]).toEqual({ lat: 36.26, lon: 137.64, alt: 60 })
    expect(setRallyAlt(d2, 0, 75.6).mission.rally[0]!.alt).toBe(76) // whole metres, like ArduPilot
    expect(removeRally(d2, 0).mission.rally).toEqual([])
  })
})

describe('rallyDefaultAlt', () => {
  it('uses the mission default only when it is relative to home (rally altitudes are)', () => {
    const m = emptyDraft().mission
    expect(rallyDefaultAlt({ ...m, default_alt: 80, default_frame: 'rel' })).toBe(80)
    expect(rallyDefaultAlt({ ...m, default_alt: 720, default_frame: 'abs' })).toBe(50)
    expect(rallyDefaultAlt({ ...m, default_alt: 30, default_frame: 'ter' })).toBe(50)
  })
})
