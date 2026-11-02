import { describe, expect, it } from 'vitest'
import type { VehicleState } from '../../shared/api/types'
import { CATALOG, REQUIRES_CONFIRM, catalogGroups, commandName, modesFor, takeoffKind } from './catalog'

const v = (armed: boolean): VehicleState => ({
  sysid: 1, name: 'UAV-01', kind: 'copter', mode: 'LOITER', armed, lat: 0, lon: 0, alt_rel: 0, alt_msl: 0, hdg: null,
  ground_speed: 0, climb: 0, battery: { pct: 50, volt: 22, current: null }, link: 'ok', last_rx_ms: 0,
  gps: { fix: 3, sats: 9, hdop: 1 }, warn: false, unread: 0,
})

describe('command catalog', () => {
  it('confirm set matches the server (rgcs-core VehicleCommand::requires_confirm)', () => {
    expect([...REQUIRES_CONFIRM].sort()).toEqual(['arm', 'disarm', 'mission_start', 'takeoff'])
  })

  it('every item is a known VehicleCommand name or opens a modal', () => {
    const names = ['pause', 'resume', 'rtl', 'land', 'change_alt', 'change_speed', 'set_mode', 'mission_start', 'mission_resume', 'takeoff', 'arm', 'disarm']
    for (const item of CATALOG) {
      // `other` is the design's disabled placeholder for "その他の対応コマンド" (no command yet).
      const placeholder = item.name === 'other' && item.build === undefined && !item.enabled(v(false))
      expect(names.includes(item.name) || item.opens !== undefined || placeholder, item.name).toBe(true)
    }
    expect(catalogGroups().map((g) => g.group)).toEqual(['flight', 'move', 'mode', 'payload'])
  })

  it('ARM is disabled when armed, DISARM when disarmed; camera opens its settings and nothing is dead', () => {
    const by = (n: string) => CATALOG.find((i) => i.name === n)!
    expect(by('arm').enabled(v(true))).toBe(false)
    expect(by('arm').enabled(v(false))).toBe(true)
    expect(by('disarm').enabled(v(false))).toBe(false)
    expect(by('camera').enabled(v(false))).toBe(true)
    expect(by('camera').opens).toBe('camera')
    expect(CATALOG.some((i) => i.name === 'other')).toBe(false)
  })

  it('builds parameterised commands in the real serde shape', () => {
    const by = (n: string) => CATALOG.find((i) => i.name === n)!
    expect(by('set_mode').build!({ mode: 'AUTO' })).toEqual({ cmd: 'set_mode', args: { mode: 'AUTO' } })
    expect(by('change_alt').build!({ value: 50 })).toEqual({ cmd: 'change_alt', args: { alt_rel: 50 } })
    expect(by('arm').build!({})).toEqual({ cmd: 'arm' })
    expect(commandName({ cmd: 'change_speed', args: { mps: 3 } })).toBe('change_speed')
  })

  it('arm / disarm lead the flight group before takeoff; takeoff needs an armed vehicle and builds the serde shape', () => {
    const by = (n: string) => CATALOG.find((i) => i.name === n)!
    expect(catalogGroups()[0]!.items.slice(0, 3).map((i) => i.name)).toEqual(['arm', 'disarm', 'takeoff'])
    expect(by('takeoff').enabled(v(false))).toBe(false)
    expect(by('takeoff').enabled(v(true))).toBe(true)
    expect(by('takeoff').build!({ value: 25 })).toEqual({ cmd: 'takeoff', args: { alt_rel: 25 } })
    expect(by('takeoff').build!({ value: Number.NaN })).toBeNull()
  })

  it('takes off per airframe: climb to an altitude, fixed wing to TKOFF_ALT, rover never', () => {
    expect(takeoffKind({ kind: 'copter' })).toBe('climb')
    expect(takeoffKind({ kind: 'plane', vtol: true })).toBe('climb')
    expect(takeoffKind({ kind: 'plane' })).toBe('tkoff_alt')
    expect(takeoffKind({ kind: 'rover' })).toBeNull()
    expect(takeoffKind({ kind: 'other' })).toBeNull()
    const item = CATALOG.find((i) => i.name === 'takeoff')!
    expect(item.available?.({ ...v(true), kind: 'rover' })).toBe(false)
    expect(item.available?.(v(true))).toBe(true)
  })

  it('gives each airframe the modes its operators use most, and its own full list', () => {
    expect(modesFor({ kind: 'copter' }).quick).toEqual(['STABILIZE', 'ALT_HOLD', 'LOITER', 'POSHOLD', 'GUIDED', 'AUTO', 'RTL', 'LAND'])
    expect(modesFor({ kind: 'plane' }).quick).toEqual(['MANUAL', 'FBWA', 'FBWB', 'CRUISE', 'LOITER', 'GUIDED', 'AUTO', 'RTL'])
    expect(modesFor({ kind: 'plane', vtol: true }).quick).toEqual(['QHOVER', 'QLOITER', 'QLAND', 'QRTL', 'FBWA', 'LOITER', 'AUTO', 'RTL'])
    expect(modesFor({ kind: 'rover' }).quick).toEqual(['MANUAL', 'ACRO', 'HOLD', 'LOITER', 'GUIDED', 'AUTO', 'RTL', 'SMART_RTL'])
    expect(modesFor({ kind: 'other' })).toEqual(modesFor({ kind: 'copter' }))
    expect(modesFor({ kind: 'plane' }).all).not.toContain('QHOVER')
    expect(modesFor({ kind: 'rover' }).all).not.toContain('LAND')
    for (const v of [{ kind: 'copter' }, { kind: 'plane' }, { kind: 'plane', vtol: true }, { kind: 'rover' }] as const) {
      const { quick, all } = modesFor(v)
      expect(quick.filter((m) => !all.includes(m))).toEqual([])
      expect(new Set(all).size).toBe(all.length)
    }
  })
})
