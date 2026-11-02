// 3D: DOM markers sit on the terrain surface, so each one is shifted by the screen-space delta
// between its ground point and its altitude (prototype floatMarkers). The matrix is the one the
// custom layer renders with, so markers and the AirPathLayer posts always meet.
import type { Map as MlMap, Marker } from 'maplibre-gl'
import { toMercator } from './air'

type Mat = ArrayLike<number>
interface Size {
  readonly w: number
  readonly h: number
}
interface Pt {
  readonly x: number
  readonly y: number
}

/** Mercator (x, y, z) → CSS pixels, `null` behind the camera. Column-major matrix. */
export function projectToScreen(m: Mat, size: Size, p: { x: number; y: number; z: number }): Pt | null {
  const cx = m[0]! * p.x + m[4]! * p.y + m[8]! * p.z + m[12]!
  const cy = m[1]! * p.x + m[5]! * p.y + m[9]! * p.z + m[13]!
  const cw = m[3]! * p.x + m[7]! * p.y + m[11]! * p.z + m[15]!
  if (cw <= 0) return null
  return { x: ((cx / cw + 1) / 2) * size.w, y: ((1 - cy / cw) / 2) * size.h }
}

/** Screen pixels one metre of altitude lifts a point by (perspective-correct at `amsl`). */
export function pixelsPerMetre(m: Mat, size: Size, lon: number, lat: number, amsl: number): number | null {
  const a = projectToScreen(m, size, toMercator(lon, lat, amsl))
  const b = projectToScreen(m, size, toMercator(lon, lat, amsl + 10))
  return a && b ? (a.y - b.y) / 10 : null
}

export function floatOffset(m: Mat, size: Size, merc: { x: number; y: number; z: number }, ground: Pt): [number, number] {
  const p = projectToScreen(m, size, merc)
  return p ? [p.x - ground.x, p.y - ground.y] : [0, 0]
}

/** A DOM marker and where it flies; `amsl: null` keeps it on the ground. */
export interface Floating {
  readonly marker: Marker
  readonly lon: number
  readonly lat: number
  readonly amsl: number | null
  /** The marker's 2D offset (e.g. the `.vmk` disc correction). */
  readonly base: readonly [number, number]
  /** Ground AMSL under the marker (the DEM sampler's): projected with the frame matrix instead of `map.project`, a terrain lookup per call. */
  readonly ground?: number | null
}

/** Below this a float offset counts as unchanged. */
const STILL_PX = 0.25

/**
 * Moves a marker only when its offset changed: every setOffset makes MapLibre re-test the marker
 * against the terrain with gl.readPixels (opacityWhenCovered), which stalls the GPU each frame.
 */
function offsetTo(marker: Marker, x: number, y: number): void {
  const cur = marker.getOffset?.()
  if (cur && Math.abs(cur.x - x) < STILL_PX && Math.abs(cur.y - y) < STILL_PX) return
  marker.setOffset([x, y])
}

/** Where the marker's ground point is on screen (null: behind the camera). */
function groundPoint(map: MlMap, matrix: Mat, size: Size, f: Floating): Pt | null {
  if (f.ground === undefined || f.ground === null) return map.project([f.lon, f.lat])
  return projectToScreen(matrix, size, toMercator(f.lon, f.lat, f.ground))
}

/** Applies the float offsets; `matrix: null` (2D) restores the base offsets. */
export function floatMarkers(map: MlMap, matrix: Mat | null, entries: readonly Floating[]): void {
  if (entries.length === 0) return
  const el = map.getContainer()
  const size = { w: el.clientWidth, h: el.clientHeight }
  for (const f of entries) {
    const ground = matrix && f.amsl !== null ? groundPoint(map, matrix, size, f) : null
    if (!matrix || f.amsl === null || !ground) {
      offsetTo(f.marker, f.base[0], f.base[1])
      continue
    }
    const [dx, dy] = floatOffset(matrix, size, toMercator(f.lon, f.lat, f.amsl), ground)
    offsetTo(f.marker, f.base[0] + dx, f.base[1] + dy)
  }
}

/** Two frame matrices are equal (MapLibre may reuse the array, so compare a copy). */
export function sameMatrix(a: Mat | null, b: Mat | null): boolean {
  if (!a || !b || a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}
