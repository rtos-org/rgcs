import { describe, expect, it } from 'vitest'
import { toLocal } from '../mission/arc'
import { emptyDraft } from '../mission/model'
import { generateSurvey, surveyNumbers } from './generate'
import { centroid, handleAngle, handlePoint, HANDLE_REACH, surveyGeoJson } from './surveyGeo'
import { at, fixtureSpec, HOME, RECT, surveyDraft } from './surveyFixture'

type Kind = 'area' | 'shoot' | 'link' | 'photo' | 'foot' | 'handle'

function fixture(o: Parameters<typeof fixtureSpec>[0] = {}) {
  const { draft, id } = surveyDraft(o)
  const gen = generateSurvey(draft.surveys[0]!.spec, HOME)
  if ('error' in gen) throw new Error(gen.error)
  const fc = surveyGeoJson(draft, (sid) => (sid === id ? gen : null))
  const of = (k: Kind) => fc.features.filter((f) => f.properties.kind === k)
  return { draft, id, gen, fc, of }
}
const metres = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => Math.hypot(toLocal(a, b).x, toLocal(a, b).y)

describe('surveyGeoJson', () => {
  it('builds one area, a shoot line per lane, the links, a photo and a footprint per photo, one handle (rectangle)', () => {
    const { gen, of, fc, id } = fixture()
    const lanes = gen.geometry.lanes.length
    expect(lanes).toBe(14)
    expect(of('area')).toHaveLength(1)
    expect(of('shoot')).toHaveLength(lanes)
    // plane: the first lead-in, a turn between each pair of lanes, the last overshoot
    expect(of('link')).toHaveLength(lanes + 1)
    expect(of('handle')).toHaveLength(1)
    expect(of('foot')).toHaveLength(of('photo').length)
    expect(fc.features.every((f) => f.properties.id === id)).toBe(true)
  })

  it('photo count equals the photos number', () => {
    const { gen, of, draft } = fixture()
    const n = surveyNumbers(draft.surveys[0]!.spec, gen.geometry, gen.items)
    expect(of('photo')).toHaveLength(n.photos)
  })

  it('shoot lines run a → b of each lane; footprints are closed rings of the footprint size', () => {
    const { gen, of } = fixture()
    const lane = gen.geometry.lanes[0]!
    const first = of('shoot')[0]!.geometry as { coordinates: number[][] }
    expect(first.coordinates).toEqual([
      [lane.a.lon, lane.a.lat],
      [lane.b.lon, lane.b.lat],
    ])
    const ring = (of('foot')[0]!.geometry as { coordinates: number[][][] }).coordinates[0]!
    expect(ring).toHaveLength(5)
    expect(ring[4]).toEqual(ring[0])
    const p = (c: number[]) => ({ lon: c[0]!, lat: c[1]! })
    const sides = [metres(p(ring[0]!), p(ring[1]!)), metres(p(ring[1]!), p(ring[2]!))].sort((a, b) => a - b)
    const fp = [gen.geometry.footprint.alongM, gen.geometry.footprint.acrossM].sort((a, b) => a - b)
    expect(sides[0]).toBeCloseTo(fp[0]!, 1)
    expect(sides[1]).toBeCloseTo(fp[1]!, 1)
  })

  it('links start at the first lead-in WP and are dashed between the shooting sections', () => {
    const { gen, of } = fixture()
    const first = gen.items.find((it) => it.command === 16)!
    const link = of('link')[0]!.geometry as { coordinates: number[][] }
    expect(link.coordinates[0]).toEqual([first.lon, first.lat])
  })

  it('copter: links only between lanes', () => {
    const { gen, of } = fixture({ airframe: 'copter', speedMs: 8 })
    expect(of('link')).toHaveLength(gen.geometry.lanes.length - 1)
  })

  it('the handle sits on the polygon centroid offset along the angle', () => {
    const { of } = fixture()
    const h = of('handle')[0]!.geometry as { coordinates: number[] }
    const c = centroid(RECT)
    const v = toLocal(c, { lon: h.coordinates[0]!, lat: h.coordinates[1]! })
    // angle 90: due east, half the 400 m extent times the reach
    expect(v.x).toBeCloseTo(200 * HANDLE_REACH, 0)
    expect(v.y).toBeCloseTo(0, 0)
    expect(metres(c, at(200, 150))).toBeLessThan(0.5)
  })

  it('handlePoint and handleAngle invert each other, rounded to 1°', () => {
    const p = handlePoint(RECT, 33.4)!
    expect(handleAngle(RECT, p)).toBe(33)
    expect(handleAngle(RECT, handlePoint(RECT, 300)!)).toBe(300)
  })

  it('a survey whose spec yields no geometry shows only its area and handle', () => {
    const { draft } = surveyDraft()
    const fc = surveyGeoJson(draft, () => null)
    expect(fc.features.map((f) => f.properties.kind).sort()).toEqual(['area', 'handle'])
  })

  it('a draft without surveys gives an empty collection', () => {
    expect(surveyGeoJson(emptyDraft(), () => null)).toEqual({ type: 'FeatureCollection', features: [] })
  })
})
