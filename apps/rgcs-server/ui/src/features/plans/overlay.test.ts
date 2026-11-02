import { describe, expect, it } from 'vitest'
import type { FenceZone, RallyPoint } from '../../shared/api/types'
import type { Draft, DraftItem } from '../mission/model'
import { emptyDraft } from '../mission/model'
import { othersGeoJson, type OtherMission } from './overlay'

const LAT0 = 36.25
const LON0 = 137.64

function draftOf(name: string, n: number, fence: readonly FenceZone[] = [], rally: readonly RallyPoint[] = []): Draft {
  const items = Array.from(
    { length: n },
    (_, i) => ({ seq: i + 1, command: 16, frame: 'rel', lat: LAT0 + i * 0.001, lon: LON0, alt: 40, params: [0, 0, 0, 0], uid: i + 1 }) as unknown as DraftItem,
  )
  const base = emptyDraft()
  return { ...base, items, nextUid: n + 1, mission: { ...base.mission, name, fence: [...fence], rally: [...rally] } }
}

const circle = { kind: 'circle', inclusion: true, center: { lat: LAT0, lon: LON0 }, radius: 100 } as unknown as FenceZone
const poly = { kind: 'polygon', inclusion: false, vertices: [{ lat: LAT0, lon: LON0 }, { lat: LAT0 + 0.001, lon: LON0 }, { lat: LAT0, lon: LON0 + 0.001 }] } as unknown as FenceZone
const rallyAt = (lat: number) => ({ lat, lon: LON0, alt: 30 }) as unknown as RallyPoint

const other = (key: string, color: string, draft: Draft, predicted: OtherMission['predicted'] = null): OtherMission => ({ key, color, draft, predicted })

describe('othersGeoJson', () => {
  it('others_carry_their_colour_on_every_feature', () => {
    const g = othersGeoJson([
      other('a', '#5fd39b', draftOf('A', 3, [circle], [rallyAt(LAT0)]), [{ lat: LAT0, lon: LON0, alt: 40 }, { lat: LAT0 + 0.002, lon: LON0, alt: 40 }]),
      other('b', '#d8a8ff', draftOf('B', 2, [poly], [rallyAt(LAT0 + 0.01)])),
    ])
    const all = [...g.paths.features, ...g.fences.features, ...g.rally.features]
    expect(all.length).toBeGreaterThan(0)
    expect(g.paths.features.filter((f) => f.properties?.color === '#5fd39b')).toHaveLength(3)
    expect(g.paths.features.filter((f) => f.properties?.color === '#d8a8ff')).toHaveLength(1)
    expect(g.paths.features.filter((f) => f.properties?.predicted === 1)).toHaveLength(1)
    for (const f of all) expect(['#5fd39b', '#d8a8ff']).toContain(f.properties?.color)
  })

  it('fences_and_rally_of_every_mission_are_included', () => {
    const g = othersGeoJson([
      other('a', '#5fd39b', draftOf('A', 0, [circle], [rallyAt(LAT0), rallyAt(LAT0 + 0.001)])),
      other('b', '#d8a8ff', draftOf('B', 0, [poly, circle], [rallyAt(LAT0 + 0.01)])),
    ])
    expect(g.fences.features).toHaveLength(3)
    expect(g.fences.features.map((f) => f.properties?.inc)).toEqual([1, 0, 1])
    expect(g.rally.features).toHaveLength(3)
    expect(g.rally.features.map((f) => f.geometry.type)).toEqual(['Point', 'Point', 'Point'])
  })

  it('the_active_mission_is_not_in_others', () => {
    // the caller leaves the active row out: the builder draws exactly what it is given
    expect(othersGeoJson([])).toEqual({
      paths: { type: 'FeatureCollection', features: [] },
      fences: { type: 'FeatureCollection', features: [] },
      rally: { type: 'FeatureCollection', features: [] },
    })
    const g = othersGeoJson([other('b', '#d8a8ff', draftOf('B', 2, [], [rallyAt(LAT0)]))])
    expect(new Set([...g.paths.features, ...g.rally.features].map((f) => f.properties?.key))).toEqual(new Set(['b']))
  })
})
