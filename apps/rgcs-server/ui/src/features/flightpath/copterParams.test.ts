import { describe, expect, it } from 'vitest'
import { COPTER_DEFAULTS, COPTER_PARAM_NAMES, copterParams } from './copterParams'

describe('ArduCopter path parameters', () => {
  it('uses the defaults of ArduCopter master when nothing was read, and lists what is missing', () => {
    const { params, missing } = copterParams(new Map())
    expect(params).toEqual(COPTER_DEFAULTS)
    expect(COPTER_DEFAULTS).toMatchObject({ speed: 10, radius: 2, up: 2.5, down: 1.5, accel: 2.5, jerk: 1, rtlAlt: 15, rtlAltFinal: 0, rtlClimbMin: 0, rtlConeSlope: 3 })
    expect(missing).toContain('WP_SPD')
  })

  it('reads the metre names of 4.7+ and the centimetre WPNAV_* / RTL_* names of older firmware', () => {
    const old = copterParams(new Map([['WPNAV_SPEED', 500], ['WPNAV_RADIUS', 300], ['WPNAV_SPEED_UP', 150], ['WPNAV_SPEED_DN', 100], ['WPNAV_ACCEL', 100], ['WPNAV_JERK', 2], ['RTL_ALT', 3000], ['RTL_ALT_FINAL', 200], ['RTL_CLIMB_MIN', 500], ['RTL_CONE_SLOPE', 0], ['WPNAV_ACCEL_C', 400]]))
    expect(old.params).toEqual({ speed: 5, radius: 3, up: 1.5, down: 1, accel: 1, jerk: 2, accelCorner: 4, rtlAlt: 30, rtlAltFinal: 2, rtlClimbMin: 5, rtlConeSlope: 0 })
    expect(old.missing).toEqual([])
    const both = copterParams(new Map([['WP_SPD', 7], ['WPNAV_SPEED', 500]]))
    expect(both.params.speed).toBe(7)
  })

  it('asks the vehicle for both spellings', () => {
    expect(COPTER_PARAM_NAMES).toEqual(expect.arrayContaining(['WP_SPD', 'WPNAV_SPEED', 'RTL_ALT_M', 'RTL_ALT', 'WP_ACC_CNR', 'WPNAV_ACCEL_C']))
  })

  it('keeps unusable values off the path (a zero speed would never arrive)', () => {
    const { params } = copterParams(new Map([['WP_SPD', 0], ['WP_ACC', -1], ['WP_RADIUS_M', -5]]))
    expect(params.speed).toBe(COPTER_DEFAULTS.speed)
    expect(params.accel).toBe(COPTER_DEFAULTS.accel)
    expect(params.radius).toBe(0)
  })
})
