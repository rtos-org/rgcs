import { describe, expect, it } from 'vitest'
import { PLANE_DEFAULTS, PLANE_PARAM_NAMES, planeParams } from './params'

describe('plane parameters for the predicted path', () => {
  it('reads the vehicle values and lists what fell back to the defaults', () => {
    const { params, missing } = planeParams(new Map([['WP_LOITER_RAD', -80], ['Q_ENABLE', 1], ['AIRSPEED_CRUISE', 18]]))
    expect(params).toMatchObject({ loiterRad: -80, quadplane: true, airspeed: 18, climb: PLANE_DEFAULTS.climb })
    expect(missing).not.toContain('WP_LOITER_RAD')
    expect(missing).toContain('TECS_CLMB_MAX')
    expect(missing).toHaveLength(PLANE_PARAM_NAMES.length - 3)
  })
  it('ignores values that would break the geometry', () => {
    const { params } = planeParams(new Map([['AIRSPEED_CRUISE', 0], ['ROLL_LIMIT_DEG', 90], ['TECS_CLMB_MAX', -1]]))
    expect(params.airspeed).toBe(PLANE_DEFAULTS.airspeed)
    expect(params.rollLimitDeg).toBe(80)
    expect(params.climb).toBe(PLANE_DEFAULTS.climb)
  })
})
