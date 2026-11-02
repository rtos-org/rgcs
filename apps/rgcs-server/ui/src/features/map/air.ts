// Altitudes for the 3D map (memory: RGCS mission UI conventions). Vehicles fly at the DEM ground
// of their home plus the relative altitude — `alt_msl` is not used: SITL's MSL and a real GPS's
// geoid need not match the DEM, while "home ground + rel" always puts the vehicle over its take-off.
// It is clamped to the DEM under the vehicle; rovers and disarmed vehicles sit on it.
import type { MissionItem, VehicleState } from '../../shared/api/types'
import type { LatLon } from './store'

/** Ground elevation in metres AMSL, `null` while its DEM tile is not loaded. */
export type ElevAt = (lon: number, lat: number) => number | null
export type Rgb = readonly [number, number, number]

/** One vertex in MapLibre mercator units (z = metres scaled like x / y). */
export interface AirVertex {
  readonly x: number
  readonly y: number
  readonly z: number
  readonly c: Rgb
}

export interface AirPoint {
  readonly lon: number
  readonly lat: number
  readonly amsl: number
  readonly color: Rgb
}

const finite = (n: number | null): n is number => n !== null && Number.isFinite(n)

export function vehicleAmsl(v: VehicleState, home: LatLon | null, elevAt: ElevAt): { ground: number; amsl: number } | null {
  if (!home || (v.lat === 0 && v.lon === 0)) return null
  const homeGround = elevAt(home.lon, home.lat)
  if (!finite(homeGround) || !Number.isFinite(v.alt_rel)) return null
  const under = elevAt(v.lon, v.lat)
  const ground = finite(under) ? under : homeGround
  // a rover or a disarmed vehicle stands on the DEM; a flying one never draws inside it (SITL's
  // world is flat at home and a GPS altitude drifts, while the DEM follows the real hills)
  const onGround = v.kind === 'rover' || !v.armed
  return { ground, amsl: onGround ? ground : Math.max(homeGround + v.alt_rel, ground) }
}

export function itemAmsl(item: MissionItem, home: LatLon | null, elevAt: ElevAt): number | null {
  if (item.frame === 'abs') return item.alt
  const ground = item.frame === 'ter' ? elevAt(item.lon, item.lat) : home ? elevAt(home.lon, home.lat) : null
  return finite(ground) ? ground + item.alt : null
}

const CYAN: Rgb = [0x9c / 255, 0xc9 / 255, 1]
const ALT_HI: Rgb = [0xd8 / 255, 0xa8 / 255, 1]
const MINT: Rgb = [0x8f / 255, 0xe3 / 255, 0xa6 / 255]
const AMBER: Rgb = [0xf2 / 255, 0xb5 / 255, 0x44 / 255]
const DANGER: Rgb = [0xff / 255, 0x69 / 255, 0x61 / 255]
/** The climb (or descent) angle that reaches the end of the scale. */
const STEEP_DEG = 45

const mix = (a: Rgb, b: Rgb, k: number): Rgb => (k <= 0 ? a : k >= 1 ? b : [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k])

/**
 * Path colour by climb angle: level `--accent`, climbing through mint (an RGB blend straight to
 * amber would pass through grey) and amber to `--danger` at 45°,
 * descending towards `--alt-hi` at 45°.
 */
export function climbColor(dz: number, dh: number): Rgb {
  const t = ((Math.atan2(dz, Math.max(0, dh)) * 180) / Math.PI) / STEEP_DEG
  if (t <= 0) return mix(CYAN, ALT_HI, -t)
  if (t < 0.25) return mix(CYAN, MINT, t * 4)
  return t < 0.5 ? mix(MINT, AMBER, (t - 0.25) * 4) : mix(AMBER, DANGER, (t - 0.5) * 2)
}

/** A mission drawn in its own colour (spec 2026-10-20 §9): `base` until half of 45°, then towards `--danger` at 45°. */
export function climbTint(base: Rgb, dz: number, dh: number): Rgb {
  const t = ((Math.atan2(dz, Math.max(0, dh)) * 180) / Math.PI) / STEEP_DEG
  return t < 0.5 ? base : mix(base, DANGER, (t - 0.5) * 2)
}

/** Same maths as `maplibregl.MercatorCoordinate.fromLngLat` (kept pure for tests). */
const EARTH_CIRCUMFERENCE = 2 * Math.PI * 6371008.8

export function toMercator(lon: number, lat: number, amsl: number): { x: number; y: number; z: number } {
  const x = (180 + lon) / 360
  const y = (180 - (180 / Math.PI) * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))) / 360
  const z = amsl / (EARTH_CIRCUMFERENCE * Math.cos((lat * Math.PI) / 180))
  return { x, y, z }
}

export function mercatorLine(points: readonly AirPoint[]): AirVertex[] {
  return points.map((p) => ({ ...toMercator(p.lon, p.lat, p.amsl), c: p.color }))
}
