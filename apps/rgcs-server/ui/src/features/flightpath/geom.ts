// Plane geometry for the predicted flight path, in local metres around an origin (x east, y
// north). Circle positions are polar angles about the centre (counter-clockwise positive), so a
// clockwise loiter walks them downwards.
import type { LatLon } from '../mission/geo'

export interface Xy {
  readonly x: number
  readonly y: number
}

const R = 6_371_000
const RAD = Math.PI / 180
const TAU = 2 * Math.PI
/** Below this a corner is flown straight. */
const MIN_TURN_RAD = RAD

const mPerDegLat = R * RAD

export function toXy(o: LatLon, p: LatLon): Xy {
  return { x: (p.lon - o.lon) * mPerDegLat * Math.cos(o.lat * RAD), y: (p.lat - o.lat) * mPerDegLat }
}

export function toLatLon(o: LatLon, p: Xy): LatLon {
  return { lat: o.lat + p.y / mPerDegLat, lon: o.lon + p.x / (mPerDegLat * Math.cos(o.lat * RAD)) }
}

export const dist = (a: Xy, b: Xy): number => Math.hypot(b.x - a.x, b.y - a.y)
export const onCircle = (c: Xy, r: number, phi: number): Xy => ({ x: c.x + r * Math.cos(phi), y: c.y + r * Math.sin(phi) })
export const polar = (c: Xy, p: Xy): number => Math.atan2(p.y - c.y, p.x - c.x)

/** Unit direction of travel at polar angle `phi` on a circle flown clockwise / counter-clockwise. */
export const travelDir = (phi: number, cw: boolean): Xy => (cw ? { x: Math.sin(phi), y: -Math.cos(phi) } : { x: -Math.sin(phi), y: Math.cos(phi) })

/** The two tangent points seen from `p`, or null from inside the circle. */
function tangentAngles(p: Xy, c: Xy, r: number): [number, number] | null {
  const d = dist(p, c)
  if (d <= r) return null
  const phi0 = polar(c, p)
  const alpha = Math.acos(r / d)
  return [phi0 + alpha, phi0 - alpha]
}

/** Where a vehicle coming from `p` joins the circle so that it keeps turning the given way. */
export function entryTangent(p: Xy, c: Xy, r: number, cw: boolean): Xy | null {
  const phis = tangentAngles(p, c, r)
  if (!phis) return null
  const phi = phis.find((a) => {
    const t = onCircle(c, r, a)
    const d = travelDir(a, cw)
    return d.x * (t.x - p.x) + d.y * (t.y - p.y) > 0
  })
  return phi === undefined ? null : onCircle(c, r, phi)
}

/** Where the vehicle leaves the circle heading straight for `q` (ArduPlane's heading check). */
export function exitTangent(q: Xy, c: Xy, r: number, cw: boolean): Xy | null {
  const phis = tangentAngles(q, c, r)
  if (!phis) return null
  const phi = phis.find((a) => {
    const e = onCircle(c, r, a)
    const d = travelDir(a, cw)
    return d.x * (q.x - e.x) + d.y * (q.y - e.y) > 0
  })
  return phi === undefined ? null : onCircle(c, r, phi)
}

/** Polar angles from `from` to `to` in the flying direction plus `turns` whole circles, about `stepDeg` apart. */
export function arcAngles(from: number, to: number, cw: boolean, turns: number, stepDeg: number): number[] {
  const raw = cw ? from - to : to - from
  const sweep = (((raw % TAU) + TAU) % TAU) + Math.max(0, turns) * TAU
  const n = Math.max(1, Math.ceil(sweep / (stepDeg * RAD)))
  const sign = cw ? -1 : 1
  return Array.from({ length: n + 1 }, (_, k) => from + (sign * sweep * k) / n)
}

/**
 * The corner at `b` rounded with radius `r` (a fixed wing turns before the waypoint). The tangent
 * length is capped at half of the shorter leg, which shrinks the radius on short legs.
 */
export function fillet(a: Xy, b: Xy, c: Xy, r: number): Xy[] {
  const l1 = dist(a, b)
  const l2 = dist(b, c)
  if (l1 === 0 || l2 === 0 || r <= 0) return [b]
  const d1 = { x: (b.x - a.x) / l1, y: (b.y - a.y) / l1 }
  const d2 = { x: (c.x - b.x) / l2, y: (c.y - b.y) / l2 }
  const cross = d1.x * d2.y - d1.y * d2.x
  const theta = Math.atan2(Math.abs(cross), d1.x * d2.x + d1.y * d2.y)
  if (theta < MIN_TURN_RAD) return [b]
  const half = Math.tan(theta / 2)
  const t = Math.min(r * half, Math.min(l1, l2) / 2)
  const radius = t / half
  const p1 = { x: b.x - d1.x * t, y: b.y - d1.y * t }
  const p2 = { x: b.x + d2.x * t, y: b.y + d2.y * t }
  const cw = cross < 0
  const n = cw ? { x: d1.y, y: -d1.x } : { x: -d1.y, y: d1.x }
  const centre = { x: p1.x + n.x * radius, y: p1.y + n.y * radius }
  const angles = arcAngles(polar(centre, p1), polar(centre, p2), cw, 0, 5)
  return angles.map((phi, k) => (k === 0 ? p1 : k === angles.length - 1 ? p2 : onCircle(centre, radius, phi)))
}
