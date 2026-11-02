// Vehicle parameters the predicted path needs (ArduPlane 4.7 names and defaults, checked in the
// source 2026-10-20). Missing values fall back to the defaults and are reported as `missing`.

export interface PlaneParams {
  /** AIRSPEED_CRUISE (m/s): speed around loiters and along legs. */
  readonly airspeed: number
  /** WP_LOITER_RAD (m, negative = counter-clockwise) for loiters without their own radius. */
  readonly loiterRad: number
  /** ROLL_LIMIT_DEG: the tightest turn is v² / (g·tan φ). */
  readonly rollLimitDeg: number
  /** TECS_CLMB_MAX / TECS_SINK_MAX (m/s). */
  readonly climb: number
  readonly sink: number
  /** ALT_SLOPE_MIN (m): smaller altitude changes are flown at once, larger ones spread over the leg. */
  readonly altSlopeMin: number
  /** FLIGHT_OPTIONS bit 14: climb at once in AUTO instead of along the leg. */
  readonly flightOptions: number
  /** Q_ENABLE: a QuadPlane takes off / lands vertically and can hover. */
  readonly quadplane: boolean
  /** Q_OPTIONS bit 1 / 2: NAV_TAKEOFF / NAV_LAND flown as fixed wing. */
  readonly qOptions: number
  /** NAVL1_PERIOD / NAVL1_DAMPING: the L1 look-ahead is period·damping/π·speed. */
  readonly navL1Period: number
  readonly navL1Damping: number
  /** Q_WP_SPD / _UP / _DN (m/s) while in VTOL. */
  readonly qWpSpeed: number
  readonly qWpUp: number
  readonly qWpDn: number
  /** WP_RADIUS (m): a waypoint counts as reached this far out (capped by the L1 distance). */
  readonly wpRadius: number
}

export const PLANE_DEFAULTS: PlaneParams = {
  airspeed: 12,
  loiterRad: 60,
  rollLimitDeg: 45,
  climb: 5,
  sink: 5,
  altSlopeMin: 15,
  flightOptions: 0,
  quadplane: false,
  qOptions: 0,
  navL1Period: 17,
  navL1Damping: 0.75,
  qWpSpeed: 5,
  qWpUp: 2.5,
  qWpDn: 1.5,
  wpRadius: 90,
}

const NAMES: Readonly<Record<keyof PlaneParams, string>> = {
  airspeed: 'AIRSPEED_CRUISE',
  loiterRad: 'WP_LOITER_RAD',
  rollLimitDeg: 'ROLL_LIMIT_DEG',
  climb: 'TECS_CLMB_MAX',
  sink: 'TECS_SINK_MAX',
  altSlopeMin: 'ALT_SLOPE_MIN',
  flightOptions: 'FLIGHT_OPTIONS',
  quadplane: 'Q_ENABLE',
  qOptions: 'Q_OPTIONS',
  navL1Period: 'NAVL1_PERIOD',
  navL1Damping: 'NAVL1_DAMPING',
  qWpSpeed: 'Q_WP_SPD',
  wpRadius: 'WP_RADIUS',
  qWpUp: 'Q_WP_SPD_UP',
  qWpDn: 'Q_WP_SPD_DN',
}

export const PLANE_PARAM_NAMES: readonly string[] = Object.values(NAMES)

/** Builds the parameter set from a name → value map; `missing` lists the names that used defaults. */
export function planeParams(values: ReadonlyMap<string, number>): { readonly params: PlaneParams; readonly missing: readonly string[] } {
  const keys = Object.keys(NAMES) as (keyof PlaneParams)[]
  const missing = keys.filter((k) => !values.has(NAMES[k])).map((k) => NAMES[k])
  const num = (k: keyof PlaneParams) => values.get(NAMES[k]) ?? (PLANE_DEFAULTS[k] as number)
  const params: PlaneParams = {
    airspeed: num('airspeed') > 0 ? num('airspeed') : PLANE_DEFAULTS.airspeed,
    loiterRad: num('loiterRad'),
    rollLimitDeg: Math.min(80, Math.max(5, num('rollLimitDeg'))),
    climb: num('climb') > 0 ? num('climb') : PLANE_DEFAULTS.climb,
    sink: num('sink') > 0 ? num('sink') : PLANE_DEFAULTS.sink,
    altSlopeMin: num('altSlopeMin'),
    flightOptions: num('flightOptions'),
    quadplane: values.has(NAMES.quadplane) ? (values.get(NAMES.quadplane) ?? 0) >= 1 : PLANE_DEFAULTS.quadplane,
    qOptions: num('qOptions'),
    navL1Period: num('navL1Period') > 0 ? num('navL1Period') : PLANE_DEFAULTS.navL1Period,
    navL1Damping: num('navL1Damping') > 0 ? num('navL1Damping') : PLANE_DEFAULTS.navL1Damping,
    qWpSpeed: num('qWpSpeed') > 0 ? num('qWpSpeed') : PLANE_DEFAULTS.qWpSpeed,
    qWpUp: num('qWpUp') > 0 ? num('qWpUp') : PLANE_DEFAULTS.qWpUp,
    qWpDn: num('qWpDn') > 0 ? num('qWpDn') : PLANE_DEFAULTS.qWpDn,
    wpRadius: Math.max(0, num('wpRadius')),
  }
  return { params, missing }
}
