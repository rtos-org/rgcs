// Small time-step simulations of AP_L1_Control (ArduPilot master, 2026-10-20): update_loiter for the
// capture onto a loiter circle and update_waypoint for following the line of a leg. The geometric
// shapes cut corners where the SITL plane swung wide (it rolls in over about a second, captures a
// circle well outside it and overshoots a sharp waypoint turn). No wind: ground speed = true airspeed.
import { dist, polar, type Xy } from './geom'

export interface L1Gains {
  /** NAVL1_PERIOD (s) and NAVL1_DAMPING. */
  readonly period: number
  readonly damping: number
  /** ROLL_LIMIT_DEG caps the lateral acceleration at g·tan(limit). */
  readonly rollLimitDeg: number
}

const G = 9.80665
const DT = 0.1
/**
 * Roll-in lag (s): RLL2SRV_TCONST is 0.5 s, but the SITL QuadPlane ("Reached waypoint #2 dist 88m",
 * 2026-10-20) only matched its 438 m overshoot with about 1 s, roll rate and airframe included.
 */
const ROLL_TAU = 1.0
const MAX_STEPS = 1800
/** Line following runs on legs of up to 700-waypoint missions, so it steps coarser. */
const LINE_DT = 0.25
const LINE_MAX_STEPS = 720
/** On the line: cross-track error (m), heading error (rad) and lateral acceleration (m/s²) this small. */
const ON_LINE_M = 1
const ON_LINE_RAD = 0.02
const ON_LINE_ACC = 0.3
/** sin 45°: update_waypoint's track capture angle limit. */
const SIN_45 = 0.7071
/** Sampling of the returned path (m). */
const SAMPLE_M = 10
/** On the circle: radial error and radial speed small enough to hand over to the circle walk. */
const ON_CIRCLE_M = 2
const ON_CIRCLE_RADIAL = 0.1

/** The simulated plane: position, compass heading (rad) and the lateral acceleration it has rolled to. */
interface Flight {
  readonly pos: Xy
  readonly psi: number
  readonly acc: number
}

const velocity = (f: Flight, v: number): Xy => ({ x: v * Math.sin(f.psi), y: v * Math.cos(f.psi) })

/** One time step: the bank lags the (roll limited) demand by ROLL_TAU, then the plane turns and moves. */
function advance(f: Flight, want: number, v: number, maxAcc: number, dt: number): Flight {
  const acc = f.acc + ((Math.max(-maxAcc, Math.min(maxAcc, want)) - f.acc) * dt) / ROLL_TAU
  const psi = f.psi + (acc / v) * dt
  return { pos: { x: f.pos.x + v * Math.sin(psi) * dt, y: f.pos.y + v * Math.cos(psi) * dt }, psi, acc }
}

const maxAccOf = (g: L1Gains) => G * Math.tan((g.rollLimitDeg * Math.PI) / 180)

interface Demand {
  readonly acc: number
  readonly circle: boolean
  readonly xtrack: number
  readonly radialVel: number
}

/** Lateral acceleration demand (+ = right turn) in north/east axes, as update_loiter computes it. */
function demand(pos: Xy, vel: Xy, c: Xy, r: number, cw: boolean, g: L1Gains): Demand {
  const dir = cw ? 1 : -1
  const omega = (2 * Math.PI) / g.period
  const kx = omega * omega
  const kv = 2 * g.damping * omega
  const kL1 = 4 * g.damping * g.damping
  const v = Math.max(Math.hypot(vel.x, vel.y), 1)
  const l1Dist = (g.damping * g.period * v) / Math.PI
  // north/east components, like the source (x north, y east there)
  const an = pos.y - c.y
  const ae = pos.x - c.x
  const len = Math.hypot(an, ae)
  const un = len > 0.1 ? an / len : vel.y / v
  const ue = len > 0.1 ? ae / len : vel.x / v
  const vn = vel.y
  const ve = vel.x
  const xtrackVelCap = un * ve - ue * vn
  const ltrackVelCap = -(vn * un + ve * ue)
  const nu = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, Math.atan2(xtrackVelCap, ltrackVelCap)))
  const accCap = ((kL1 * v * v) / l1Dist) * Math.sin(nu)
  const xtrackVelCirc = -ltrackVelCap
  const xtrackErrCirc = len - r
  let pd = xtrackErrCirc * kx + xtrackVelCirc * kv
  const velTangent = xtrackVelCap * dir
  const ctr = (velTangent * velTangent) / Math.max(0.5 * r, r + xtrackErrCirc)
  if (ltrackVelCap < 0) {
    if (velTangent < 0) pd = Math.max(pd, 0)
    else if (xtrackErrCirc < 0) pd = Math.max(pd, -ctr)
  }
  const accCirc = dir * (pd + ctr)
  const capture = xtrackErrCirc > 0 && dir * accCap < dir * accCirc
  return { acc: capture ? accCap : accCirc, circle: !capture, xtrack: xtrackErrCirc, radialVel: xtrackVelCirc }
}

/**
 * Flies from `start` (unit `heading`, speed `v`) onto the circle `c`/`r`; returns the path sampled
 * every ~10 m (starting at `start`) and the polar angle where it joined the circle.
 */
export function captureLoiter(start: Xy, heading: Xy, c: Xy, r: number, cw: boolean, v: number, g: L1Gains): { pts: Xy[]; phi: number } {
  const maxAcc = maxAccOf(g)
  let f: Flight = { pos: start, psi: Math.atan2(heading.x, heading.y), acc: 0 }
  const pts: Xy[] = [start]
  for (let k = 0; k < MAX_STEPS; k++) {
    const d = demand(f.pos, velocity(f, v), c, r, cw, g)
    if (d.circle && Math.abs(d.xtrack) < ON_CIRCLE_M && Math.abs(d.radialVel) < ON_CIRCLE_RADIAL * v) break
    f = advance(f, d.acc, v, maxAcc, DT)
    if (dist(pts.at(-1)!, f.pos) >= SAMPLE_M) pts.push(f.pos)
  }
  if (dist(pts.at(-1)!, f.pos) > 0) pts.push(f.pos)
  return { pts, phi: polar(c, pts.at(-1)!) }
}

/** Cross product in the source's north/east axes (`a % b`), for x east / y north vectors. */
const crossNE = (a: Xy, b: Xy) => a.y * b.x - a.x * b.y
const dot = (a: Xy, b: Xy) => a.x * b.x + a.y * b.y
const unit = (a: Xy): Xy => {
  const len = Math.hypot(a.x, a.y)
  return len > 0 ? { x: a.x / len, y: a.y / len } : { x: 0, y: 0 }
}
/** Nu for flying straight at a point (`away`: unit vector from it to the plane). */
const nuTo = (vel: Xy, away: Xy) => Math.atan2(crossNE(vel, { x: -away.x, y: -away.y }), dot(vel, { x: -away.x, y: -away.y }))

interface LineState {
  /** Bearing error to the L1 point (+ = turn right), before the ±90° limit. */
  readonly nu: number
  readonly along: number
  readonly xtrack: number
  /** Heading error against the line. */
  readonly nu2: number
}

/**
 * update_waypoint's Nu for the line `a` → `b` (no xtrack integrator: NAVL1_XTRACK_I is 0 by default).
 * Its "3 s past B" branch never runs here: the leg ends at B's finish line.
 */
function lineNu(pos: Xy, vel: Xy, a: Xy, b: Xy, l1Dist: number): LineState {
  const abLen = dist(a, b)
  const ab = unit(abLen > 1e-6 ? { x: b.x - a.x, y: b.y - a.y } : { x: b.x - pos.x, y: b.y - pos.y })
  const aAir = { x: pos.x - a.x, y: pos.y - a.y }
  const xtrack = crossNE(aAir, ab)
  const along = dot(aAir, ab)
  const aDist = Math.hypot(aAir.x, aAir.y)
  const nu2 = Math.atan2(crossNE(vel, ab), dot(vel, ab))
  if (aDist > l1Dist && along / Math.max(aDist, 1) < -SIN_45) return { nu: nuTo(vel, unit(aAir)), along, xtrack, nu2 }
  const sinNu1 = Math.max(-SIN_45, Math.min(SIN_45, xtrack / Math.max(l1Dist, 0.1)))
  return { nu: Math.asin(sinNu1) + nu2, along, xtrack, nu2 }
}

/** _prevent_indecision: near ±180° keep the side already chosen while pointing away from `b`. */
function decided(nu: number, lastNu: number, f: Flight, b: Xy): number {
  const limit = 0.9 * Math.PI
  const toB = Math.atan2(b.x - f.pos.x, b.y - f.pos.y)
  const off = Math.abs(Math.atan2(Math.sin(toB - f.psi), Math.cos(toB - f.psi)))
  return Math.abs(nu) > limit && Math.abs(lastNu) > limit && off > (2 * Math.PI) / 3 && nu * lastNu < 0 ? lastNu : nu
}

/**
 * Flies from `start` (unit `heading`, speed `v`) along the leg `a` → `b` like update_waypoint, until
 * the plane is on the line (heading along it), within `accept` metres of `b` (verify_nav_wp) or past
 * `b`'s finish line. Returns the path sampled every ~10 m, starting at `start`.
 */
export function trackLine(start: Xy, heading: Xy, a: Xy, b: Xy, v: number, g: L1Gains, accept: number): Xy[] {
  const maxAcc = maxAccOf(g)
  const kL1 = 4 * g.damping * g.damping
  const l1Dist = (g.damping * g.period * v) / Math.PI
  const abLen = dist(a, b)
  let f: Flight = { pos: start, psi: Math.atan2(heading.x, heading.y), acc: 0 }
  let lastNu = 0
  const pts: Xy[] = [start]
  for (let k = 0; k < LINE_MAX_STEPS; k++) {
    const s = lineNu(f.pos, velocity(f, v), a, b, l1Dist)
    const onLine = Math.abs(s.xtrack) < ON_LINE_M && Math.abs(s.nu2) < ON_LINE_RAD && Math.abs(f.acc) < ON_LINE_ACC
    if (onLine || dist(f.pos, b) <= accept || s.along >= abLen) break
    const nu = decided(s.nu, lastNu, f, b)
    lastNu = nu
    const clamped = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, nu))
    f = advance(f, ((kL1 * v * v) / l1Dist) * Math.sin(clamped), v, maxAcc, LINE_DT)
    if (dist(pts.at(-1)!, f.pos) >= SAMPLE_M) pts.push(f.pos)
  }
  if (dist(pts.at(-1)!, f.pos) > 0) pts.push(f.pos)
  return pts
}
