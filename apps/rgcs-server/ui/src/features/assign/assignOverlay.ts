// What the assignment board draws on the planner map (spec 2026-10-31 §3.4, §4.3): every saved
// plan in its colour (unassigned ones faint), a dashed link from each positioned vehicle to its
// plan's start, and a highlight that dims everything unrelated. Also what fits and focuses frame.
import type { Feature, FeatureCollection, LineString, Point } from 'geojson'
import type { Mission, VehicleState } from '../../shared/api/types'
import { hasPosition as vehicleHasPosition } from '../map/markers'
import { pathGeoJson, positioned, type LatLon } from '../mission/geo'
import { fromMission } from '../mission/model'
import { framePoints } from '../plans/frame'
import type { Assignments } from './store'

/** A saved plan as the board knows it (`LibraryPlan` fits). */
export interface OverlayPlan {
  readonly id: number
  readonly name: string
  readonly mission: Mission
}

/** The card under the cursor (or picked on touch): what stays bright. */
export type Highlight = { readonly plan: number } | { readonly vehicle: number } | null

export interface AssignOverlayInput {
  readonly plans: readonly OverlayPlan[]
  /** Plan id → colour (`planColours`). */
  readonly colours: ReadonlyMap<number, string>
  readonly vehicles: readonly VehicleState[]
  readonly assignments: Assignments
  readonly highlight: Highlight
}

export interface OverlayVehicle {
  readonly sysid: number
  readonly lat: number
  readonly lon: number
  /** Its plan's colour; null = no plan. */
  readonly color: string | null
  readonly opacity: number
}

export interface AssignGeoJson {
  /** One LineString per plan: `plan`, `color`, `opacity`. */
  readonly routes: FeatureCollection
  /** The plans' positioned items: `plan`, `color`, `opacity`. */
  readonly points: FeatureCollection
  /** One point per plan at its start: `plan`, `name`, `color`, `opacity`. */
  readonly labels: FeatureCollection<Point>
  /** Vehicle → its plan's start: `sysid`, `plan`, `color`, `opacity`. */
  readonly links: FeatureCollection
  /** Positioned vehicles only. */
  readonly vehicles: readonly OverlayVehicle[]
}

export type FocusTarget = { readonly plan: number } | { readonly vehicle: number }
export type FocusResult = { readonly points: readonly LatLon[] } | { readonly error: 'noPosition' }

export const ASSIGNED = 1
export const UNASSIGNED = 0.38
export const DIMMED = 0.12
const NO_PLAN_COLOR = '#4b5664'

const collection = <T extends Feature>(features: T[]): FeatureCollection<T['geometry']> => ({ type: 'FeatureCollection', features })

const planOf = (a: Assignments, sysid: number): number | null => a.get(sysid)?.plan_id ?? null

/** The plan's first positioned item (the takeoff has no position). */
export function planStart(m: Mission): LatLon | null {
  const first = positioned(m.items)[0]
  return first ? { lat: first.item.lat, lon: first.item.lon } : null
}

function planLit(id: number, input: AssignOverlayInput): boolean {
  const hl = input.highlight
  if (hl === null) return true
  return 'plan' in hl ? hl.plan === id : planOf(input.assignments, hl.vehicle) === id
}

function vehicleLit(sysid: number, plan: number | null, hl: Highlight): boolean {
  if (hl === null) return true
  return 'plan' in hl ? plan !== null && hl.plan === plan : hl.vehicle === sysid
}

function planOpacity(id: number, assigned: ReadonlySet<number>, input: AssignOverlayInput): number {
  if (!planLit(id, input)) return DIMMED
  return assigned.has(id) ? ASSIGNED : UNASSIGNED
}

function routeOf(p: OverlayPlan, tag: { plan: number; color: string; opacity: number }): Feature<LineString> | null {
  const coords = pathGeoJson(p.mission.items, null).features.flatMap((f, i) => (i === 0 ? f.geometry.coordinates : f.geometry.coordinates.slice(1)))
  return coords.length < 2 ? null : { type: 'Feature', properties: tag, geometry: { type: 'LineString', coordinates: coords } }
}

function planFeatures(p: OverlayPlan, color: string, opacity: number) {
  const tag = { plan: p.id, color, opacity }
  const route = routeOf(p, tag)
  const points = positioned(p.mission.items).map(({ item }): Feature<Point> => ({ type: 'Feature', properties: tag, geometry: { type: 'Point', coordinates: [item.lon, item.lat] } }))
  const start = planStart(p.mission)
  const label: Feature<Point>[] = start ? [{ type: 'Feature', properties: { plan: p.id, name: p.name, color, opacity }, geometry: { type: 'Point', coordinates: [start.lon, start.lat] } }] : []
  return { route: route ? [route] : [], points, label }
}

/** Every feature carries `color` and `opacity` (assigned 1, unassigned 0.38, off the highlight 0.12). */
export function assignGeoJson(input: AssignOverlayInput): AssignGeoJson {
  const assigned = new Set([...input.assignments.values()].flatMap((a) => (a.plan_id === null ? [] : [a.plan_id])))
  const colour = (id: number) => input.colours.get(id) ?? NO_PLAN_COLOR
  const parts = input.plans.map((p) => planFeatures(p, colour(p.id), planOpacity(p.id, assigned, input)))
  const byId = new Map(input.plans.map((p) => [p.id, p]))
  const placed = input.vehicles.filter(vehicleHasPosition)
  const links = placed.flatMap((v): Feature<LineString>[] => {
    const plan = byId.get(planOf(input.assignments, v.sysid) ?? NaN)
    const start = plan ? planStart(plan.mission) : null
    if (!plan || !start) return []
    const opacity = vehicleLit(v.sysid, plan.id, input.highlight) ? 1 : DIMMED
    return [{ type: 'Feature', properties: { sysid: v.sysid, plan: plan.id, color: colour(plan.id), opacity }, geometry: { type: 'LineString', coordinates: [[v.lon, v.lat], [start.lon, start.lat]] } }]
  })
  const vehicles = placed.map((v): OverlayVehicle => {
    const plan = planOf(input.assignments, v.sysid)
    const known = plan !== null && byId.has(plan)
    return { sysid: v.sysid, lat: v.lat, lon: v.lon, color: known ? colour(plan) : null, opacity: vehicleLit(v.sysid, plan, input.highlight) ? 1 : DIMMED }
  })
  return {
    routes: collection(parts.flatMap((x) => x.route)),
    points: collection(parts.flatMap((x) => x.points)),
    labels: collection(parts.flatMap((x) => x.label)),
    links: collection(links),
    vehicles,
  }
}

const vehiclePoint = (v: VehicleState): LatLon => ({ lat: v.lat, lon: v.lon })

/** Opening the board: every plan's frame and every vehicle with a position. */
export function fitAllPoints(plans: readonly OverlayPlan[], vehicles: readonly VehicleState[]): LatLon[] {
  const planPts = plans.flatMap((p) => framePoints(fromMission(p.mission)))
  return [...planPts, ...vehicles.filter(vehicleHasPosition).map(vehiclePoint)]
}

/** A double-tap on a card (§4.3): a plan frames itself; a vehicle frames itself and its plan's start. */
export function focusPoints(target: FocusTarget, plans: readonly OverlayPlan[], vehicles: readonly VehicleState[], assignments: Assignments): FocusResult {
  if ('plan' in target) {
    const plan = plans.find((p) => p.id === target.plan)
    return { points: plan ? framePoints(fromMission(plan.mission)) : [] }
  }
  const v = vehicles.find((x) => x.sysid === target.vehicle)
  if (!v || !vehicleHasPosition(v)) return { error: 'noPosition' }
  const plan = plans.find((p) => p.id === planOf(assignments, v.sysid))
  const start = plan ? planStart(plan.mission) : null
  return { points: start ? [vehiclePoint(v), start] : [vehiclePoint(v)] }
}
