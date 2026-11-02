// Survey generator: SurveySpec → lane geometry (with the start corner) → MissionItem list, plus
// the numbers shown in the panel. Pure and deterministic.
import type { MissionItem } from '../../shared/api/types'
import { toLocal, type Xy } from '../mission/arc'
import { legDistanceM, positioned, type LatLon } from '../mission/geo'
import { buildItems, type Run } from './items'
import { buildLanes, laneRows, MAX_LANES, orderLanes, polygonAreaM2, type Lane } from './lanes'
import { blur, footprint, gsdCm, laneSpacingM, triggerDistM, turnRadiusM, type Footprint } from './photo'
import type { SurveySpec } from './spec'

export interface SurveyGeometry {
  /** As built by buildLanes, or reversed when the start corner is at the other side. */
  readonly lanes: readonly Lane[]
  /** Visiting order (indices into `lanes`); directions alternate along it. */
  readonly order: readonly number[]
  /** The first lane is flown b → a (against the lane angle) rather than a → b. */
  readonly firstFromB: boolean
  readonly turnRadiusM: number
  readonly triggerDistM: number
  readonly spacingM: number
  readonly footprint: Footprint
  readonly leadInM: number
  readonly overshootM: number
  readonly marginAlongM: number
  readonly marginAcrossM: number
}

export interface SurveyNumbers {
  readonly photos: number
  readonly areaM2: number
  readonly lanes: number
  readonly intervalS: number
  readonly blur: { readonly cm: number; readonly px: number }
  readonly distanceM: number
  readonly timeS: number
}

const RAD = Math.PI / 180
/** Corner preference as (north sign, east sign). */
const CORNERS = { nw: [1, -1], ne: [1, 1], sw: [-1, -1], se: [-1, 1] } as const

/** The auto lead-in is at least this many seconds of flight: time to settle on the lane after the turn. */
const LEAD_IN_S = 8

/** Rounds up to a multiple of 5 m. */
const ceil5 = (m: number) => Math.ceil(m / 5 - 1e-9) * 5
const unit = (headingDeg: number): Xy => ({ x: Math.sin(headingDeg * RAD), y: Math.cos(headingDeg * RAD) })
const lenM = (a: LatLon, b: LatLon) => Math.hypot(toLocal(a, b).x, toLocal(a, b).y)

/** Each lane in visiting order, oriented and extended by the lead-in and overshoot. */
function toRuns(g: SurveyGeometry, origin: LatLon, angleDeg: number): Run[] {
  return g.order.map((li, k) => {
    const lane = g.lanes[li]
    const forward = (k % 2 === 0) !== g.firstFromB
    const start = toLocal(origin, forward ? lane.a : lane.b)
    const end = toLocal(origin, forward ? lane.b : lane.a)
    const headingDeg = forward ? angleDeg : angleDeg + 180
    const u = unit(headingDeg)
    const lead = { x: start.x - u.x * g.leadInM, y: start.y - u.y * g.leadInM }
    const over = { x: end.x + u.x * g.overshootM, y: end.y + u.y * g.overshootM }
    return { lead, start, end, over, headingDeg }
  })
}

type Base = Omit<SurveyGeometry, 'lanes' | 'order' | 'firstFromB'>
type Choice = Pick<SurveyGeometry, 'lanes' | 'order' | 'firstFromB'>

/** How well a candidate's first lead-in start (local metres) matches the requested start. */
function startScore(spec: SurveySpec, home: Xy | null, entry: Xy): number {
  if (spec.start === 'home' && home) return -Math.hypot(entry.x - home.x, entry.y - home.y)
  const [n, e] = CORNERS[spec.start === 'home' ? 'nw' : spec.start]
  return n * entry.y + e * entry.x
}

/**
 * The start corner: lane list as built or reversed (so the first or the last lane by y comes
 * first) × the first lane entered from a or b. The best-scoring candidate wins; ties keep the earlier.
 */
function chooseStart(spec: SurveySpec, built: readonly Lane[], base: Base, home: LatLon | null): Choice {
  const origin = spec.polygon[0]
  const homeXy = home ? toLocal(origin, home) : null
  const candidates: Choice[] = [built, [...built].reverse()].flatMap((lanes) => {
    const order = orderLanes(lanes, spec.skip, base.spacingM)
    return [false, true].map((firstFromB) => ({ lanes, order, firstFromB }))
  })
  const scored = candidates.map((c) => ({ c, score: startScore(spec, homeXy, toRuns({ ...base, ...c }, origin, spec.angleDeg)[0].lead) }))
  return scored.reduce((b, s) => (s.score > b.score ? s : b)).c
}

function baseGeometry(spec: SurveySpec): Base {
  const fp = footprint(spec.camera, spec.altM, spec.orientation)
  const groundMs = spec.speedMs + spec.windMs
  const radius = turnRadiusM(groundMs, spec.bankDeg)
  const plane = spec.airframe === 'plane'
  return {
    turnRadiusM: radius,
    triggerDistM: triggerDistM(fp, spec.frontPct),
    spacingM: laneSpacingM(fp, spec.sidePct),
    footprint: fp,
    leadInM: plane ? (spec.leadInM ?? ceil5(Math.max(radius, LEAD_IN_S * groundMs))) : 0,
    overshootM: plane ? (spec.overshootM ?? ceil5(radius / 2)) : 0,
    marginAlongM: spec.marginM ?? fp.alongM / 2,
    marginAcrossM: spec.marginM ?? fp.acrossM / 2,
  }
}

/** Lanes, order and the derived distances; null when the polygon yields no lanes. */
export function surveyGeometry(spec: SurveySpec, home: LatLon | null): SurveyGeometry | null {
  const base = baseGeometry(spec)
  const built = buildLanes(spec.polygon, spec.angleDeg, base.spacingM, base.marginAlongM, base.marginAcrossM)
  if (!built || built.length === 0) return null
  return { ...base, ...chooseStart(spec, built, base, home) }
}

/** More items than this are refused (the editor and the 3D map stay responsive). */
export const MAX_GENERATED_ITEMS = 5000

export type GenerateError = 'invalid_polygon' | 'too_large'

/** The lane rows the spec needs exceed MAX_LANES: answered before any lane is built. */
function tooManyRows(spec: SurveySpec): boolean {
  const base = baseGeometry(spec)
  return laneRows(spec.polygon, spec.angleDeg, base.spacingM, base.marginAcrossM) > MAX_LANES
}

export function generateSurvey(spec: SurveySpec, home: LatLon | null): { items: MissionItem[]; geometry: SurveyGeometry } | { error: GenerateError } {
  if (tooManyRows(spec)) return { error: 'too_large' }
  const geometry = surveyGeometry(spec, home)
  if (!geometry) return { error: 'invalid_polygon' }
  // a concave area can split rows into more lanes than rows
  if (geometry.lanes.length > MAX_LANES) return { error: 'too_large' }
  const origin = spec.polygon[0]
  const ctx = {
    origin,
    altM: spec.altM,
    triggerDistM: geometry.triggerDistM,
    radiusM: geometry.turnRadiusM,
    speedMs: spec.speedMs,
    turn: spec.turn,
    airframe: spec.airframe,
  }
  const items = buildItems(toRuns(geometry, origin, spec.angleDeg), ctx)
  return items.length > MAX_GENERATED_ITEMS ? { error: 'too_large' } : { items, geometry }
}

/** Metres flown from the first to the last positioned item (arcs along the arc). */
function pathLengthM(items: readonly MissionItem[]): number {
  const pts = positioned(items).map((p) => p.item)
  return pts.slice(1).reduce((sum, it, i) => sum + legDistanceM({ lat: pts[i].lat, lon: pts[i].lon }, it), 0)
}

export function surveyNumbers(spec: SurveySpec, geometry: SurveyGeometry, items: readonly MissionItem[]): SurveyNumbers {
  const groundMs = spec.speedMs + spec.windMs
  const dist = geometry.triggerDistM
  const photos = geometry.lanes.reduce((n, l) => n + Math.floor(lenM(l.a, l.b) / dist) + 1, 0)
  const distanceM = pathLengthM(items)
  return {
    photos,
    areaM2: polygonAreaM2(spec.polygon),
    lanes: geometry.lanes.length,
    intervalS: dist / groundMs,
    blur: blur(spec.camera, groundMs, gsdCm(spec.camera, spec.altM)),
    distanceM,
    timeS: distanceM / spec.speedMs,
  }
}
