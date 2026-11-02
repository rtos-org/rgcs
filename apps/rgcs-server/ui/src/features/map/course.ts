// Where each vehicle is going (user request 2026-10-19, 2D): the course-over-ground vector and,
// while the autopilot navigates, a line to its current target (GUIDED target or the bearing /
// distance of NAV_CONTROLLER_OUTPUT).
import type { Feature, FeatureCollection } from 'geojson'
import type { SysId, VehicleState } from '../../shared/api/types'
import { hasPosition } from './markers'

/** The vector shows where the vehicle will be in this many seconds at its current speed. */
export const VECTOR_SECONDS = 10
const MIN_VECTOR_M = 15
/** The vector is at least this long on screen, so it clears the 34 px marker disc. */
const MIN_VECTOR_PX = 70
/** A reported target is used only when it agrees with NAV_CONTROLLER_OUTPUT (ArduCopter can report the EKF origin). */
const TARGET_AGREE_M = 25
const MIN_SPEED_MS = 0.5
/** Modes in which NAV_CONTROLLER_OUTPUT describes a real destination. */
const NAVIGATING = new Set(['AUTO', 'GUIDED', 'RTL', 'SMART_RTL', 'LAND', 'BRAKE'])
const M_PER_DEG = 111_320
const RAD = Math.PI / 180

type LngLat = [number, number]

/** Flat-earth destination: fine for the few hundred metres drawn here. */
export function destination(lat: number, lon: number, bearingDeg: number, distM: number): LngLat {
  const north = distM * Math.cos(bearingDeg * RAD)
  const east = distM * Math.sin(bearingDeg * RAD)
  return [lon + east / (M_PER_DEG * Math.cos(lat * RAD)), lat + north / M_PER_DEG]
}

const lineFeature = (coords: LngLat[], properties: Record<string, unknown>): Feature => ({ type: 'Feature', properties, geometry: { type: 'LineString', coordinates: coords } })

/** Where the course vector ends and how many seconds of flight it stands for; `null` when slow / no course. */
export function vectorEnd(v: VehicleState, mPerPx = 0): { readonly end: LngLat; readonly seconds: number } | null {
  if (v.cog === undefined || v.cog === null || v.ground_speed < MIN_SPEED_MS) return null
  const len = Math.max(MIN_VECTOR_M, MIN_VECTOR_PX * mPerPx, v.ground_speed * VECTOR_SECONDS)
  return { end: destination(v.lat, v.lon, v.cog, len), seconds: len / v.ground_speed }
}

function vector(v: VehicleState, sel: number, mPerPx: number): Feature[] {
  const e = vectorEnd(v, mPerPx)
  return e ? [lineFeature([[v.lon, v.lat], e.end], { kind: 'vector', sysid: v.sysid, sel })] : []
}

/** Where the autopilot is heading (NAV_CONTROLLER_OUTPUT, or the reported target when it agrees). */
export function navTarget(v: VehicleState): LngLat | null {
  if (!v.armed || !v.nav || v.nav.wp_dist <= 0 || !NAVIGATING.has(v.mode)) return null
  const [lon, lat] = destination(v.lat, v.lon, v.nav.target_bearing, v.nav.wp_dist)
  const t = v.target
  const agrees = t && Math.hypot((t.lat - lat) * M_PER_DEG, (t.lon - lon) * M_PER_DEG * Math.cos(lat * RAD)) <= TARGET_AGREE_M
  return agrees ? [t.lon, t.lat] : [lon, lat]
}

function nav(v: VehicleState, sel: number): Feature[] {
  const end = navTarget(v)
  if (!end || !v.nav) return []
  return [
    lineFeature([[v.lon, v.lat], end], { kind: 'nav', sysid: v.sysid, sel, dist: v.nav.wp_dist }),
    { type: 'Feature', properties: { kind: 'target', sysid: v.sysid, sel }, geometry: { type: 'Point', coordinates: end } },
  ]
}

/** `mPerPx`: metres per screen pixel at the current zoom (0 = no screen minimum). */
export function courseGeoJson(vehicles: ReadonlyMap<SysId, VehicleState>, selected: SysId | null, mPerPx = 0): FeatureCollection {
  // A lost link leaves the last course frozen: drawing it would show motion that is not known.
  const features = [...vehicles.values()].filter((v) => hasPosition(v) && v.link !== 'lost').flatMap((v) => {
    const sel = v.sysid === selected ? 1 : 0
    return [...nav(v, sel), ...vector(v, sel, mPerPx)]
  })
  return { type: 'FeatureCollection', features }
}

/** Web Mercator metres per CSS pixel (512 px tiles) at `zoom` and `lat`. */
export function metresPerPixel(zoom: number, lat: number): number {
  return (40_075_016.686 * Math.cos(lat * RAD)) / (512 * 2 ** zoom)
}
