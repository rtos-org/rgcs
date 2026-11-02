import { describe, expect, it } from 'vitest'
import type { VehicleState } from '../../shared/api/types'
import { canStop, intervalCommand, intervalUs, isHeartbeat, MAV_CMD_SET_MESSAGE_INTERVAL, parseHz, rateAllowed, rateGate } from './rate'

describe('parseHz', () => {
  it('accepts 0 < hz <= 50', () => {
    expect(parseHz('10')).toBe(10)
    expect(parseHz(' 0.5 ')).toBe(0.5)
    expect(parseHz('50')).toBe(50)
  })
  it('rejects empty, zero, negative, non-numeric, infinite and > 50', () => {
    for (const s of ['', ' ', '0', '-1', 'abc', 'Infinity', 'NaN', '50.1', '1e9']) expect(parseHz(s)).toBeNull()
  })
})

describe('intervalCommand', () => {
  it('maps hz to microseconds', () => {
    expect(intervalUs(10)).toBe(100000)
    expect(intervalUs(3)).toBe(333333)
  })
  it('builds SET_MESSAGE_INTERVAL (511) as an other command', () => {
    expect(MAV_CMD_SET_MESSAGE_INTERVAL).toBe(511)
    expect(intervalCommand(30, 100000)).toEqual({ cmd: 'other', args: { mav_cmd: 511, params: [30, 100000, 0, 0, 0, 0, 0] } })
  })
})

describe('core telemetry guards', () => {
  it('HEARTBEAT is never re-rated', () => {
    expect(isHeartbeat(0)).toBe(true)
    expect(isHeartbeat(30)).toBe(false)
  })
  it('stop is refused for core telemetry while armed only', () => {
    for (const id of [0, 1, 24, 30, 33, 42, 74]) {
      expect(canStop(id, true)).toBe(false)
      expect(canStop(id, false)).toBe(true)
    }
    expect(canStop(253, true)).toBe(true)
  })
  it('a core rate below 0.5 Hz is refused while armed', () => {
    expect(rateAllowed(0.4, 30, true)).toBe(false)
    expect(rateAllowed(0.5, 30, true)).toBe(true)
    expect(rateAllowed(0.4, 30, false)).toBe(true)
    expect(rateAllowed(0.1, 253, true)).toBe(true)
  })
})

describe('rateGate', () => {
  const state = (v: Partial<VehicleState>) => ({ vehicles: new Map([[1, { sysid: 1, link: 'ok', armed: false, lat: 0, ...v } as VehicleState]]) })
  it('changes only with the link or the arming state, not with telemetry', () => {
    expect(rateGate(state({ lat: 1 }), 1)).toBe(rateGate(state({ lat: 2 }), 1))
    expect(rateGate(state({ armed: true }), 1)).not.toBe(rateGate(state({}), 1))
    expect(rateGate(state({ link: 'lost' }), 1)).toBe('lost')
    expect(rateGate(state({}), 9)).toBe('unknown')
  })
})
