import { describe, expect, it } from 'vitest'
import { DEFAULT_PROFILE } from './profile'
import { applyDeadzone, axesToRates, buttonEdges, buttonReleases } from './mapping'

describe('gimbal mapping', () => {
  it('rescales outside the deadzone and zeroes inside it', () => {
    expect(applyDeadzone(0.05, 0.08)).toBe(0)
    expect(applyDeadzone(-0.05, 0.08)).toBe(0)
    expect(applyDeadzone(0.5, 0.08)).toBeCloseTo(0.4565, 3)
    expect(applyDeadzone(1, 0.08)).toBe(1)
    expect(applyDeadzone(-1, 0.08)).toBe(-1)
    expect(applyDeadzone(0.5, 0)).toBe(0.5)
  })

  it('maps pan/tilt axes with invert, scale and max speeds to rounded clamped rates', () => {
    expect(axesToRates([0.5, -1], DEFAULT_PROFILE)).toEqual({ yaw: 14, pitch: 20 })
    expect(axesToRates([0, 0], DEFAULT_PROFILE)).toEqual({ yaw: 0, pitch: 0 })
    const fast = { ...DEFAULT_PROFILE, max_pan_speed: 100, max_tilt_speed: 100, axes: DEFAULT_PROFILE.axes.map((a) => ({ ...a, scale: 2 })) }
    expect(axesToRates([1, 1], fast)).toEqual({ yaw: 100, pitch: -100 })
    expect(axesToRates([], DEFAULT_PROFILE)).toEqual({ yaw: 0, pitch: 0 })
  })

  it('reports rising edges only', () => {
    expect(buttonEdges([false, false], [true, false], DEFAULT_PROFILE)).toEqual(['record_toggle'])
    expect(buttonEdges([true, false], [true, true], DEFAULT_PROFILE)).toEqual(['shutter'])
    expect(buttonEdges([true], [false], DEFAULT_PROFILE)).toEqual([])
    expect(buttonEdges([], [false, false, false, false, false, false, false, false, true], DEFAULT_PROFILE)).toEqual([])
  })

  it('reports falling edges of mapped buttons', () => {
    const p = { ...DEFAULT_PROFILE, buttons: [{ button: 0, fn: 'focus_near' as const }] }
    expect(buttonReleases([true], [false], p)).toEqual(['focus_near'])
    expect(buttonReleases([true], [true], p)).toEqual([])
    expect(buttonReleases([false], [false], p)).toEqual([])
  })
})
