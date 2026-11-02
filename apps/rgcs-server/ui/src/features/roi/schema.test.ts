import { describe, expect, it } from 'vitest'
import type { RoiTarget } from '../../shared/api/types'
import { firstIssue } from '../camera-settings/schema'
import { DEFAULT_ROI_CONTROL, emptyTargets, isSet, nextEmptySlot, pickInto, roiControlSchema, roiTargetsSchema } from './schema'

const named = (i: number, name: string): RoiTarget => ({ id: `roi_${i + 1}`, name, lat: 36.1, lon: 139.1, alt_msl: 400 })

describe('roi schema', () => {
  it('the defaults are valid', () => {
    expect(roiControlSchema.safeParse(DEFAULT_ROI_CONTROL).success).toBe(true)
    expect(roiTargetsSchema.safeParse(emptyTargets()).success).toBe(true)
    expect(DEFAULT_ROI_CONTROL).toMatchObject({ control_mode: 'rate', rate_hz: 10, pid_kp: 2, pid_ki: 0.2, max_speed: 60 })
  })

  it('reports each out-of-range control field by its own path', () => {
    const issue = (patch: object) => firstIssue(roiControlSchema.safeParse({ ...DEFAULT_ROI_CONTROL, ...patch }))?.path
    expect(issue({ max_speed: 101 })).toBe('max_speed')
    expect(issue({ max_speed: 0 })).toBe('max_speed')
    expect(issue({ rate_hz: 0 })).toBe('rate_hz')
    expect(issue({ rate_hz: 0.5 })).toBe('rate_hz')
    expect(issue({ rate_hz: 1 })).toBeUndefined()
    expect(issue({ rate_hz: 50 })).toBeUndefined()
    expect(issue({ yaw_offset_deg: 181 })).toBe('yaw_offset_deg')
    expect(issue({ pid_kp: 51 })).toBe('pid_kp')
    expect(issue({ deadband_deg: Number.NaN })).toBe('deadband_deg')
  })

  it('reports a long name with its slot index', () => {
    const targets = emptyTargets().map((t, i) => (i === 3 ? { ...t, name: 'x'.repeat(65) } : t))
    expect(firstIssue(roiTargetsSchema.safeParse(targets))?.path).toBe('3.name')
    expect(firstIssue(roiTargetsSchema.safeParse(targets.slice(0, 9)))).not.toBeNull()
    const badLat = emptyTargets().map((t, i) => (i === 1 ? { ...t, lat: 91 } : t))
    expect(firstIssue(roiTargetsSchema.safeParse(badLat))?.path).toBe('1.lat')
  })

  it('isSet needs a name and a non-zero position', () => {
    expect(isSet(named(0, 'A'))).toBe(true)
    expect(isSet(named(0, '  '))).toBe(false)
    expect(isSet({ ...named(0, 'A'), lat: 0, lon: 0 })).toBe(false)
  })

  it('nextEmptySlot skips set rows and returns the last index when all are set', () => {
    const t = emptyTargets().map((x, i) => (i < 2 ? named(i, `P${i}`) : x))
    expect(nextEmptySlot(t)).toBe(2)
    expect(nextEmptySlot(emptyTargets().map((_, i) => named(i, `P${i}`)))).toBe(9)
  })

  it('pickInto names an empty slot and keeps an existing name', () => {
    const t = emptyTargets().map((x, i) => (i === 0 ? named(0, '送電塔') : x))
    const at = { lat: 36.123456789, lon: 139.987654321, alt: 411.6 }
    const a = pickInto(t, 3, at)
    expect(a[3]).toEqual({ id: 'roi_4', name: 'ROI 4', lat: 36.123457, lon: 139.987654, alt_msl: 412 })
    expect(t[3]?.name).toBe('')
    expect(pickInto(t, 0, at)[0]?.name).toBe('送電塔')
  })
})
