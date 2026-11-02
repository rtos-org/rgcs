import type { VehicleState } from '../../shared/api/types'
import { hasPosition } from './markers'

export type Aside = 'full' | 'rail' | 'none'

export interface Padding {
  readonly top: number
  readonly left: number
  readonly right: number
  readonly bottom: number
}

/** A map with nothing floating over it (the cockpit's mini map). */
export const NO_PADDING: Padding = { top: 0, left: 0, right: 0, bottom: 0 }

const GAP = 12
const ASIDE_W = 296
const RAIL_W = 60
const RIGHT_W = 372

/** Keeps follow / fly-to centred in the visible map (`setPadding`). */
export function padding(aside: Aside, right: boolean): Padding {
  const left = aside === 'full' ? ASIDE_W + 2 * GAP : aside === 'rail' ? RAIL_W + 2 * GAP : 0
  return { top: 72, left, right: right ? RIGHT_W + 2 * GAP : 0, bottom: 60 }
}

export type FirstView = { readonly center: [number, number] } | { readonly bounds: [[number, number], [number, number]] }

/** Where the map opens once positions arrive: on the one vehicle, or framing them all (null = none yet). */
export function firstView(vehicles: ReadonlyMap<number, VehicleState>): FirstView | null {
  const at = [...vehicles.values()].filter(hasPosition)
  if (at.length === 0) return null
  const lons = at.map((v) => v.lon)
  const lats = at.map((v) => v.lat)
  const [w, e, s, n] = [Math.min(...lons), Math.max(...lons), Math.min(...lats), Math.max(...lats)]
  if (w === e && s === n) return { center: [w, s] }
  return { bounds: [[w, s], [e, n]] }
}

/**
 * The vehicle the camera goes to when the operations view is entered: the selected one when it is
 * connected with a position, else the connected one nearest the map centre (`[lon, lat]`).
 */
export function arrivalTarget(vehicles: ReadonlyMap<number, VehicleState>, selected: number | null, centre: readonly [number, number]): number | null {
  const live = [...vehicles.values()].filter((v) => v.link !== 'lost' && hasPosition(v))
  if (live.some((v) => v.sysid === selected)) return selected
  const k = Math.cos((centre[1] * Math.PI) / 180)
  const d2 = (v: VehicleState) => ((v.lon - centre[0]) * k) ** 2 + (v.lat - centre[1]) ** 2
  return live.reduce<VehicleState | null>((best, v) => (best === null || d2(v) < d2(best) ? v : best), null)?.sysid ?? null
}

/** `[lon, lat]` of the followed vehicle, or null when nothing to centre on. */
export function followTarget(vehicles: ReadonlyMap<number, VehicleState>, follow: number | null): [number, number] | null {
  if (follow === null) return null
  const v = vehicles.get(follow)
  return v && hasPosition(v) ? [v.lon, v.lat] : null
}

/** Follow re-centres only beyond this distance: a hovering vehicle's GPS noise would otherwise
 * shake the whole map (waypoints, home) by a pixel or two at every telemetry frame. */
export const FOLLOW_DEADBAND_PX = 4

export interface ScreenPoint {
  readonly x: number
  readonly y: number
}

export function needsRecenter(center: ScreenPoint, vehicle: ScreenPoint, minPx = FOLLOW_DEADBAND_PX): boolean {
  return Math.hypot(vehicle.x - center.x, vehicle.y - center.y) > minPx
}

/** 3D follow dead bands: GPS jitter, yaw wobble and altitude noise of a hovering vehicle. */
const FOLLOW3D_MOVE_M = 0.5
const FOLLOW3D_TURN_DEG = 3
const FOLLOW3D_CLIMB_M = 1

export interface Camera3d {
  readonly lng: number
  readonly lat: number
  readonly bearing: number
  readonly elevation: number
}

export interface Follow3d {
  readonly center: [number, number]
  readonly bearing: number
  readonly elevation: number
}

const turn = (a: number, b: number) => Math.abs(((((a - b) % 360) + 540) % 360) - 180)

/**
 * The 3D follow camera: centred on the vehicle at its altitude (`amsl`), looking along its heading
 * (course when the heading is unknown) so the view is from behind and above. `null` when the
 * current camera (`cur`) is already within the dead bands.
 */
export function follow3dCamera(v: VehicleState, amsl: number, cur: Camera3d | null): Follow3d | null {
  const bearing = v.hdg ?? v.cog ?? cur?.bearing ?? 0
  const next: Follow3d = { center: [v.lon, v.lat], bearing, elevation: amsl }
  if (!cur) return next
  const moved = Math.hypot((v.lon - cur.lng) * 111_320 * Math.cos((v.lat * Math.PI) / 180), (v.lat - cur.lat) * 110_540)
  const still = moved < FOLLOW3D_MOVE_M && turn(bearing, cur.bearing) < FOLLOW3D_TURN_DEG && Math.abs(amsl - cur.elevation) < FOLLOW3D_CLIMB_M
  return still ? null : next
}
