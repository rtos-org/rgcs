// The predicted flight (flightpath) as a thin dashed 2D line, shared by the planner and the
// operations map; in 3D the AirPathLayer draws it instead (missionAirData `predicted`).
import type { FeatureCollection } from 'geojson'
import type { Map as MlMap } from 'maplibre-gl'
import type { Predicted } from '../mission/missionAir'

export const PREDICTED_SOURCE = 'mission-predicted'
export const PREDICTED_LINE = 'mission-predicted-line'

export function predictedGeoJson(p: Predicted | null): FeatureCollection {
  if (!p || p.points.length < 2) return { type: 'FeatureCollection', features: [] }
  return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: p.points.map((q) => [q.lon, q.lat]) } }] }
}

export function addPredictedLayer(m: MlMap, p: Predicted | null): void {
  m.addSource(PREDICTED_SOURCE, { type: 'geojson', data: predictedGeoJson(p) })
  m.addLayer({ id: PREDICTED_LINE, type: 'line', source: PREDICTED_SOURCE, layout: { 'line-join': 'round' }, paint: { 'line-color': '#ece6ff', 'line-width': 2, 'line-opacity': 0.75, 'line-dasharray': [2, 1.5] } })
  setPredicted(m, p)
}

export function setPredicted(m: MlMap | null, p: Predicted | null): void {
  ;(m?.getSource(PREDICTED_SOURCE) as { setData: (d: unknown) => void } | undefined)?.setData(predictedGeoJson(p))
}
