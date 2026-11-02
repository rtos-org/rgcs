// Predicted ArduPlane / QuadPlane path in AUTO from the mission and the vehicle's parameters
// (source behaviour checked against ArduPilot master 2026-10-20: ArduPlane/commands_logic.cpp,
// navigation.cpp, altitude.cpp, quadplane.cpp, AP_Mission.cpp). An estimate: wind is ignored.
import type { Home, MissionItem } from '../../shared/api/types'
import type { LatLon } from '../mission/geo'
import { arcAngles, dist, entryTangent, exitTangent, fillet, onCircle, polar, toLatLon, toXy, travelDir, type Xy } from './geom'
import { captureLoiter, trackLine, type L1Gains } from './l1'
import type { PlaneParams } from './params'
import { Track } from './track'

export interface PathPoint extends LatLon {
  /** Metres above home. */
  readonly alt: number
}

const G = 9.80665
const RAD = Math.PI / 180
const STEP_DEG = 10
/** LOITER_TO_ALT is done within this many metres (navigation.cpp). */
const TO_ALT_TOLERANCE_M = 5
const MAX_TURNS = 50
/** The L1 capture ended this close to the circle (else it timed out far away). */
const CAPTURED_M = 5
/** Pure-pursuit step when converging onto a line after a loiter (L1 tracking). */
const PURSUIT_STEP_M = 10
const PURSUIT_MAX_STEPS = 300
/** WP_LOITER_RAD at or below 1 m means the built-in 60 m. */
const FALLBACK_LOITER_M = 60
const Q_ALLOW_FW_TAKEOFF = 1 << 1
const Q_ALLOW_FW_LAND = 1 << 2

const CMD = { WAYPOINT: 16, LOITER_UNLIM: 17, LOITER_TURNS: 18, LOITER_TIME: 19, RTL: 20, LAND: 21, TAKEOFF: 22, LOITER_TO_ALT: 31, ARC: 36, SPLINE: 82, VTOL_TAKEOFF: 84, VTOL_LAND: 85, VTOL_TRANSITION: 3000 } as const
const WAYPOINTS: readonly number[] = [CMD.WAYPOINT, CMD.ARC, CMD.SPLINE]
const LOITERS: readonly number[] = [CMD.LOITER_UNLIM, CMD.LOITER_TURNS, CMD.LOITER_TIME, CMD.LOITER_TO_ALT]
const FLOWN_TO: readonly number[] = [...WAYPOINTS, ...LOITERS, CMD.LAND, CMD.VTOL_LAND]
const TAKEOFFS: readonly number[] = [CMD.TAKEOFF, CMD.VTOL_TAKEOFF]
const MAV_VTOL_STATE_MC = 3
const MAV_VTOL_STATE_FW = 4

interface Ctx {
  readonly items: readonly MissionItem[]
  readonly home: Home
  readonly p: PlaneParams
  readonly track: Track
}

const located = (it: MissionItem) => !(it.lat === 0 && it.lon === 0)
const relAlt = (ctx: Ctx, it: MissionItem) => (it.frame === 'abs' ? it.alt - ctx.home.alt : it.alt)
const xyOf = (ctx: Ctx, it: MissionItem): Xy => toXy(ctx.home, it)
const loiterDefault = (p: PlaneParams) => (Math.abs(p.loiterRad) > 1 ? Math.abs(p.loiterRad) : FALLBACK_LOITER_M)

/** The next item the vehicle flies to after item `i` (RTL included), or null. */
function nextFlown(ctx: Ctx, i: number): MissionItem | null {
  return ctx.items.slice(i + 1).find((it) => it.command === CMD.RTL || (FLOWN_TO.includes(it.command) && located(it))) ?? null
}

/** The next place the vehicle flies to after item `i` (home for RTL), or null. */
function nextTarget(ctx: Ctx, i: number): Xy | null {
  const it = nextFlown(ctx, i)
  if (!it) return null
  return it.command === CMD.RTL ? { x: 0, y: 0 } : xyOf(ctx, it)
}

/**
 * Radius and direction of a loiter item (AP_Mission.cpp packing, navigation.cpp fallback). L1
 * flies the radius scaled by EAS2TAS² (`scale`: EAS2TAS at the loiter altitude).
 */
function loiterShape(p: PlaneParams, it: MissionItem, scale: number): { r: number; cw: boolean } {
  const given = it.command === CMD.LOITER_TO_ALT ? it.params[1] : it.params[2]
  const ccw = given < 0
  const own = it.command === CMD.LOITER_TIME ? 0 : Math.abs(given)
  const k = scale * scale
  if (own > 1) return { r: own * k, cw: !ccw }
  return { r: loiterDefault(p) * k, cw: !(ccw || p.loiterRad < 0) }
}

/**
 * After a loiter with xtrack 0 the next leg starts at the centre (commands.cpp `set_next_WP`):
 * L1 pulls the plane onto the line `a` → `b`, aiming a look-ahead distance along it.
 */
function pursue(ctx: Ctx, a: Xy, b: Xy, alt: number): void {
  const { track, p } = ctx
  const len = dist(a, b)
  if (len === 0) return
  const dir = { x: (b.x - a.x) / len, y: (b.y - a.y) / len }
  const look = ((p.navL1Damping * p.navL1Period) / Math.PI) * track.tas()
  for (let k = 0; k < PURSUIT_MAX_STEPS; k++) {
    const at = track.cur
    const along = (at.x - a.x) * dir.x + (at.y - a.y) * dir.y
    const off = Math.abs((at.x - a.x) * dir.y - (at.y - a.y) * dir.x)
    if (off < 1 || along + look >= len) return
    const aim = { x: a.x + dir.x * (along + look), y: a.y + dir.y * (along + look) }
    const d = dist(at, aim)
    track.step({ x: at.x + ((aim.x - at.x) / d) * PURSUIT_STEP_M, y: at.y + ((aim.y - at.y) / d) * PURSUIT_STEP_M }, alt)
  }
}

/** The tightest fixed-wing turn at the current true airspeed: v² / (g·tan ROLL_LIMIT). */
function turnRadius(ctx: Ctx): number {
  const v = ctx.track.tas()
  return (v * v) / (G * Math.tan(ctx.p.rollLimitDeg * RAD))
}

/**
 * L1 loiter capture (AP_L1_Control::update_loiter): the plane heads for the centre and turns onto
 * the near side of the circle (SITL 2026-10-20 also cut ~10 m inside a 145 m circle; not modelled).
 */
function captureLeg(ctx: Ctx, c: Xy, r: number, cw: boolean): Xy[] {
  const cur = ctx.track.cur
  const rt = turnRadius(ctx)
  const phi = polar(c, cur)
  const near = onCircle(c, r, phi)
  if (dist(cur, c) <= r + rt) return [near]
  const dir = travelDir(phi, cw)
  return fillet(cur, near, { x: near.x + dir.x * 4 * rt, y: near.y + dir.y * 4 * rt }, rt)
}

/** Walks the circle through `angles` holding `target` altitude (TECS makes the spiral). */
function walk(ctx: Ctx, c: Xy, r: number, angles: readonly number[], target: number): void {
  for (const phi of angles.slice(1)) ctx.track.step(onCircle(c, r, phi), target)
}

function loiter(ctx: Ctx, i: number, it: MissionItem): boolean {
  const { track, p } = ctx
  const c = xyOf(ctx, it)
  const target = relAlt(ctx, it)
  if (track.vtol) {
    track.leg([c], target)
    track.vertical(target)
    return it.command !== CMD.LOITER_UNLIM
  }
  const { r, cw } = loiterShape(p, it, track.scale(target))
  const heading = track.heading()
  const capture = heading ? captureLoiter(track.cur, heading, c, r, cw, track.tas(), gains(p)).pts.slice(1) : captureLeg(ctx, c, r, cw)
  if (capture.length === 0) capture.push(onCircle(c, r, polar(c, track.cur)))
  // the altitude slope of the leg runs to the centre (altitude.cpp), so the circle comes first
  track.leg(capture, target, dist(track.cur, c))
  let phi = polar(c, capture[capture.length - 1]!)
  const circle = (2 * Math.PI * r) / track.tas()
  if (it.command === CMD.LOITER_UNLIM) {
    walk(ctx, c, r, arcAngles(phi, phi, cw, 1, STEP_DEG), target)
    return false
  }
  if (it.command === CMD.LOITER_TO_ALT) {
    for (let k = 0; k < MAX_TURNS * (360 / STEP_DEG) && Math.abs(track.cur.alt - target) > TO_ALT_TOLERANCE_M; k++) {
      const next = phi + (cw ? -1 : 1) * STEP_DEG * RAD
      track.step(onCircle(c, r, next), target)
      phi = next
    }
  } else {
    const turns = it.command === CMD.LOITER_TURNS ? it.params[0] : it.params[0] / circle
    const sweep = Math.min(MAX_TURNS, Math.max(0, turns)) * 2 * Math.PI
    const end = phi + (cw ? -sweep : sweep)
    walk(ctx, c, r, arcAngles(phi, end, cw, Math.floor(sweep / (2 * Math.PI) + 1e-9), STEP_DEG), target)
    phi = end
  }
  const next = nextTarget(ctx, i)
  const exit = next ? exitTangent(next, c, r, cw) : null
  if (exit) walk(ctx, c, r, arcAngles(phi, polar(c, exit), cw, 0, STEP_DEG), target)
  // param4 > 0: track from the tangent exit (straight on); 0: from the centre (converge onto c → next)
  if (exit && next && it.params[3] <= 0) pursue(ctx, c, next, target)
  return true
}

/** The navigation gains the L1 simulations fly with. */
const gains = (p: PlaneParams): L1Gains => ({ period: p.navL1Period, damping: p.navL1Damping, rollLimitDeg: p.rollLimitDeg })

/** Where the leg to item `i` starts (set_next_WP): the previous waypoint, a loiter centre left with xtrack 0, else here. */
function lineStart(ctx: Ctx, i: number): Xy | null {
  const prev = ctx.items.slice(0, i).findLast((it) => (FLOWN_TO.includes(it.command) && located(it)) || TAKEOFFS.includes(it.command))
  if (!prev || TAKEOFFS.includes(prev.command)) return null
  if (WAYPOINTS.includes(prev.command) || (LOITERS.includes(prev.command) && prev.params[3] <= 0)) return xyOf(ctx, prev)
  return null
}

/** NAV_WAYPOINT param2: AP_Mission keeps the acceptance radius in a byte (whole metres, at most 255). */
const acceptRadius = (it: MissionItem): number => Math.min(255, Math.max(0, Math.trunc(it.params[1])))

/**
 * verify_nav_wp accepts `wp` at the item's acceptance radius (param2) when set, else turn_distance
 * out: min(WP_RADIUS·EAS2TAS², L1 distance), scaled down for turns under 90°; with nothing to fly
 * next (the mission ends) the turn counts as 90°.
 */
function acceptDistance(ctx: Ctx, a: Xy, wp: Xy, next: Xy | null, radius: number): number {
  if (radius > 0) return radius
  const { track, p } = ctx
  const l1Dist = ((p.navL1Damping * p.navL1Period) / Math.PI) * track.tas()
  const d90 = Math.min(p.wpRadius * track.scale() ** 2, l1Dist)
  if (!next) return d90
  const turn = Math.abs(Math.atan2((wp.x - a.x) * (next.y - wp.y) - (wp.y - a.y) * (next.x - wp.x), (wp.x - a.x) * (next.x - wp.x) + (wp.y - a.y) * (next.y - wp.y)))
  return d90 * Math.min(1, turn / (Math.PI / 2))
}

/**
 * A fixed-wing leg to `wp` (AP_L1_Control::update_waypoint on the line `a` → `wp`): the turn onto
 * the line simulated from the current heading, then straight on until the waypoint is accepted.
 */
function l1Leg(ctx: Ctx, a: Xy, wp: Xy, next: Xy | null, radius: number): Xy[] {
  const { track } = ctx
  const accept = acceptDistance(ctx, dist(a, wp) > 0 ? a : track.cur, wp, next, radius)
  const heading = track.heading()
  const turn = heading ? trackLine(track.cur, heading, a, wp, track.tas(), gains(ctx.p), accept).slice(1) : []
  const end = turn.at(-1) ?? track.cur
  const len = dist(end, wp)
  const along = (wp.x - a.x) * (end.x - a.x) + (wp.y - a.y) * (end.y - a.y)
  if (len <= accept || along >= dist(a, wp) ** 2) return turn
  return [...turn, { x: wp.x + ((end.x - wp.x) / len) * accept, y: wp.y + ((end.y - wp.y) / len) * accept }]
}

function waypoint(ctx: Ctx, i: number, it: MissionItem): void {
  const { track } = ctx
  const wp = xyOf(ctx, it)
  const next = nextTarget(ctx, i)
  const alt = relAlt(ctx, it)
  if (track.vtol) track.leg([wp], alt)
  else if (it.command === CMD.WAYPOINT) track.leg(l1Leg(ctx, lineStart(ctx, i) ?? track.cur, wp, next, acceptRadius(it)), alt)
  // arc and spline waypoints keep the geometric corner
  else track.leg(next ? fillet(track.cur, wp, next, turnRadius(ctx)) : [wp], alt)
}

function takeoff(ctx: Ctx, i: number, it: MissionItem): void {
  const { track, p } = ctx
  const target = relAlt(ctx, it)
  if (it.command === CMD.VTOL_TAKEOFF || (p.quadplane && (p.qOptions & Q_ALLOW_FW_TAKEOFF) === 0)) return track.vertical(target)
  // fixed wing: climbs along its heading (taken here as toward the next waypoint) at the TECS rate
  const cur = track.cur
  const next = nextTarget(ctx, i)
  const len = next ? Math.hypot(next.x - cur.x, next.y - cur.y) : 0
  const dir = next && len > 0 ? { x: (next.x - cur.x) / len, y: (next.y - cur.y) / len } : { x: 0, y: 1 }
  // a straight climb at TECS_CLMB_MAX; the true airspeed at mid-climb sets how far that takes
  const rise = Math.max(0, target - cur.alt)
  const run = (rise * p.airspeed * track.scale(cur.alt + rise / 2)) / p.climb
  const n = Math.max(1, Math.ceil(run / 20))
  for (let k = 1; k <= n && run > 0; k++) track.place({ x: cur.x + (dir.x * run * k) / n, y: cur.y + (dir.y * run * k) / n }, cur.alt + (rise * k) / n)
}

function land(ctx: Ctx, it: MissionItem): void {
  const { track, p } = ctx
  const at = located(it) ? xyOf(ctx, it) : track.cur
  if (it.command === CMD.VTOL_LAND || track.vtol || (p.quadplane && (p.qOptions & Q_ALLOW_FW_LAND) === 0)) {
    track.leg([at], track.cur.alt)
    return track.vertical(0)
  }
  track.leg([at], 0)
}

/**
 * RTL (do_RTL, then update_loiter about home with crosstrack off): L1 captures the home circle
 * straight from where the plane is, and circles it at the altitude it has.
 */
function rtl(ctx: Ctx): void {
  const { track, p } = ctx
  const home = { x: 0, y: 0 }
  if (track.vtol) return track.leg([home], track.cur.alt)
  const r = loiterDefault(p) * track.scale() ** 2
  const cw = p.loiterRad >= 0
  const heading = track.heading()
  const capture = heading ? captureLoiter(track.cur, heading, home, r, cw, track.tas(), gains(p)).pts.slice(1) : []
  const end = capture.at(-1) ?? track.cur
  const captured = Math.abs(dist(end, home) - r) < CAPTURED_M
  const join = captured ? end : (entryTangent(end, home, r, cw) ?? onCircle(home, r, polar(home, end)))
  track.leg(captured ? capture : [...capture, join], track.cur.alt)
  const phi = polar(home, join)
  walk(ctx, home, r, arcAngles(phi, phi, cw, 1, STEP_DEG), track.cur.alt)
}

/** Handles one item; false ends the prediction (the vehicle never moves on). */
function fly(ctx: Ctx, i: number, it: MissionItem): boolean {
  const cmd = it.command
  if (cmd === CMD.TAKEOFF || cmd === CMD.VTOL_TAKEOFF) takeoff(ctx, i, it)
  else if (cmd === CMD.VTOL_TRANSITION) ctx.track.vtol = it.params[0] === MAV_VTOL_STATE_MC ? true : it.params[0] === MAV_VTOL_STATE_FW ? false : ctx.track.vtol
  else if (WAYPOINTS.includes(cmd) && located(it)) waypoint(ctx, i, it)
  else if (LOITERS.includes(cmd) && located(it)) return loiter(ctx, i, it)
  else if (cmd === CMD.LAND || cmd === CMD.VTOL_LAND) {
    land(ctx, it)
    return false
  } else if (cmd === CMD.RTL) {
    rtl(ctx)
    return false
  }
  return true
}

/** The predicted path and how many of its points are the mission itself (the rest is the RTL tail). */
export interface PlaneParts {
  readonly points: PathPoint[]
  readonly missionEnd: number
}

export function predictPlaneParts(items: readonly MissionItem[], home: Home, p: PlaneParams): PlaneParts {
  const ctx: Ctx = { items, home, p, track: new Track(p, home.alt) }
  const ended = items.every((it, i) => fly(ctx, i, it))
  const missionEnd = ctx.track.pts.length
  // the mission ran out: ArduPlane switches to RTL (exit_mission_callback)
  if (ended && items.length > 0) rtl(ctx)
  return { points: ctx.track.pts.map((q) => ({ ...toLatLon(home, q), alt: q.alt })), missionEnd }
}

export function predictPlane(items: readonly MissionItem[], home: Home, p: PlaneParams): PathPoint[] {
  return predictPlaneParts(items, home, p).points
}
