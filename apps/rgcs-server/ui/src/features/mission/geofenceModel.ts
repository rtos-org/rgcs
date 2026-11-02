// Fence zones and rally points of the plan (`draft.mission.fence` / `.rally`): immutable edits that
// go through the same undo history as the waypoints, plus the drawing helpers.
import type { FenceZone, RallyPoint } from '../../shared/api/types'
import type { LatLon } from './geo'
import type { Draft } from './model'

const M_PER_DEG_LAT = 110_540
const M_PER_DEG_LON = 111_320
const MIN_RADIUS_M = 1

const withFence = (d: Draft, fence: readonly FenceZone[]): Draft => ({ ...d, mission: { ...d.mission, fence: [...fence] } })
const withRally = (d: Draft, rally: readonly RallyPoint[]): Draft => ({ ...d, mission: { ...d.mission, rally: [...rally] } })

/** Replaces the whole fence / rally (read from the vehicle). */
export const setFence = (d: Draft, zones: readonly FenceZone[]): Draft => withFence(d, zones)
export const setRally = (d: Draft, points: readonly RallyPoint[]): Draft => withRally(d, points)

export function addZone(d: Draft, zone: FenceZone): Draft {
  return withFence(d, [...d.mission.fence, zone])
}

/** Puts `zone` (this very object) at `zi`. */
export function replaceZone(d: Draft, zi: number, zone: FenceZone): Draft {
  return zi < 0 || zi >= d.mission.fence.length ? d : withFence(d, d.mission.fence.map((z, i) => (i === zi ? zone : z)))
}

export function removeZone(d: Draft, zi: number): Draft {
  return withFence(d, d.mission.fence.filter((_, i) => i !== zi))
}

function editZone(d: Draft, zi: number, fn: (z: FenceZone) => FenceZone): Draft {
  const z = d.mission.fence[zi]
  if (!z) return d
  const next = fn(z)
  return next === z ? d : withFence(d, d.mission.fence.map((x, i) => (i === zi ? next : x)))
}

function editVertices(d: Draft, zi: number, fn: (v: readonly LatLon[]) => LatLon[]): Draft {
  return editZone(d, zi, (z) => (z.kind === 'polygon' ? { ...z, vertices: fn(z.vertices) } : z))
}

export const appendVertex = (d: Draft, zi: number, p: LatLon): Draft => editVertices(d, zi, (v) => [...v, { lat: p.lat, lon: p.lon }])
export const insertVertex = (d: Draft, zi: number, after: number, p: LatLon): Draft =>
  editVertices(d, zi, (v) => [...v.slice(0, after + 1), { lat: p.lat, lon: p.lon }, ...v.slice(after + 1)])
export const moveVertex = (d: Draft, zi: number, vi: number, p: LatLon): Draft => editVertices(d, zi, (v) => v.map((x, i) => (i === vi ? { lat: p.lat, lon: p.lon } : x)))
export const removeVertex = (d: Draft, zi: number, vi: number): Draft => editVertices(d, zi, (v) => v.filter((_, i) => i !== vi))

export function moveCircle(d: Draft, zi: number, p: LatLon): Draft {
  return editZone(d, zi, (z) => (z.kind === 'circle' ? { ...z, center: { lat: p.lat, lon: p.lon } } : z))
}

export function setRadius(d: Draft, zi: number, radius: number): Draft {
  return editZone(d, zi, (z) => (z.kind === 'circle' ? { ...z, radius: Math.max(MIN_RADIUS_M, Math.round(radius)) } : z))
}

export function setInclusion(d: Draft, zi: number, inclusion: boolean): Draft {
  return editZone(d, zi, (z) => (z.inclusion === inclusion ? z : { ...z, inclusion }))
}

export interface ZoneFinding {
  readonly zone: number
  readonly code: 'fence_vertices' | 'fence_radius'
}

/** The rules the server (and ArduPilot) refuses: a polygon of 3–255 vertices, a circle of radius > 0. */
export function fenceFindings(zones: readonly FenceZone[]): ZoneFinding[] {
  return zones.flatMap((z, zone): ZoneFinding[] => {
    if (z.kind === 'polygon' && (z.vertices.length < 3 || z.vertices.length > 255)) return [{ zone, code: 'fence_vertices' }]
    if (z.kind === 'circle' && !(z.radius > 0)) return [{ zone, code: 'fence_radius' }]
    return []
  })
}

/** A circle as a closed ring (first point repeated), starting due north. */
export function circleRing(center: LatLon, radius: number, n = 64): LatLon[] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = ((i % n) / n) * 2 * Math.PI
    return {
      lat: center.lat + (radius * Math.cos(a)) / M_PER_DEG_LAT,
      lon: center.lon + (radius * Math.sin(a)) / (M_PER_DEG_LON * Math.cos((center.lat * Math.PI) / 180)),
    }
  })
}

/** Rally altitudes are above home: the mission default only fits when its frame is Rel. */
const RALLY_FALLBACK_ALT = 50
export const rallyDefaultAlt = (m: Draft['mission']): number => (m.default_frame === 'rel' ? m.default_alt : RALLY_FALLBACK_ALT)

export const addRally = (d: Draft, p: LatLon, alt: number): Draft => withRally(d, [...d.mission.rally, { lat: p.lat, lon: p.lon, alt: Math.round(alt) }])
export const removeRally = (d: Draft, i: number): Draft => withRally(d, d.mission.rally.filter((_, j) => j !== i))
export const moveRally = (d: Draft, i: number, p: LatLon): Draft => withRally(d, d.mission.rally.map((r, j) => (j === i ? { ...r, lat: p.lat, lon: p.lon } : r)))
/** Whole metres: ArduPilot stores rally altitudes as int16. */
export const setRallyAlt = (d: Draft, i: number, alt: number): Draft => withRally(d, d.mission.rally.map((r, j) => (j === i ? { ...r, alt: Math.round(alt) } : r)))
