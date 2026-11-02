// The accumulator behind the predicted path: straight pieces with ArduPlane's altitude rules
// (ALT_SLOPE_MIN slope along a leg, then TECS climb / sink limits per metre flown).
import { dist, type Xy } from './geom'
import type { PlaneParams } from './params'

export interface P3 extends Xy {
  readonly alt: number
}

/**
 * True / equivalent airspeed in the ISA troposphere at `amsl` metres: ArduPlane flies AIRSPEED_CRUISE
 * as EAS, so over the ground (no wind) it is faster in thin air and L1 loiters scale by EAS2TAS².
 */
export function eas2tas(amsl: number): number {
  const sigma = Math.pow(1 - 2.25577e-5 * Math.max(-500, amsl), 4.2559)
  return 1 / Math.sqrt(sigma)
}

/** Pieces are cut this short so a rate-limited climb bends where it levels off. */
const PIECE_M = 20
const IMMEDIATE_CLIMB_IN_AUTO = 1 << 14

export class Track {
  readonly pts: P3[] = [{ x: 0, y: 0, alt: 0 }]
  vtol = false

  private readonly p: PlaneParams
  private readonly homeAmsl: number

  constructor(p: PlaneParams, homeAmsl: number) {
    this.p = p
    this.homeAmsl = homeAmsl
  }

  /** EAS2TAS at `alt` metres above home (default: where the vehicle is now). */
  scale(alt: number = this.cur.alt): number {
    return eas2tas(this.homeAmsl + alt)
  }

  /** True airspeed (m/s) at the current altitude: the ground speed without wind. */
  tas(): number {
    return this.p.airspeed * this.scale()
  }

  get cur(): P3 {
    return this.pts[this.pts.length - 1]!
  }

  /** Unit direction of the last horizontal movement, or null (nothing flown yet / only vertical). */
  heading(): Xy | null {
    const c = this.cur
    for (let i = this.pts.length - 2; i >= 0; i--) {
      const d = dist(this.pts[i]!, c)
      if (d > 0.5) return { x: (c.x - this.pts[i]!.x) / d, y: (c.y - this.pts[i]!.y) / d }
    }
    return null
  }

  /** Climb / sink allowed per metre of ground: TECS limits at cruise speed, Q_WP_* while hovering. */
  private perMetre(): { up: number; down: number } {
    const p = this.p
    return this.vtol ? { up: p.qWpUp / p.qWpSpeed, down: p.qWpDn / p.qWpSpeed } : { up: p.climb / this.tas(), down: p.sink / this.tas() }
  }

  /** Straight up or down where the vehicle is (VTOL takeoff / landing, hover altitude change). */
  vertical(alt: number): void {
    const c = this.cur
    if (c.alt !== alt) this.pts.push({ x: c.x, y: c.y, alt })
  }

  /**
   * Flies `via` in order towards `target` altitude: sloped over the whole leg when the change is
   * large. `slopeOver` stretches the slope (a loiter's slope runs to its centre, past the circle).
   */
  leg(via: readonly Xy[], target: number, slopeOver?: number): void {
    const start = this.cur
    const total = slopeOver ?? via.reduce((s, q, i) => s + dist(i === 0 ? start : via[i - 1]!, q), 0)
    const climbNow = target > start.alt && (this.p.flightOptions & IMMEDIATE_CLIMB_IN_AUTO) !== 0
    const sloped = !this.vtol && !climbNow && Math.abs(target - start.alt) >= this.p.altSlopeMin && total > 0
    let flown = 0
    for (const q of via) {
      const from = this.cur
      const len = dist(from, q)
      const n = Math.max(1, Math.ceil(len / PIECE_M))
      for (let k = 1; k <= n; k++) {
        flown += len / n
        const want = sloped ? start.alt + ((target - start.alt) * Math.min(1, flown / total)) : target
        this.step({ x: from.x + ((q.x - from.x) * k) / n, y: from.y + ((q.y - from.y) * k) / n }, want)
      }
    }
  }

  /** A point with its altitude set directly (a climb whose rate the caller already worked out). */
  place(to: Xy, alt: number): void {
    this.pts.push({ x: to.x, y: to.y, alt })
  }

  /** One short piece: the altitude moves toward `want` no faster than the climb / sink limits. */
  step(to: Xy, want: number): void {
    const c = this.cur
    const d = dist(c, to)
    const { up, down } = this.perMetre()
    const alt = Math.min(c.alt + up * d, Math.max(c.alt - down * d, want))
    this.pts.push({ x: to.x, y: to.y, alt })
  }
}
