// ArduCopter's waypoint speed profile (AP_Math/SCurve.cpp) reduced to a jerk-limited ramp: WP_JERK
// and WP_ACC shape the speed change; the snap ramp (≈ 2·ATC_INPUT_TC, 0.3 s) is left out. Used for
// the fast-waypoint corner, where the next leg starts while this one is still slowing down.

export interface P3 {
  readonly x: number
  readonly y: number
  /** Metres above home. */
  readonly z: number
}

export interface CornerLimits {
  readonly accel: number
  readonly jerk: number
  /** Largest sideways acceleration at the turn's mid point (WP_ACC_CNR, or 2·WP_ACC). */
  readonly accelCorner: number
  /** WP_RADIUS_M: the turn's mid point must lie this close to the waypoint. */
  readonly radius: number
}

/** The controller re-checks the corner every loop; this is the step of that search (s). */
const SCAN_DT = 0.02
/** Spacing of the drawn corner (s of flight). */
const DRAW_DT = 0.25

/** Peak acceleration and the jerk / constant-acceleration phase times of a ramp from 0 to `v`. */
function phases(v: number, accel: number, jerk: number): { ap: number; tj: number; tc: number } {
  if (v >= (accel * accel) / jerk) return { ap: accel, tj: accel / jerk, tc: v / accel - accel / jerk }
  const ap = Math.sqrt(v * jerk)
  return { ap, tj: ap / jerk, tc: 0 }
}

/** Time to go from standstill to `v` (or back down to standstill). */
export function rampTime(v: number, accel: number, jerk: number): number {
  const { tj, tc } = phases(v, accel, jerk)
  return 2 * tj + tc
}

/** Distance, speed and acceleration `t` seconds after starting from standstill toward `v`. */
export function ramp(v: number, accel: number, jerk: number, t: number): { s: number; v: number; a: number } {
  const { ap, tj, tc } = phases(v, accel, jerk)
  const t1 = Math.min(t, tj)
  let s = (jerk * t1 ** 3) / 6
  let sp = (jerk * t1 * t1) / 2
  if (t <= tj) return { s, v: sp, a: jerk * t1 }
  const t2 = Math.min(t - tj, tc)
  s += sp * t2 + (ap * t2 * t2) / 2
  sp += ap * t2
  if (t <= tj + tc) return { s, v: sp, a: ap }
  const t3 = Math.min(t - tj - tc, tj)
  s += sp * t3 + (ap * t3 * t3) / 2 - (jerk * t3 ** 3) / 6
  sp += ap * t3 - (jerk * t3 * t3) / 2
  if (t3 < tj) return { s, v: sp, a: ap - jerk * t3 }
  return { s: s + v * (t - 2 * tj - tc), v, a: 0 }
}

const add = (p: P3, u: P3, k: number): P3 => ({ x: p.x + u.x * k, y: p.y + u.y * k, z: p.z + u.z * k })

/**
 * How long the two legs overlap: the controller starts the next leg once this one is decelerating,
 * at the first moment the turn's mid point would lie within WP_RADIUS, below both leg speeds and
 * within the corner acceleration (0 = it stops on the waypoint).
 */
function overlap(u1: P3, u2: P3, v1: number, v2: number, lim: CornerLimits): number {
  const start = Math.min(rampTime(v1, lim.accel, lim.jerk), rampTime(v2, lim.accel, lim.jerk))
  for (let r = start; r > SCAN_DT; r -= SCAN_DT) {
    const a = ramp(v1, lim.accel, lim.jerk, r / 2)
    const b = ramp(v2, lim.accel, lim.jerk, r / 2)
    const pos = add(add({ x: 0, y: 0, z: 0 }, u1, -a.s), u2, b.s)
    const vel = add(add({ x: 0, y: 0, z: 0 }, u1, a.v), u2, b.v)
    const acc = add(add({ x: 0, y: 0, z: 0 }, u1, -a.a), u2, b.a)
    const ok = Math.hypot(pos.x, pos.y, pos.z) < lim.radius && Math.hypot(vel.x, vel.y, vel.z) < Math.min(v1, v2) && Math.hypot(acc.x, acc.y) < lim.accelCorner
    if (ok) return r
  }
  return 0
}

/**
 * The flown corner at `wp` between unit directions `u1` (in) and `u2` (out) at leg speeds `v1` / `v2`:
 * the two S-curves run at once, wp − u1·s₁(R − t) + u2·s₂(t) over the overlap R. `[wp]` when it stops.
 */
export function cornerBlend(wp: P3, u1: P3, u2: P3, v1: number, v2: number, lim: CornerLimits): P3[] {
  const r = overlap(u1, u2, v1, v2, lim)
  if (r === 0) return [wp]
  // even, so the mid point (the one WP_RADIUS limits) is drawn
  const n = 2 * Math.max(1, Math.ceil(r / (2 * DRAW_DT)))
  return Array.from({ length: n + 1 }, (_, k) => {
    const t = (r * k) / n
    return add(add(wp, u1, -ramp(v1, lim.accel, lim.jerk, r - t).s), u2, ramp(v2, lim.accel, lim.jerk, t).s)
  })
}
