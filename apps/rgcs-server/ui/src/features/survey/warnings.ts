// Survey warnings shown in the panel: pure checks over the spec, the generated geometry and
// items, the terrain worst case and (when available) the predicted path.
import type { MissionItem } from '../../shared/api/types'
import { PLANE_DEFAULTS } from '../flightpath/params'
import type { PathPoint } from '../flightpath/planePath'
import { toLocal, type Xy } from '../mission/arc'
import { CMDS } from '../mission/cmds'
import type { LatLon } from '../mission/geo'
import type { SurveyGeometry, SurveyNumbers } from './generate'
import type { SurveySpec } from './spec'
import { ARC_SPLIT_DEG } from './turns'
import type { SurveyVehicle } from './vehicleParams'
import type { WorstCase } from './worst'

export type SurveyWarning = 'blur' | 'interval' | 'skip' | 'bank' | 'overlap' | 'arc' | 'entry' | 'wp_radius' | 'l1' | 'terrain' | 'assist' | 'cam_roll' | 'too_many' | 'no_home'

export interface WarningInput {
  readonly spec: SurveySpec
  readonly geometry: SurveyGeometry
  readonly numbers: SurveyNumbers
  /** Terrain worst case, or null without terrain data. */
  readonly worst: WorstCase | null
  readonly items: readonly MissionItem[]
  readonly home: LatLon | null
  readonly predicted?: readonly PathPoint[]
  /** How many predicted points are the mission (the plane's RTL tail follows); absent: all. */
  readonly predictedMissionEnd?: number
  /** ROLL_LIMIT_DEG of the connected vehicle. */
  readonly rollLimitDeg?: number
  /** Other parameters read from the connected vehicle (none: NAVL1 defaults, the rest skipped). */
  readonly vehicle?: SurveyVehicle
}

/** Motion blur above this many pixels warns. */
const BLUR_MAX_PX = 1
/** Worst overlap this many percentage points under the set value warns. */
const OVERLAP_SLACK_PCT = 10
/** Predicted path deviation from a shooting-start WP that warns. */
export const ENTRY_TOL_M = 5
export const MAX_SURVEY_ITEMS = 700
/** Ground closer than this under the flight altitude warns. */
export const MIN_CLEARANCE_M = 30
/** A survey speed this close above AIRSPEED_MIN warns. */
const AIRSPEED_MARGIN_MS = 2
const RAD = Math.PI / 180

/** Lanes to skip so that consecutive lanes are at least 2R apart. */
export const suggestSkip = (spacingM: number, radiusM: number): number => Math.max(0, Math.ceil((2 * radiusM) / spacingM) - 1)

/** Blur in pixels at the smallest GSD (the worst case when known, else the nominal one). */
function blurred(i: WarningInput): boolean {
  const px = i.worst ? i.numbers.blur.cm / i.worst.minGsdCm : i.numbers.blur.px
  return px > BLUR_MAX_PX
}

function overlapLow(i: WarningInput): boolean {
  if (!i.worst) return false
  return i.worst.frontPct < i.spec.frontPct - OVERLAP_SLACK_PCT || i.worst.sidePct < i.spec.sidePct - OVERLAP_SLACK_PCT
}

/** ArduPlane's L1 distance (m) flying the survey: NAVL1_PERIOD · NAVL1_DAMPING · (speed + wind) / π. */
export function l1DistanceM(spec: SurveySpec, v: SurveyVehicle = {}): number {
  const period = v.navL1Period ?? PLANE_DEFAULTS.navL1Period
  const damping = v.navL1Damping ?? PLANE_DEFAULTS.navL1Damping
  return (period * damping * (spec.speedMs + spec.windMs)) / Math.PI
}

/**
 * ArduPlane accepts a WP at min(WP_RADIUS, L1) × |turn| / 90 before it (commands_logic.cpp
 * verify_nav_wp): collinear lead-in / start / end / overshoot WPs are reached at their finish line,
 * but each 30° split WP of a turn is let go that early, cutting the turn when it exceeds R·sin 15°.
 */
function wpRadiusTooBig(i: WarningInput): boolean {
  const accept = (Math.min(i.spec.wpRadiusM, l1DistanceM(i.spec, i.vehicle)) * ARC_SPLIT_DEG) / 90
  return i.spec.turn === 'split' && accept > i.geometry.turnRadiusM * Math.sin((ARC_SPLIT_DEG / 2) * RAD)
}

/** Q_ASSIST_SPEED (when on) at or above the survey speed, or the speed within 2 m/s of AIRSPEED_MIN. */
function nearStall(i: WarningInput): boolean {
  const { assistSpeed, airspeedMin } = i.vehicle ?? {}
  const assist = assistSpeed !== undefined && assistSpeed > 0 && i.spec.speedMs <= assistSpeed
  return assist || (airspeedMin !== undefined && i.spec.speedMs < airspeedMin + AIRSPEED_MARGIN_MS)
}

/** The WAYPOINT before each trigger-on (DO_SET_CAM_TRIGG_DIST with a distance). */
export function shootingStarts(items: readonly MissionItem[]): MissionItem[] {
  return items.flatMap((it, k) => {
    if (it.command !== CMDS.DO_SET_CAM_TRIGG_DIST.id || !(it.params[0] > 0)) return []
    const wp = items.slice(0, k).findLast((p) => p.command === CMDS.WAYPOINT.id)
    return wp ? [wp] : []
  })
}

function segmentDistM(p: Xy, a: Xy, b: Xy): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  const t = len2 > 0 ? Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy)
}

/** Distance (m) from `p` to the nearest point of the predicted polyline. */
function pathDistM(p: LatLon, path: readonly PathPoint[]): number {
  const pts = path.map((q) => toLocal(p, q))
  const origin = { x: 0, y: 0 }
  if (pts.length === 1) return Math.hypot(pts[0].x, pts[0].y)
  return pts.slice(1).reduce((best, b, k) => Math.min(best, segmentDistM(origin, pts[k], b)), Infinity)
}

function entryMissed(i: WarningInput): boolean {
  const path = i.predicted?.slice(0, i.predictedMissionEnd ?? i.predicted.length)
  if (!path || path.length === 0) return false
  return shootingStarts(i.items).some((wp) => pathDistM(wp, path) > ENTRY_TOL_M)
}

/** The checks in display order; plane-only checks are marked. */
const CHECKS: readonly (readonly [SurveyWarning, boolean, (i: WarningInput) => boolean])[] = [
  ['blur', false, blurred],
  ['interval', false, (i) => i.numbers.intervalS < i.spec.camera.minIntervalS],
  ['skip', true, (i) => (i.spec.skip + 1) * i.geometry.spacingM < 2 * i.geometry.turnRadiusM],
  ['bank', false, (i) => i.rollLimitDeg !== undefined && i.spec.bankDeg > i.rollLimitDeg],
  ['overlap', false, overlapLow],
  ['arc', false, (i) => i.spec.turn === 'arc'],
  ['entry', true, entryMissed],
  ['wp_radius', true, wpRadiusTooBig],
  ['l1', true, (i) => i.geometry.turnRadiusM < l1DistanceM(i.spec, i.vehicle)],
  ['terrain', false, (i) => i.worst !== null && i.worst.lowAglM < MIN_CLEARANCE_M],
  ['assist', true, nearStall],
  ['cam_roll', false, (i) => i.vehicle?.camMaxRoll === 0],
  ['too_many', false, (i) => i.items.length > MAX_SURVEY_ITEMS],
  ['no_home', false, (i) => i.home === null],
]

export function surveyWarnings(input: WarningInput): SurveyWarning[] {
  const plane = input.spec.airframe === 'plane'
  return CHECKS.filter(([, planeOnly, check]) => (plane || !planeOnly) && check(input)).map(([code]) => code)
}
