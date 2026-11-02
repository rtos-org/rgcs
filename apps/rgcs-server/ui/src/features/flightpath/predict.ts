import type { GeoPoint, Home, MissionItem, VehicleKind } from '../../shared/api/types'
import type { Predicted } from '../mission/missionAir'
import { COPTER_PARAM_NAMES, copterParams, type CopterParams } from './copterParams'
import { predictCopter } from './copterPath'
import { PLANE_PARAM_NAMES, planeParams, type PlaneParams } from './params'
import { predictPlaneParts } from './planePath'

interface Plan {
  readonly items: readonly MissionItem[]
  readonly mission: { readonly home: Home | null }
}

/** Which flight model predicts the path, with its parameters. */
export type PathModel = { readonly kind: 'plane'; readonly params: PlaneParams } | { readonly kind: 'copter'; readonly params: CopterParams }

/** The parameter names to read from a vehicle of this kind (none: no prediction). */
export function pathParamNames(kind: VehicleKind | null): readonly string[] {
  return kind === 'plane' ? PLANE_PARAM_NAMES : kind === 'copter' ? COPTER_PARAM_NAMES : []
}

/** The model for a vehicle kind from the values read so far; null for rovers / unknown vehicles. */
export function pathModel(kind: VehicleKind | null, values: ReadonlyMap<string, number>): PathModel | null {
  if (kind === 'plane') return { kind, params: planeParams(values).params }
  if (kind === 'copter') return { kind, params: copterParams(values).params }
  return null
}

/** The expected flight for a plan, from its home (or the vehicle's) — null without a home to start at. */
export function predictFor(plan: Plan, model: PathModel, vehicleHome: GeoPoint | null): Predicted | null {
  const home: Home | null = plan.mission.home ?? (vehicleHome ? { lat: vehicleHome.lat, lon: vehicleHome.lon, alt: vehicleHome.alt } : null)
  if (!home) return null
  const at = { lat: home.lat, lon: home.lon }
  if (model.kind === 'plane') return { home: at, ...predictPlaneParts(plan.items, home, model.params) }
  const points = predictCopter(plan.items, home, model.params)
  return { home: at, points, missionEnd: points.length }
}
