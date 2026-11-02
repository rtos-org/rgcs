// The other open plans on the planner map (spec 2026-10-20): route, predicted path, fence
// and rally of every open mission but the one being edited, each in its row colour. No crossing
// labels (§9): overlaps are read from the colours in 2D and from the 3D view.
import type { Feature, FeatureCollection, Geometry, Point } from 'geojson'
import type { PathPoint } from '../flightpath/planePath'
import { fenceGeoJson } from '../mission/fenceMap'
import { pathGeoJson, placeTakeoffs } from '../mission/geo'
import type { Draft } from '../mission/model'

export interface OtherMission {
  readonly key: string
  readonly color: string
  readonly draft: Draft
  /** The flight its vehicle is expected to fly; null = not predicted (only the plan is drawn). */
  readonly predicted: PathPoint[] | null
}

export interface OthersGeoJson {
  readonly paths: FeatureCollection
  readonly fences: FeatureCollection
  readonly rally: FeatureCollection
}

type Tag = { readonly key: string; readonly color: string }

const collection = (features: Feature[]): FeatureCollection => ({ type: 'FeatureCollection', features })

function routeOf(o: OtherMission, tag: Tag): Feature[] {
  const { items, mission } = o.draft
  const placed = placeTakeoffs(items, mission.home)
  const legs = pathGeoJson(placed, mission.home).features.map((f): Feature => ({ ...f, properties: { ...tag, predicted: 0 } }))
  const pred = o.predicted && o.predicted.length >= 2 ? [o.predicted] : []
  const predicted = pred.map((pts): Feature<Geometry> => ({ type: 'Feature', properties: { ...tag, predicted: 1 }, geometry: { type: 'LineString', coordinates: pts.map((p) => [p.lon, p.lat]) } }))
  return [...legs, ...predicted]
}

const fenceOf = (o: OtherMission, tag: Tag): Feature[] => fenceGeoJson(o.draft.mission.fence).features.map((f) => ({ ...f, properties: { ...f.properties, ...tag } }))

const rallyOf = (o: OtherMission, tag: Tag): Feature<Point>[] =>
  o.draft.mission.rally.map((r) => ({ type: 'Feature', properties: { ...tag }, geometry: { type: 'Point', coordinates: [r.lon, r.lat] } }))

/** Every feature carries its mission's `key` and `color`; route features also `predicted` (0 / 1). */
export function othersGeoJson(others: readonly OtherMission[]): OthersGeoJson {
  const tags = others.map((o) => ({ o, tag: { key: o.key, color: o.color } }))
  return {
    paths: collection(tags.flatMap(({ o, tag }) => routeOf(o, tag))),
    fences: collection(tags.flatMap(({ o, tag }) => fenceOf(o, tag))),
    rally: collection(tags.flatMap(({ o, tag }) => rallyOf(o, tag))),
  }
}
