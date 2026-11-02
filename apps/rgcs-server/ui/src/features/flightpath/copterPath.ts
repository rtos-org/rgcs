// Predicted ArduCopter path in AUTO from the mission and the vehicle's parameters (source behaviour
// checked against ArduPilot master 2026-10-20: ArduCopter/mode_auto.cpp, mode_rtl.cpp,
// AC_WPNav, AP_Math/SCurve.cpp, SplineCurve.cpp). An estimate: wind and the snap ramp are ignored.
import type { Home, MissionItem } from '../../shared/api/types'
import { arcPoints } from '../mission/arc'
import type { CopterParams } from './copterParams'
import { CopterTrack, len3, sub } from './copterTrack'
import { toLatLon, toXy } from './geom'
import type { PathPoint } from './planePath'
import type { P3 } from './scurve'

const CMD = { WAYPOINT: 16, LOITER_UNLIM: 17, LOITER_TURNS: 18, LOITER_TIME: 19, RTL: 20, LAND: 21, TAKEOFF: 22, LOITER_TO_ALT: 31, ARC: 36, SPLINE: 82, VTOL_TAKEOFF: 84, VTOL_LAND: 85, PAYLOAD_PLACE: 94 } as const
/** set_next_wp: after these the vehicle flies on through the waypoint instead of stopping. */
const FLY_ON_INTO: readonly number[] = [CMD.WAYPOINT, CMD.LOITER_UNLIM, CMD.LOITER_TIME, CMD.LAND, CMD.VTOL_LAND, CMD.PAYLOAD_PLACE, CMD.SPLINE, CMD.ARC]
/** MAV_CMD ids below this are navigation commands; DO_* / CONDITION_* start at 112. */
const NAV_LIMIT = 100
const STEP_RAD = (10 * Math.PI) / 180
const SPLINE_STEPS = 24
/** Spline start / end tangents are scaled down when longer than this many leg lengths. */
const SPLINE_FACTOR = 4
const RTL_ALT_MIN_M = 0.3
const RTL_MIN_CONE_SLOPE = 0.5

interface Ctx {
  readonly items: readonly MissionItem[]
  readonly home: Home
  readonly p: CopterParams
  readonly track: CopterTrack
}

const located = (it: MissionItem) => !(it.lat === 0 && it.lon === 0)

/** get_loc_from_cmd: missing coordinates or a zero altitude mean "where the vehicle is". */
function target(ctx: Ctx, it: MissionItem): P3 {
  const c = ctx.track.cur
  const xy = located(it) ? toXy(ctx.home, it) : c
  const z = it.alt === 0 ? c.z : it.frame === 'abs' ? it.alt - ctx.home.alt : it.alt
  return { x: xy.x, y: xy.y, z }
}

function nextNav(ctx: Ctx, i: number): MissionItem | null {
  return ctx.items.slice(i + 1).find((it) => it.command < NAV_LIMIT) ?? null
}

/** No hold time and a next command the vehicle can fly straight into. */
function fliesOn(ctx: Ctx, i: number, it: MissionItem): boolean {
  const next = nextNav(ctx, i)
  const hold = it.command === CMD.ARC ? 0 : it.params[0]
  return hold <= 0 && next !== null && FLY_ON_INTO.includes(next.command)
}

function arc(ctx: Ctx, i: number, it: MissionItem): void {
  const from = ctx.track.cur
  const to = target(ctx, it)
  const ll = arcPoints(toLatLon(ctx.home, from), toLatLon(ctx.home, to), it.params[0]).map((q) => toXy(ctx.home, q))
  const pts = ll.slice(1).map((q, k) => ({ x: q.x, y: q.y, z: from.z + ((to.z - from.z) * (k + 1)) / (ll.length - 1) }))
  const last = pts.length > 1 ? sub(pts[pts.length - 1]!, pts[pts.length - 2]!) : sub(to, from)
  ctx.track.curve(pts, fliesOn(ctx, i, it) ? last : null)
}

/** AC_WPNav::set_spline_destination: a Hermite curve between start / end tangents. */
function spline(ctx: Ctx, i: number, it: MissionItem): void {
  const o = ctx.track.cur
  const d = target(ctx, it)
  const next = nextNav(ctx, i)
  const v0 = ctx.track.exit ?? { x: 0, y: 0, z: 0 }
  let v1 = { x: 0, y: 0, z: 0 }
  if (fliesOn(ctx, i, it) && next && located(next)) {
    const n = target(ctx, next)
    v1 = next.command === CMD.SPLINE ? sub(n, o) : sub(n, d)
  }
  const room = len3(sub(d, o)) * SPLINE_FACTOR
  const k = len3(v0) + len3(v1) > room ? room / (len3(v0) + len3(v1)) : 1
  const h = (t: number, a: number, b: number, va: number, vb: number) =>
    (2 * t ** 3 - 3 * t * t + 1) * a + (t ** 3 - 2 * t * t + t) * va * k + (-2 * t ** 3 + 3 * t * t) * b + (t ** 3 - t * t) * vb * k
  const pts = Array.from({ length: SPLINE_STEPS }, (_, s) => {
    const t = (s + 1) / SPLINE_STEPS
    return { x: h(t, o.x, d.x, v0.x, v1.x), y: h(t, o.y, d.y, v0.y, v1.y), z: h(t, o.z, d.z, v0.z, v1.z) }
  })
  ctx.track.curve(pts, len3(v1) > 0 ? v1 : null)
}

/** do_circle: straight to the nearest edge point, then the turns (negative radius = counter-clockwise). */
function circle(ctx: Ctx, it: MissionItem): void {
  const c = target(ctx, it)
  const r = Math.abs(it.params[2])
  if (r === 0) return ctx.track.straight(c, false)
  const cur = ctx.track.cur
  const phi0 = Math.hypot(cur.x - c.x, cur.y - c.y) > 0.01 ? Math.atan2(cur.y - c.y, cur.x - c.x) : -Math.PI / 2
  ctx.track.straight({ x: c.x + r * Math.cos(phi0), y: c.y + r * Math.sin(phi0), z: c.z }, false)
  const sweep = Math.max(0, it.params[0]) * 2 * Math.PI
  const dir = it.params[2] < 0 ? 1 : -1
  const n = Math.ceil(sweep / STEP_RAD)
  const pts = Array.from({ length: n }, (_, k) => {
    const phi = phi0 + dir * Math.min(sweep, (k + 1) * STEP_RAD)
    return { x: c.x + r * Math.cos(phi), y: c.y + r * Math.sin(phi), z: c.z }
  })
  ctx.track.curve(pts, null)
}

/** mode_rtl compute_return_target: climb (RTL_ALT_M, RTL_CLIMB_MIN_M, cone), fly home, descend. */
function rtl(ctx: Ctx): void {
  const { track, p } = ctx
  track.flush()
  const cur = track.cur
  const minAlt = Math.max(RTL_ALT_MIN_M, cur.z + p.rtlClimbMin)
  let alt = Math.max(p.rtlAlt, minAlt)
  if (p.rtlConeSlope >= RTL_MIN_CONE_SLOPE) alt = Math.min(alt, Math.max(Math.hypot(cur.x, cur.y) * p.rtlConeSlope, minAlt))
  if (alt > cur.z) track.vertical(alt)
  track.straight({ x: 0, y: 0, z: Math.max(alt, cur.z) }, false)
  track.vertical(p.rtlAltFinal)
}

function land(ctx: Ctx, it: MissionItem): void {
  const cur = ctx.track.cur
  if (located(it)) ctx.track.straight({ ...toXy(ctx.home, it), z: cur.z }, false)
  ctx.track.vertical(0)
}

/** Handles one item; false ends the prediction (the vehicle never moves on). */
function fly(ctx: Ctx, i: number, it: MissionItem): boolean {
  const { track } = ctx
  const cmd = it.command
  if (cmd === CMD.TAKEOFF || cmd === CMD.VTOL_TAKEOFF) track.vertical(Math.max(track.cur.z, target(ctx, it).z))
  else if (cmd === CMD.WAYPOINT) track.straight(target(ctx, it), fliesOn(ctx, i, it))
  else if (cmd === CMD.ARC) arc(ctx, i, it)
  else if (cmd === CMD.SPLINE) spline(ctx, i, it)
  else if (cmd === CMD.LOITER_TIME || cmd === CMD.LOITER_TO_ALT) track.straight(target(ctx, it), false)
  else if (cmd === CMD.LOITER_TURNS) circle(ctx, it)
  else if (cmd === CMD.LOITER_UNLIM) {
    track.straight(target(ctx, it), false)
    return false
  } else if (cmd === CMD.LAND || cmd === CMD.VTOL_LAND) {
    land(ctx, it)
    return false
  } else if (cmd === CMD.RTL) {
    rtl(ctx)
    return false
  }
  return true
}

export function predictCopter(items: readonly MissionItem[], home: Home, p: CopterParams): PathPoint[] {
  const ctx: Ctx = { items, home, p, track: new CopterTrack(p) }
  for (let i = 0; i < items.length; i++) if (!fly(ctx, i, items[i]!)) break
  ctx.track.flush()
  return ctx.track.pts.map((q) => ({ ...toLatLon(home, q), alt: q.z }))
}
