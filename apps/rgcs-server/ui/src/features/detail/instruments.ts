import type { Attitude } from '../../shared/api/types'

// Geometry and formatting for the detail panel's attitude indicator and compass.
// Both instruments draw in a 120 × 120 viewBox centred on 0,0 (x right, y down); angles are
// degrees clockwise from straight up, as on an aircraft instrument.

/** Horizon disc radius; the pitch ladder must keep ±30° inside it. */
export const DISC_R = 46
/** Pitch ladder scale: 30° → 39 units, inside the 46-unit disc. */
export const PITCH_PX_PER_DEG = 1.3
/** The horizon shift stops here so the disc never turns all sky or all ground off-scale. */
const PITCH_CLAMP = 60
const ROLL_SCALE_R = 50
const CARD_R = 52

export interface Segment {
  readonly x1: number
  readonly y1: number
  readonly x2: number
  readonly y2: number
}
export interface RollTick extends Segment {
  readonly deg: number
}
export type Cardinal = 'N' | 'E' | 'S' | 'W'
export interface CompassTick extends Segment {
  readonly deg: number
  readonly label: Cardinal | null
  readonly lx: number
  readonly ly: number
}
export interface PitchMark {
  readonly deg: number
  readonly y: number
  readonly half: number
}

const r2 = (n: number): number => Math.round(n * 100) / 100

/** A point `r` from the centre at `deg` clockwise from up. */
export function polar(r: number, deg: number): { readonly x: number; readonly y: number } {
  const a = (deg * Math.PI) / 180
  return { x: r2(r * Math.sin(a)), y: r2(-r * Math.cos(a)) }
}

function radial(deg: number, rIn: number, rOut: number): Segment {
  const a = polar(rIn, deg)
  const b = polar(rOut, deg)
  return { x1: a.x, y1: a.y, x2: b.x, y2: b.y }
}

const ROLL_DEGS = [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60] as const
/** Fixed roll scale above the disc: long ticks at 0/30/60, short at 10/20/45. */
export const ROLL_TICKS: readonly RollTick[] = ROLL_DEGS.map((deg) => {
  const long = deg % 30 === 0
  return { deg, ...radial(deg, ROLL_SCALE_R, ROLL_SCALE_R + (long ? 7 : 4)) }
})

/** Pitch ladder every 10° (±30° visible; ±40° drawn so a pitched disc keeps its ladder). */
export const PITCH_MARKS: readonly PitchMark[] = [-40, -30, -20, -10, 10, 20, 30, 40].map((deg) => ({
  deg,
  y: r2(-deg * PITCH_PX_PER_DEG),
  half: Math.abs(deg) % 20 === 0 ? 14 : 8,
}))

const CARDINALS: Readonly<Record<number, Cardinal>> = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' }
/** Compass card: a tick every 30°, letters at the cardinal points. */
export const COMPASS_TICKS: readonly CompassTick[] = Array.from({ length: 12 }, (_, i) => {
  const deg = i * 30
  const label = CARDINALS[deg] ?? null
  const l = polar(CARD_R - 16, deg)
  return { deg, label, lx: l.x, ly: l.y, ...radial(deg, CARD_R - (label ? 8 : 5), CARD_R) }
})

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/** Sky/ground group: turned by −roll, moved down by the pitch (nose up shows more sky). */
export function horizonTransform(roll: number, pitch: number): string {
  return `rotate(${r2(-roll)}) translate(0 ${r2(clamp(pitch, -PITCH_CLAMP, PITCH_CLAMP) * PITCH_PX_PER_DEG)})`
}

/** The roll pointer turns with the horizon against the fixed scale. */
export function rollPointerTransform(roll: number): string {
  return `rotate(${r2(-roll) || 0})`
}

/** The compass card turns by −heading so the heading sits under the lubber line. */
export function compassTransform(hdg: number): string {
  return `rotate(${r2(-hdg) || 0})`
}

/** Signed whole degrees: `−12°`, `+4°`, `0°`; `—` without data. */
export function fmtSigned(v: number | null): string {
  if (v === null) return '—'
  const n = Math.round(v)
  if (n === 0) return '0°'
  return n < 0 ? `−${-n}°` : `+${n}°`
}

/** Heading as three digits, 0–359: `087°`; `—` without data. */
export function fmtHeading(v: number | null): string {
  if (v === null) return '—'
  const n = ((Math.round(v) % 360) + 360) % 360
  return `${String(n).padStart(3, '0')}°`
}

const finite = (v: number | null | undefined): v is number => typeof v === 'number' && Number.isFinite(v)

/** The attitude if both angles are real numbers, else null (instrument shows no data). */
export function readAttitude(a: Attitude | null | undefined): Attitude | null {
  return a && finite(a.roll) && finite(a.pitch) ? { roll: a.roll, pitch: a.pitch } : null
}

export function readHeading(v: number | null | undefined): number | null {
  return finite(v) ? v : null
}
