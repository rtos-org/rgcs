// The spec a new survey starts from: the defaults, adjusted to the connected vehicle (read-only:
// airframe, bank ≤ ROLL_LIMIT_DEG, WP_RADIUS, AIRSPEED_CRUISE) and, for a plane, the lane skip
// that keeps consecutive lanes a turn diameter apart.
import type { SurveyCamera, VehicleKind } from '../../shared/api/types'
import { planeParams } from '../flightpath/params'
import type { LatLon } from '../mission/geo'
import { toValues } from './cameraApi'
import { footprint, laneSpacingM, turnRadiusM } from './photo'
import { ALPHA7R4, defaultSpec, type SurveyCameraValues, type SurveySpec } from './spec'
import { suggestSkip } from './warnings'

/** The connected vehicle: its kind and the parameters read from it. */
export interface DrawVehicle {
  readonly kind: VehicleKind
  readonly params: ReadonlyMap<string, number>
}

/** The bank the defaults never exceed (spec: 30°). */
const MAX_DEFAULT_BANK = 30
/** The spec's skip field allows 0–10. */
const MAX_SKIP = 10

const pickCamera = (cameras: readonly SurveyCamera[]): SurveyCameraValues => {
  const builtin = cameras.find((c) => c.builtin)
  return builtin ? toValues(builtin) : ALPHA7R4
}

type Opts = { airframe: SurveySpec['airframe']; bankDeg: number; wpRadiusM?: number; speedMs?: number }

/** Airframe, bank (≤ 30°, ROLL_LIMIT_DEG), WP_RADIUS and the plane's AIRSPEED_CRUISE; plane defaults without a vehicle. */
function vehicleOpts(v: DrawVehicle | null): Opts {
  const airframe = v?.kind === 'copter' ? 'copter' : 'plane'
  if (!v) return { airframe, bankDeg: MAX_DEFAULT_BANK }
  const { params } = planeParams(v.params)
  const bankDeg = v.params.has('ROLL_LIMIT_DEG') ? Math.min(MAX_DEFAULT_BANK, params.rollLimitDeg) : MAX_DEFAULT_BANK
  const wpRadiusM = v.params.has('WP_RADIUS') && params.wpRadius > 0 ? params.wpRadius : undefined
  const speedMs = airframe === 'plane' && v.params.has('AIRSPEED_CRUISE') && params.airspeed > 0 ? params.airspeed : undefined
  return { airframe, bankDeg, wpRadiusM, speedMs }
}

/** The lane skip a plane needs for its turns (0 for a copter). */
function defaultSkip(spec: SurveySpec): number {
  if (spec.airframe !== 'plane') return 0
  const spacing = laneSpacingM(footprint(spec.camera, spec.altM, spec.orientation), spec.sidePct)
  return Math.min(MAX_SKIP, suggestSkip(spacing, turnRadiusM(spec.speedMs + spec.windMs, spec.bankDeg)))
}

export function creationSpec(ring: readonly LatLon[], cameras: readonly SurveyCamera[], vehicle: DrawVehicle | null): SurveySpec {
  const { airframe, ...opts } = vehicleOpts(vehicle)
  const spec = defaultSpec(ring, pickCamera(cameras), airframe, opts)
  return { ...spec, skip: defaultSkip(spec) }
}
