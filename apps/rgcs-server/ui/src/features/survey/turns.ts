// Survey turns: the path from the end of one lane to the start of the next (flown the opposite
// way). Pure flat-earth geometry in the local frame of features/mission/arc.ts (x = east,
// y = north, metres). A U turn when the lanes are at least 2R apart, else an Ω turn.
import type { Xy } from '../mission/arc'

/**
 * One circular arc of a turn. `from` is the start angle (degrees) of the arc about `center`, as a
 * maths angle: 0 = east (+x), counter-clockwise positive. `sweepDeg` is signed like
 * NAV_ARC_WAYPOINT param1 and `arcPoints`: clockwise (seen from above) is +, so a + sweep runs
 * through decreasing maths angles.
 */
export interface TurnArc {
  readonly center: Xy
  readonly r: number
  readonly from: number
  readonly sweepDeg: number
}

export interface TurnPath {
  readonly kind: 'u' | 'omega'
  /** The whole turn for drawing: run-out, arcs (and straight), run-in, from `end` to `start`. */
  readonly points: readonly Xy[]
  /** The arcs in flight order; anything between them is straight. */
  readonly arcs: readonly TurnArc[]
}

/** Largest angle of one split-WP arc segment. */
export const ARC_SPLIT_DEG = 30
/** Largest angle between two drawn points of an arc. */
const DRAW_STEP_DEG = 5
const SAME_POINT_M = 1e-6
const RAD = Math.PI / 180

/** The point at maths angle `deg` on the arc's circle. */
function onArc(arc: TurnArc, deg: number): Xy {
  return { x: arc.center.x + arc.r * Math.cos(deg * RAD), y: arc.center.y + arc.r * Math.sin(deg * RAD) }
}

export function arcStart(arc: TurnArc): Xy {
  return onArc(arc, arc.from)
}

export function arcEnd(arc: TurnArc): Xy {
  return onArc(arc, arc.from - arc.sweepDeg)
}

/** The arc start followed by `n` evenly spaced points up to its end. */
function sampleArc(arc: TurnArc, n: number): Xy[] {
  return Array.from({ length: n + 1 }, (_, i) => onArc(arc, arc.from - (arc.sweepDeg * i) / n))
}

const segments = (sweepDeg: number, maxDeg: number) => Math.max(1, Math.ceil(Math.abs(sweepDeg) / maxDeg - 1e-9))

/** End points of segments of at most ARC_SPLIT_DEG along the arc, excluding the arc start. */
export function splitArc(arc: TurnArc): Xy[] {
  return sampleArc(arc, segments(arc.sweepDeg, ARC_SPLIT_DEG)).slice(1)
}

/**
 * The lane frame: X along the finished lane from its far end (x_turn), Y towards the next lane.
 * Its handedness follows `side` (+1 = next lane on the left), so mirroring is built in.
 */
interface Frame {
  readonly origin: Xy
  readonly u: Xy
  readonly v: Xy
  readonly side: number
}

function toWorld(f: Frame, p: Xy): Xy {
  return { x: f.origin.x + p.x * f.u.x + p.y * f.v.x, y: f.origin.y + p.x * f.u.y + p.y * f.v.y }
}

/** An arc built in the lane frame (sweep + = clockwise there) placed in the world. */
function arcToWorld(f: Frame, center: Xy, fromDeg: number, sweepDeg: number, r: number): TurnArc {
  const dir = toWorld({ ...f, origin: { x: 0, y: 0 } }, { x: Math.cos(fromDeg * RAD), y: Math.sin(fromDeg * RAD) })
  return { center: toWorld(f, center), r, from: Math.atan2(dir.y, dir.x) / RAD, sweepDeg: f.side * sweepDeg }
}

/** U turn in the lane frame: quarter arc, straight of d − 2R, quarter arc (counter-clockwise). */
function uArcs(f: Frame, d: number, r: number): TurnArc[] {
  return [arcToWorld(f, { x: 0, y: r }, -90, -90, r), arcToWorld(f, { x: 0, y: d - r }, 0, -90, r)]
}

/** Ω turn in the lane frame: C1 = (0, −R) cw, C2 = (√(4R² − (d/2 + R)²), d/2) ccw, C3 = (0, d + R) cw. */
function omegaArcs(f: Frame, d: number, r: number): TurnArc[] {
  const h = d / 2 + r
  const cx = Math.sqrt(Math.max(0, 4 * r * r - h * h))
  const phi = Math.atan2(h, cx) / RAD // direction C1 → C2
  return [
    arcToWorld(f, { x: 0, y: -r }, 90, 90 - phi, r),
    arcToWorld(f, { x: cx, y: d / 2 }, 180 + phi, -(360 - 2 * phi), r),
    arcToWorld(f, { x: 0, y: d + r }, -phi, 90 - phi, r),
  ]
}

function laneFrame(end: Xy, start: Xy, headingDeg: number): { frame: Frame; d: number } {
  const u = { x: Math.sin(headingDeg * RAD), y: Math.cos(headingDeg * RAD) }
  const left = { x: -u.y, y: u.x }
  const rel = { x: start.x - end.x, y: start.y - end.y }
  const along = rel.x * u.x + rel.y * u.y
  const across = rel.x * left.x + rel.y * left.y
  const side = across < 0 ? -1 : 1
  const xTurn = Math.max(0, along)
  const origin = { x: end.x + xTurn * u.x, y: end.y + xTurn * u.y }
  return { frame: { origin, u, v: { x: side * left.x, y: side * left.y }, side }, d: Math.abs(across) }
}

function drawPoints(end: Xy, start: Xy, arcs: readonly TurnArc[]): Xy[] {
  const all = [end, ...arcs.flatMap((a) => sampleArc(a, segments(a.sweepDeg, DRAW_STEP_DEG))), start]
  return all.filter((p, i) => i === 0 || Math.hypot(p.x - all[i - 1].x, p.y - all[i - 1].y) > SAME_POINT_M)
}

/**
 * The turn from `end` (finishing a lane flown at compass bearing `headingDeg`) to `start` (the
 * next lane, flown the opposite way) with turn radius `radiusM`. The turn begins at x_turn, the
 * farther of the two lane ends along track; straight run-outs join both ends to it.
 */
export function planTurn(end: Xy, start: Xy, headingDeg: number, radiusM: number): TurnPath {
  const { frame, d } = laneFrame(end, start, headingDeg)
  const kind = d >= 2 * radiusM ? 'u' : 'omega'
  const arcs = kind === 'u' ? uArcs(frame, d, radiusM) : omegaArcs(frame, d, radiusM)
  return { kind, points: drawPoints(end, start, arcs), arcs }
}
