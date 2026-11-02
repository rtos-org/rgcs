// Survey lanes: parallel shooting sections that cover a polygon. Pure flat-earth geometry in a
// frame rotated so x runs along the lanes (angle = compass bearing of the lane direction).
import { fromLocal, toLocal, type Xy } from '../mission/arc'
import type { LatLon } from '../mission/geo'

export interface Lane {
  /** Start of the shooting section (including the along-track margin); a → b runs in +x. */
  readonly a: LatLon
  readonly b: LatLon
  /** Across-track offset (m) in the rotated frame, centred on the polygon. */
  readonly y: number
}

const RAD = Math.PI / 180
/** More lanes than this are never built (a survey that big is refused as too large). */
export const MAX_LANES = 1000
const MIN_AREA_M2 = 1
/** Keeps the scan line strictly inside the polygon at its extreme lanes. */
const EDGE_INSET_M = 0.01
const ORDER_TOL_M = 0.01
/** An exact multiple of the spacing (up to float noise) does not gain a lane. */
const CEIL_EPS = 1e-9

function ring(polygon: readonly LatLon[]): readonly Xy[] {
  return polygon.map((p) => toLocal(polygon[0], p))
}

function shoelace(pts: readonly Xy[]): number {
  let s = 0
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]
    const q = pts[(i + 1) % pts.length]
    s += p.x * q.y - q.x * p.y
  }
  return Math.abs(s) / 2
}

export function polygonAreaM2(polygon: readonly LatLon[]): number {
  return polygon.length < 3 ? 0 : shoelace(ring(polygon))
}

const cross = (o: Xy, a: Xy, b: Xy) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)

function segmentsCross(a: Xy, b: Xy, c: Xy, d: Xy): boolean {
  const d1 = cross(a, b, c)
  const d2 = cross(a, b, d)
  const d3 = cross(c, d, a)
  const d4 = cross(c, d, b)
  return d1 * d2 < 0 && d3 * d4 < 0
}

function selfIntersects(pts: readonly Xy[]): boolean {
  const n = pts.length
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue // adjacent through the closing edge
      if (segmentsCross(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) return true
    }
  }
  return false
}

/** Sorted x of the ring's crossings with the horizontal line at `y` (even count, paired in/out). */
function crossingsAt(pts: readonly Xy[], y: number): readonly number[] {
  const xs: number[] = []
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]
    const q = pts[(i + 1) % pts.length]
    if (p.y <= y !== q.y <= y) xs.push(p.x + ((y - p.y) / (q.y - p.y)) * (q.x - p.x))
  }
  return xs.sort((a, b) => a - b)
}

/** The lane rows across `polygon` at this spacing (cheap: what buildLanes would scan). */
export function laneRows(polygon: readonly LatLon[], angleDeg: number, spacingM: number, marginAcrossM: number): number {
  if (polygon.length < 3 || !(spacingM > 0)) return 0
  const v = { x: Math.cos(angleDeg * RAD), y: -Math.sin(angleDeg * RAD) }
  const ys = ring(polygon).map((p) => p.x * v.x + p.y * v.y)
  return Math.max(1, Math.ceil((Math.max(...ys) - Math.min(...ys) + 2 * marginAcrossM) / spacingM - CEIL_EPS))
}

/**
 * Lanes covering `polygon`, sorted by y then x; null when the polygon is invalid (< 3 vertices,
 * area < 1 m², self-intersecting) or needs more than MAX_LANES rows. `marginAcrossM` widens the
 * covered band on both sides.
 */
export function buildLanes(
  polygon: readonly LatLon[],
  angleDeg: number,
  spacingM: number,
  marginAlongM: number,
  marginAcrossM: number,
): Lane[] | null {
  if (polygon.length < 3 || !(spacingM > 0) || laneRows(polygon, angleDeg, spacingM, marginAcrossM) > MAX_LANES) return null
  const local = ring(polygon)
  if (shoelace(local) < MIN_AREA_M2 || selfIntersects(local)) return null
  const o = polygon[0]
  const u = { x: Math.sin(angleDeg * RAD), y: Math.cos(angleDeg * RAD) } // along the lanes
  const v = { x: u.y, y: -u.x } // across, to the right of travel
  const rot = local.map((p) => ({ x: p.x * u.x + p.y * u.y, y: p.x * v.x + p.y * v.y }))
  const ys = rot.map((p) => p.y)
  const yMin = Math.min(...ys)
  const yMax = Math.max(...ys)
  const n = Math.max(1, Math.ceil((yMax - yMin + 2 * marginAcrossM) / spacingM - CEIL_EPS))
  const mid = (yMin + yMax) / 2
  const toLatLon = (x: number, y: number) => fromLocal(o, { x: x * u.x + y * v.x, y: x * u.y + y * v.y })
  const lanes: Lane[] = []
  for (let i = 0; i < n; i++) {
    const y = mid + (i - (n - 1) / 2) * spacingM
    const xs = crossingsAt(rot, Math.min(yMax - EDGE_INSET_M, Math.max(yMin + EDGE_INSET_M, y)))
    for (let k = 0; k + 1 < xs.length; k += 2) {
      lanes.push({ a: toLatLon(xs[k] - marginAlongM, y), b: toLatLon(xs[k + 1] + marginAlongM, y), y })
    }
  }
  return lanes
}

/**
 * Visiting order (indices into `lanes`, as returned by buildLanes): start at 0, then the nearest
 * remaining lane at least (skip + 1) spacings away, else the farthest remaining. Ties: lower index.
 */
export function orderLanes(lanes: readonly Lane[], skip: number, spacingM: number): number[] {
  const need = (skip + 1) * spacingM - ORDER_TOL_M
  const left = new Set(lanes.keys())
  const order: number[] = []
  let cur = 0
  while (left.size > 0) {
    if (order.length > 0) cur = pickNext(lanes, left, cur, need)
    left.delete(cur)
    order.push(cur)
  }
  return order
}

function pickNext(lanes: readonly Lane[], left: ReadonlySet<number>, cur: number, need: number): number {
  const ranked = [...left].map((i) => ({ i, d: Math.abs(lanes[i].y - lanes[cur].y) })).sort((p, q) => p.d - q.d || p.i - q.i)
  const near = ranked.find((r) => r.d >= need)
  return near ? near.i : ranked.reduce((best, r) => (r.d > best.d ? r : best)).i
}
