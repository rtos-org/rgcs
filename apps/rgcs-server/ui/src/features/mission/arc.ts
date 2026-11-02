// NAV_ARC_WAYPOINT (MAV_CMD 36, Copter 4.7+): the leg from the previous position to this item
// is a circular arc; param1 is its angle in degrees, positive clockwise (seen from above), at most
// ±359. The centre sits on the chord's perpendicular bisector (ArduPilot SCurve: r = chord /
// (2·|sin(θ/2)|)). Flat-earth maths: fine for the few kilometres of a leg.
import type { MissionItem } from '../../shared/api/types'
import type { LatLon } from './geo'

export const MAV_CMD_NAV_ARC_WAYPOINT = 36
/** Below this ArduPilot flies a straight line. */
const MIN_ARC_DEG = 1
const MAX_ARC_DEG = 359
/** A bulge smaller than this (m) is a straight leg. */
const MIN_SAGITTA_M = 0.5
const M_PER_DEG_LAT = 110_540
const M_PER_DEG_LON = 111_320
const RAD = Math.PI / 180

export interface Xy {
  readonly x: number
  readonly y: number
}

/** Metres east / north of `o`. */
export function toLocal(o: LatLon, p: LatLon): Xy {
  return { x: (p.lon - o.lon) * M_PER_DEG_LON * Math.cos(o.lat * RAD), y: (p.lat - o.lat) * M_PER_DEG_LAT }
}

export function fromLocal(o: LatLon, v: Xy): LatLon {
  return { lat: o.lat + v.y / M_PER_DEG_LAT, lon: o.lon + v.x / (M_PER_DEG_LON * Math.cos(o.lat * RAD)) }
}

/** The arc angle (whole degrees, + clockwise) of the circle from `a` through `p` to `b`; 0 = straight. */
export function arcAngleThrough(a: LatLon, p: LatLon, b: LatLon): number {
  const B = toLocal(a, b)
  const P = toLocal(a, p)
  const chord = Math.hypot(B.x, B.y)
  if (chord === 0) return 0
  const cross = (B.x * P.y - B.y * P.x) / chord // P's distance to the left of A → B
  if (Math.abs(cross) < MIN_SAGITTA_M) return 0
  const pa = { x: -P.x, y: -P.y }
  const pb = { x: B.x - P.x, y: B.y - P.y }
  const inscribed = Math.acos(Math.max(-1, Math.min(1, (pa.x * pb.x + pa.y * pb.y) / (Math.hypot(pa.x, pa.y) * Math.hypot(pb.x, pb.y)))))
  const theta = Math.min(MAX_ARC_DEG, Math.round(360 - (2 * inscribed) / RAD))
  // bulging to the left of travel means turning right: clockwise
  return cross > 0 ? theta : -theta
}

interface Circle {
  readonly c: Xy
  readonly r: number
  readonly start: number
  readonly sweep: number
}

function circleOf(B: Xy, angleDeg: number): Circle {
  const chord = Math.hypot(B.x, B.y)
  const theta = Math.abs(angleDeg) * RAD
  const s = Math.sign(angleDeg)
  const r = chord / (2 * Math.abs(Math.sin(theta / 2)))
  const left = { x: -B.y / chord, y: B.x / chord }
  const h = r * Math.cos(theta / 2)
  const c = { x: B.x / 2 - s * left.x * h, y: B.y / 2 - s * left.y * h }
  // clockwise = decreasing maths angle
  return { c, r, start: Math.atan2(-c.y, -c.x), sweep: -s * theta }
}

const straight = (angleDeg: number) => !Number.isFinite(angleDeg) || Math.abs(angleDeg) < MIN_ARC_DEG

/** Points from `a` to `b` along the arc (`n` segments; a straight leg is just [a, b]). */
export function arcPoints(a: LatLon, b: LatLon, angleDeg: number, n = Math.max(8, Math.ceil(Math.abs(angleDeg) / 5))): LatLon[] {
  const B = toLocal(a, b)
  if (straight(angleDeg) || (B.x === 0 && B.y === 0)) return [a, b]
  const { c, r, start, sweep } = circleOf(B, Math.max(-MAX_ARC_DEG, Math.min(MAX_ARC_DEG, angleDeg)))
  return Array.from({ length: n + 1 }, (_, i) => {
    if (i === 0) return a
    const t = start + (sweep * i) / n
    return fromLocal(a, { x: c.x + r * Math.cos(t), y: c.y + r * Math.sin(t) })
  })
}

export function arcLengthM(a: LatLon, b: LatLon, angleDeg: number): number {
  const B = toLocal(a, b)
  const chord = Math.hypot(B.x, B.y)
  if (straight(angleDeg) || chord === 0) return chord
  // as flown (and as the server counts it): at most ±359°
  const clamped = Math.max(-MAX_ARC_DEG, Math.min(MAX_ARC_DEG, angleDeg))
  return circleOf(B, clamped).r * Math.abs(clamped) * RAD
}

export const isArc = (it: MissionItem): boolean => it.command === MAV_CMD_NAV_ARC_WAYPOINT

/** The flown path of the leg into `item`: an arc for an ARC_WAYPOINT, else the straight line. */
export function legPath(prev: LatLon, item: MissionItem): LatLon[] {
  const end = { lat: item.lat, lon: item.lon }
  return isArc(item) ? arcPoints(prev, end, item.params[0]) : [prev, end]
}

