// The accumulator behind the ArduCopter predicted path: straight 3D legs (AC_WPNav S-curves) whose
// fast-waypoint corners are rounded, plus vertical moves and pre-shaped curves (arc, spline, circle).
import type { CopterParams } from './copterParams'
import { cornerBlend, rampTime, type CornerLimits, type P3 } from './scurve'

interface Leg {
  readonly a: P3
  readonly b: P3
  readonly v: number
  /** The vehicle flies on through `b` into the next leg (no stop). */
  readonly fast: boolean
}

export const sub = (a: P3, b: P3): P3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z })
export const len3 = (d: P3): number => Math.hypot(d.x, d.y, d.z)
const unit = (d: P3): P3 => {
  const l = len3(d)
  return { x: d.x / l, y: d.y / l, z: d.z / l }
}

export class CopterTrack {
  readonly pts: P3[] = [{ x: 0, y: 0, z: 0 }]
  /** Direction the last move ended in, for a following spline (null = it stopped). */
  exit: P3 | null = null

  private pending: Leg | null = null
  private readonly p: CopterParams
  private readonly lim: CornerLimits

  constructor(p: CopterParams) {
    this.p = p
    this.lim = { accel: p.accel, jerk: p.jerk, accelCorner: p.accelCorner > 0 ? p.accelCorner : 2 * p.accel, radius: p.radius }
  }

  /** Where the vehicle is once everything queued is flown. */
  get cur(): P3 {
    return this.pending ? this.pending.b : this.pts[this.pts.length - 1]!
  }

  /** Speed along a leg: WP_SPD across, WP_SPD_UP / _DN up and down, and what a short leg can reach. */
  private speed(d: P3): number {
    const h = Math.hypot(d.x, d.y)
    const l = len3(d)
    const vz = d.z >= 0 ? this.p.up : this.p.down
    let v = Math.min(h > 0 ? (this.p.speed * l) / h : Infinity, d.z !== 0 ? (vz * l) / Math.abs(d.z) : Infinity)
    const full = (s: number) => (s * rampTime(s, this.p.accel, this.p.jerk)) / 2
    if (2 * full(v) <= l) return v
    let lo = 0
    for (let k = 0; k < 40; k++) {
      const mid = (lo + v) / 2
      if (2 * full(mid) <= l) lo = mid
      else v = mid
    }
    return Math.max(lo, 0.1)
  }

  /** A straight leg to `to`; `fast` = no stop there (the corner into the next straight leg is rounded). */
  straight(to: P3, fast: boolean): void {
    const from = this.cur
    const d = sub(to, from)
    if (len3(d) < 0.01) {
      // already there: a hold on this waypoint still stops the vehicle
      if (this.pending && !fast) this.pending = { ...this.pending, fast: false }
      return
    }
    let start = from
    const prev = this.pending
    if (prev) {
      const v = this.speed(d)
      const corner = prev.fast ? cornerBlend(prev.b, unit(sub(prev.b, prev.a)), unit(d), prev.v, v, this.lim) : [prev.b]
      this.pts.push(...corner)
      start = corner[corner.length - 1]!
    }
    this.pending = { a: start, b: to, v: this.speed(d), fast }
    this.exit = fast ? d : null
  }

  /** Emits what is queued: the vehicle ends on the last straight leg's end point. */
  flush(): void {
    if (!this.pending) return
    this.pts.push(this.pending.b)
    this.pending = null
  }

  /** Straight up or down where the vehicle is. */
  vertical(z: number): void {
    this.flush()
    const c = this.cur
    if (c.z !== z) this.pts.push({ ...c, z })
    this.exit = null
  }

  /** Pre-shaped points (arc, spline, circle), flown in order from where the vehicle is. */
  curve(points: readonly P3[], exit: P3 | null): void {
    this.flush()
    this.pts.push(...points)
    this.exit = exit
  }
}
