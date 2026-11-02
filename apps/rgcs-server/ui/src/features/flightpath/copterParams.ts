// Vehicle parameters the ArduCopter predicted path needs (checked in ArduPilot master 2026-10-20:
// AC_WPNav.cpp, mode_rtl.cpp, config.h). 4.7 renamed WPNAV_* (cm) to WP_* (m) and RTL_ALT (cm) to
// RTL_ALT_M; both spellings are read, the new one first. Missing values use master's defaults.

export interface CopterParams {
  /** WP_SPD (m/s): horizontal speed between waypoints. */
  readonly speed: number
  /** WP_RADIUS_M (m): a fast waypoint's turn mid point stays inside this radius. */
  readonly radius: number
  /** WP_SPD_UP / WP_SPD_DN (m/s). */
  readonly up: number
  readonly down: number
  /** WP_ACC (m/s²) and WP_JERK (m/s³): the S-curve speed ramps. */
  readonly accel: number
  readonly jerk: number
  /** WP_ACC_CNR (m/s²), 0 = twice WP_ACC: the largest sideways acceleration in a turn. */
  readonly accelCorner: number
  /** RTL_ALT_M, RTL_ALT_FINAL_M, RTL_CLIMB_MIN_M (m) and RTL_CONE_SLOPE. */
  readonly rtlAlt: number
  readonly rtlAltFinal: number
  readonly rtlClimbMin: number
  readonly rtlConeSlope: number
}

export const COPTER_DEFAULTS: CopterParams = {
  speed: 10,
  radius: 2,
  up: 2.5,
  down: 1.5,
  accel: 2.5,
  jerk: 1,
  accelCorner: 0,
  rtlAlt: 15,
  rtlAltFinal: 0,
  rtlClimbMin: 0,
  rtlConeSlope: 3,
}

/** New name, older name and the factor that turns the older value into the new unit. */
const NAMES: Readonly<Record<keyof CopterParams, readonly [string, string, number]>> = {
  speed: ['WP_SPD', 'WPNAV_SPEED', 0.01],
  radius: ['WP_RADIUS_M', 'WPNAV_RADIUS', 0.01],
  up: ['WP_SPD_UP', 'WPNAV_SPEED_UP', 0.01],
  down: ['WP_SPD_DN', 'WPNAV_SPEED_DN', 0.01],
  accel: ['WP_ACC', 'WPNAV_ACCEL', 0.01],
  jerk: ['WP_JERK', 'WPNAV_JERK', 1],
  accelCorner: ['WP_ACC_CNR', 'WPNAV_ACCEL_C', 0.01],
  rtlAlt: ['RTL_ALT_M', 'RTL_ALT', 0.01],
  rtlAltFinal: ['RTL_ALT_FINAL_M', 'RTL_ALT_FINAL', 0.01],
  rtlClimbMin: ['RTL_CLIMB_MIN_M', 'RTL_CLIMB_MIN', 0.01],
  rtlConeSlope: ['RTL_CONE_SLOPE', 'RTL_CONE_SLOPE', 1],
}

/** Values that must be positive for the vehicle to move at all; the rest only must not be negative. */
const POSITIVE: ReadonlySet<keyof CopterParams> = new Set(['speed', 'up', 'down', 'accel', 'jerk'])

export const COPTER_PARAM_NAMES: readonly string[] = [...new Set(Object.values(NAMES).flatMap(([a, b]) => [a, b]))]

/** Builds the parameter set from a name → value map; `missing` lists the (new) names read in neither spelling. */
export function copterParams(values: ReadonlyMap<string, number>): { readonly params: CopterParams; readonly missing: readonly string[] } {
  const keys = Object.keys(NAMES) as (keyof CopterParams)[]
  const read = (k: keyof CopterParams): number | undefined => {
    const [name, old, scale] = NAMES[k]
    const v = values.get(name)
    if (v !== undefined) return v
    const o = values.get(old)
    return o === undefined ? undefined : o * scale
  }
  const pick = (k: keyof CopterParams): number => {
    const v = read(k)
    if (v === undefined) return COPTER_DEFAULTS[k]
    if (POSITIVE.has(k)) return v > 0 ? v : COPTER_DEFAULTS[k]
    return Math.max(0, v)
  }
  const params = Object.fromEntries(keys.map((k) => [k, pick(k)])) as unknown as CopterParams
  return { params, missing: keys.filter((k) => read(k) === undefined).map((k) => NAMES[k][0]) }
}
