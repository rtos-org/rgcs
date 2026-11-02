import { describe, expect, it } from 'vitest'
import { PITCH_PX_PER_DEG, compassTransform, fmtHeading, fmtSigned, horizonTransform, readAttitude, readHeading, ROLL_TICKS, COMPASS_TICKS } from './instruments'

describe('instrument geometry', () => {
  it('the horizon rotates by −roll and moves down when the nose is up', () => {
    expect(horizonTransform(12, 4)).toBe(`rotate(-12) translate(0 ${4 * PITCH_PX_PER_DEG})`)
    expect(horizonTransform(-30, -10)).toBe(`rotate(30) translate(0 ${-10 * PITCH_PX_PER_DEG})`)
  })

  it('keeps ±30° of pitch inside the disc and clamps extreme pitch', () => {
    expect(30 * PITCH_PX_PER_DEG).toBeLessThan(45)
    expect(horizonTransform(0, 90)).toBe(horizonTransform(0, 60))
    expect(horizonTransform(0, -90)).toBe(horizonTransform(0, -60))
  })

  it('the compass card turns by −heading', () => {
    expect(compassTransform(87)).toBe('rotate(-87)')
    expect(compassTransform(0)).toBe('rotate(0)')
  })

  it('roll ticks sit at 0/10/20/30/45/60° each side', () => {
    expect(ROLL_TICKS.map((t) => t.deg)).toEqual([-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60])
  })

  it('the compass card has a tick every 30° and four cardinal letters', () => {
    expect(COMPASS_TICKS.map((t) => t.deg)).toEqual([0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330])
    expect(COMPASS_TICKS.filter((t) => t.label).map((t) => t.label)).toEqual(['N', 'E', 'S', 'W'])
  })
})

describe('instrument formatting', () => {
  it('signs roll and pitch as integers', () => {
    expect(fmtSigned(-12.4)).toBe('−12°')
    expect(fmtSigned(3.6)).toBe('+4°')
    expect(fmtSigned(-0.2)).toBe('0°')
    expect(fmtSigned(null)).toBe('—')
  })

  it('pads the heading to three digits and wraps it to 0–359', () => {
    expect(fmtHeading(87.2)).toBe('087°')
    expect(fmtHeading(359.6)).toBe('000°')
    expect(fmtHeading(-5)).toBe('355°')
    expect(fmtHeading(null)).toBe('—')
  })

  it('treats absent or non-finite telemetry as no data', () => {
    expect(readAttitude(undefined)).toBeNull()
    expect(readAttitude(null)).toBeNull()
    expect(readAttitude({ roll: Number.NaN, pitch: 1 })).toBeNull()
    expect(readAttitude({ roll: 1, pitch: 2 })).toEqual({ roll: 1, pitch: 2 })
    expect(readHeading(null)).toBeNull()
    expect(readHeading(Number.POSITIVE_INFINITY)).toBeNull()
    expect(readHeading(12)).toBe(12)
  })
})
