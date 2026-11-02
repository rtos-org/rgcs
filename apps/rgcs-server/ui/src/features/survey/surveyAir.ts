// Survey areas in 3D: each outline draped on the DEM (a line just above the ground) in the air layer.
import type { AirVertex, ElevAt, Rgb } from '../map/air'
import { mercatorLine } from '../map/air'
import { haversineM, type LatLon } from '../mission/geo'
import type { DraftSurvey } from '../mission/model'

/** Height above the DEM so the line is not buried by terrain rendering. */
export const SURVEY_LIFT_M = 2
const STEP_M = 10
/** Terrain samples per outline (the spec's per-survey sampling cap). */
const MAX_SAMPLES = 2000
/** `SURVEY_COLOR` (#ffd166). */
const COLOR: Rgb = [1, 0xd1 / 255, 0x66 / 255]

/** The closed ring sampled every STEP_M metres (coarser for a long perimeter). */
function sampled(ring: readonly LatLon[]): LatLon[] {
  const closed = [...ring, ring[0]!]
  const legs = closed.slice(1).map((b, i) => ({ a: closed[i]!, b, len: haversineM(closed[i]!.lat, closed[i]!.lon, b.lat, b.lon) }))
  const step = Math.max(STEP_M, legs.reduce((s, l) => s + l.len, 0) / MAX_SAMPLES)
  const pts = legs.flatMap(({ a, b, len }) => {
    const n = Math.max(1, Math.ceil(len / step))
    return Array.from({ length: n }, (_, k) => ({ lat: a.lat + ((b.lat - a.lat) * k) / n, lon: a.lon + ((b.lon - a.lon) * k) / n }))
  })
  return [...pts, closed[0]!]
}

/** One draped line per survey; points whose ground is unknown take `fallback` (none: skipped). */
export function surveyOutlines(surveys: readonly DraftSurvey[], elevAt: ElevAt, fallback: number | null): AirVertex[][] {
  return surveys.flatMap((s) => {
    if (s.spec.polygon.length < 3) return []
    const pts = sampled(s.spec.polygon).flatMap((p) => {
      const g = elevAt(p.lon, p.lat) ?? fallback
      return g === null ? [] : [{ lat: p.lat, lon: p.lon, amsl: g + SURVEY_LIFT_M, color: COLOR }]
    })
    return pts.length >= 2 ? [mercatorLine(pts)] : []
  })
}
