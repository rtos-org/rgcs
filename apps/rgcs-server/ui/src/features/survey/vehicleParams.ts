// Vehicle parameters the survey reads (never writes): warnings and creation defaults. ArduPlane /
// AP_Camera names checked in the source 2026-10-21; the alternates the review named are read too.
import type { VehicleKind } from '../../shared/api/types'
import { pathParamNames } from '../flightpath/predict'

/** What the survey checks know of the vehicle; an absent value skips its check. */
export interface SurveyVehicle {
  /** NAVL1_PERIOD / NAVL1_DAMPING (absent: ArduPlane defaults). */
  readonly navL1Period?: number
  readonly navL1Damping?: number
  /** CAM_MAX_ROLL (CAM1_MAX_ROLL): 0 shoots whatever the roll. */
  readonly camMaxRoll?: number
  /** Q_ASSIST_SPEED (Q_ASSIST_SPD): ≤ 0 = no assist. */
  readonly assistSpeed?: number
  /** AIRSPEED_MIN (m/s). */
  readonly airspeedMin?: number
}

const CAM_ROLL = ['CAM_MAX_ROLL', 'CAM1_MAX_ROLL']
const ASSIST = ['Q_ASSIST_SPEED', 'Q_ASSIST_SPD']
const PLANE_ONLY = [...ASSIST, 'AIRSPEED_MIN']

const NAMES: Readonly<Record<'plane' | 'copter', readonly string[]>> = {
  plane: [...pathParamNames('plane'), ...CAM_ROLL, ...PLANE_ONLY],
  copter: [...pathParamNames('copter'), ...CAM_ROLL],
}
const NONE: readonly string[] = []

/** The names to read from a vehicle of this kind: its flight model's plus the survey's (stable arrays). */
export function vehicleParamNames(kind: VehicleKind | null): readonly string[] {
  return kind === 'plane' || kind === 'copter' ? NAMES[kind] : NONE
}

const first = (values: ReadonlyMap<string, number>, names: readonly string[]): number | undefined => names.map((n) => values.get(n)).find((v) => v !== undefined)

/** The survey's view of the read values; names the vehicle did not answer stay absent. */
export function surveyVehicle(values: ReadonlyMap<string, number>): SurveyVehicle {
  const entries = {
    navL1Period: values.get('NAVL1_PERIOD'),
    navL1Damping: values.get('NAVL1_DAMPING'),
    camMaxRoll: first(values, CAM_ROLL),
    assistSpeed: first(values, ASSIST),
    airspeedMin: values.get('AIRSPEED_MIN'),
  }
  return Object.fromEntries(Object.entries(entries).filter(([, v]) => v !== undefined))
}
