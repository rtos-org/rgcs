// Surveys on the planner map as GeoJSON (pure): the area, the shooting sections, the links between
// them (lead-in, turns, overshoot), the photo points and footprints, and the rotate handle.
import type { Feature, FeatureCollection, Geometry, Position } from 'geojson'
import type { MissionItem } from '../../shared/api/types'
import { fromLocal, legPath, toLocal, type Xy } from '../mission/arc'
import { CMDS } from '../mission/cmds'
import { hasPosition, type LatLon } from '../mission/geo'
import type { Draft } from '../mission/model'
import type { SurveyGeometry } from './generate'
import type { SurveySpec } from './spec'

export type SurveyFeatureKind = 'area' | 'shoot' | 'link' | 'photo' | 'foot' | 'handle'
export interface SurveyFeatureProps {
  readonly kind: SurveyFeatureKind
  /** The survey id. */
  readonly id: string
}
export type SurveyFeature = Feature<Geometry, SurveyFeatureProps>
export type SurveyCollection = FeatureCollection<Geometry, SurveyFeatureProps>

/** What the map needs of a generated survey (a `SurveyMetrics` or a `generateSurvey` result). */
export interface SurveyShape {
  readonly geometry: SurveyGeometry
  readonly items: readonly MissionItem[]
}

/** The rotate handle sits this many half-extents (along the lanes) from the centroid: just outside the area. */
export const HANDLE_REACH = 1.25

const RAD = Math.PI / 180
const pos = (p: LatLon): Position => [p.lon, p.lat]
const unit = (deg: number): Xy => ({ x: Math.sin(deg * RAD), y: Math.cos(deg * RAD) })
const feature = (kind: SurveyFeatureKind, id: string, geometry: Geometry): SurveyFeature => ({ type: 'Feature', properties: { kind, id }, geometry })

/** Area centroid (falls back to the vertex mean for a degenerate ring). */
export function centroid(polygon: readonly LatLon[]): LatLon {
  const o = polygon[0]!
  const pts = polygon.map((p) => toLocal(o, p))
  let a = 0
  let cx = 0
  let cy = 0
  pts.forEach((p, i) => {
    const q = pts[(i + 1) % pts.length]!
    const k = p.x * q.y - q.x * p.y
    a += k
    cx += (p.x + q.x) * k
    cy += (p.y + q.y) * k
  })
  if (Math.abs(a) < 1e-9) return fromLocal(o, { x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length })
  return fromLocal(o, { x: cx / (3 * a), y: cy / (3 * a) })
}

/** The rotate handle: from the centroid along the lane angle, HANDLE_REACH × the half-extent that way. */
export function handlePoint(polygon: readonly LatLon[], angleDeg: number): LatLon | null {
  if (polygon.length < 3) return null
  const c = centroid(polygon)
  const u = unit(angleDeg)
  const half = Math.max(...polygon.map((p) => toLocal(c, p)).map((v) => Math.abs(v.x * u.x + v.y * u.y)))
  return fromLocal(c, { x: u.x * half * HANDLE_REACH, y: u.y * half * HANDLE_REACH })
}

/** The lane angle for a handle dragged to `p`: the bearing from the centroid, whole degrees in [0, 360). */
export function handleAngle(polygon: readonly LatLon[], p: LatLon): number {
  const v = toLocal(centroid(polygon), p)
  return ((Math.round(Math.atan2(v.x, v.y) / RAD) % 360) + 360) % 360
}

/** Photo points of each lane: from the end it is entered at, one per trigger distance (as `surveyNumbers` counts them). */
function photoPoints(g: SurveyGeometry): { at: LatLon; headingDeg: number }[] {
  return g.order.flatMap((li, k) => {
    const lane = g.lanes[li]!
    const forward = (k % 2 === 0) !== g.firstFromB
    const [from, to] = forward ? [lane.a, lane.b] : [lane.b, lane.a]
    const v = toLocal(from, to)
    const len = Math.hypot(v.x, v.y)
    const n = Math.floor(len / g.triggerDistM) + 1
    const headingDeg = Math.atan2(v.x, v.y) / RAD
    return Array.from({ length: n }, (_, i) => {
      const t = len > 0 ? (i * g.triggerDistM) / len : 0
      return { at: fromLocal(from, { x: v.x * t, y: v.y * t }), headingDeg }
    })
  })
}

/** The ground a photo covers: along the flight × across it, centred on the point. */
function footRing(at: LatLon, headingDeg: number, g: SurveyGeometry): Position[] {
  const u = unit(headingDeg)
  const v = { x: u.y, y: -u.x }
  const [ha, hc] = [g.footprint.alongM / 2, g.footprint.acrossM / 2]
  const corners = [
    [ha, hc],
    [ha, -hc],
    [-ha, -hc],
    [-ha, hc],
  ].map(([a, c]) => pos(fromLocal(at, { x: u.x * a! + v.x * c!, y: u.y * a! + v.y * c! })))
  return [...corners, corners[0]!]
}

/** The flown path outside the shooting sections (between a trigger-off and the next trigger-on), one line per gap. */
function linkLines(items: readonly MissionItem[]): Position[][] {
  const trig = CMDS.DO_SET_CAM_TRIGG_DIST.id
  const lines: Position[][] = []
  let cur: Position[] = []
  let shooting = false
  let prev: LatLon | null = null
  const flush = () => {
    if (cur.length >= 2) lines.push(cur)
    cur = []
  }
  for (const it of items) {
    if (it.command === trig) shooting = it.params[0] > 0
    if (!hasPosition(it)) continue
    if (prev && shooting) flush()
    else if (prev) cur = [...(cur.length ? cur : [pos(prev)]), ...legPath(prev, it).slice(1).map(pos)]
    prev = { lat: it.lat, lon: it.lon }
  }
  flush()
  return lines
}

/** The map features of one survey; without a shape (no lanes fit) only its area and handle. */
export function surveyFeatures(id: string, spec: SurveySpec, shape: SurveyShape | null): SurveyFeature[] {
  const ring = spec.polygon.map(pos)
  const area = ring.length >= 3 ? [feature('area', id, { type: 'Polygon', coordinates: [[...ring, ring[0]!]] })] : []
  const h = handlePoint(spec.polygon, spec.angleDeg)
  const handle = h ? [feature('handle', id, { type: 'Point', coordinates: pos(h) })] : []
  if (!shape) return [...area, ...handle]
  const g = shape.geometry
  const shoot = g.lanes.map((l) => feature('shoot', id, { type: 'LineString', coordinates: [pos(l.a), pos(l.b)] }))
  const link = linkLines(shape.items).map((c) => feature('link', id, { type: 'LineString', coordinates: c }))
  const photos = photoPoints(g)
  const photo = photos.map((p) => feature('photo', id, { type: 'Point', coordinates: pos(p.at) }))
  const foot = photos.map((p) => feature('foot', id, { type: 'Polygon', coordinates: [footRing(p.at, p.headingDeg, g)] }))
  return [...area, ...foot, ...link, ...shoot, ...photo, ...handle]
}

export function surveyGeoJson(d: Draft, metrics: (id: string) => SurveyShape | null): SurveyCollection {
  return { type: 'FeatureCollection', features: d.surveys.flatMap((s) => surveyFeatures(s.id, s.spec, metrics(s.id))) }
}
