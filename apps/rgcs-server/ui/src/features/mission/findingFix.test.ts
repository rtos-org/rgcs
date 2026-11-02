import { describe, expect, it } from 'vitest'
import type { MissionItem } from '../../shared/api/types'
import { dictionaries } from '../../shared/i18n'
import { findingFix } from './findingFix'
import { fromMission, type Draft } from './model'

const ja = dictionaries.ja
const item = (command: number, params: [number, number, number, number] = [0, 0, 0, 0], lat = 33.66, lon = 135.9): MissionItem => ({ command, frame: 'rel', params, lat, lon, alt: 80, autocontinue: true })
const draft = (items: MissionItem[]): Draft => fromMission({ name: 't', default_frame: 'rel', default_alt: 50, cruise_speed: 8, items, surveys: [] } as never)
const ctx = { takeoff: 'TAKEOFF' as const, dict: ja }

describe('findingFix', () => {
  it('moves a LOITER_TO_ALT radius from param1 to param2', () => {
    const d = draft([item(84), item(31, [100, 0, 0, 1])])
    const fix = findingFix({ code: 'param_ignored', seq: 2, param: { index: 1, sent: 100, stored: 0 } }, d, ctx)
    expect(fix?.label).toBe('半径に移す')
    expect(fix?.apply(d).items[1]?.params).toEqual([0, 100, 0, 1])
  })

  it('clears a dropped param when there is nowhere to move it', () => {
    const d = draft([item(22), item(31, [100, 30, 0, 0])])
    const fix = findingFix({ code: 'param_ignored', seq: 2, param: { index: 1, sent: 100, stored: 0 } }, d, ctx)
    expect(fix?.label).toBe('0 にする')
    expect(fix?.apply(d).items[1]?.params).toEqual([0, 30, 0, 0])
  })

  it('sets a changed param to the value ArduPilot keeps', () => {
    const d = draft([item(22), item(16, [2.5, 0, 0, 0])])
    const fix = findingFix({ code: 'param_ignored', seq: 2, param: { index: 1, sent: 2.5, stored: 2 } }, d, ctx)
    expect(fix?.label).toBe('2 にする')
    expect(fix?.apply(d).items[1]?.params).toEqual([2, 0, 0, 0])
  })

  it('adds the airframe takeoff first, without coordinates', () => {
    const d = draft([item(16), item(20)])
    const fix = findingFix({ code: 'first_not_takeoff', seq: 1 }, d, { ...ctx, takeoff: 'VTOL_TAKEOFF' })
    expect(fix?.label).toBe('先頭に VTOL 離陸 を追加')
    const out = fix!.apply(d).items
    expect(out.map((it) => it.command)).toEqual([84, 16, 20])
    expect([out[0]?.lat, out[0]?.lon]).toEqual([0, 0])
  })

  it('offers no takeoff for a rover', () => {
    expect(findingFix({ code: 'first_not_takeoff', seq: 1 }, draft([item(16)]), { ...ctx, takeoff: null })).toBeNull()
  })

  it('appends an RTL when the mission does not end with a landing', () => {
    const d = draft([item(22), item(16)])
    const fix = findingFix({ code: 'no_land_or_rtl', seq: 2 }, d, ctx)
    expect(fix?.label).toBe('末尾に 帰還 (RTL) を追加')
    expect(fix!.apply(d).items.map((it) => it.command)).toEqual([22, 16, 20])
  })

  it('removes a rover takeoff', () => {
    const d = draft([item(16), item(22), item(16)])
    const fix = findingFix({ code: 'rover_takeoff', seq: 2 }, d, ctx)
    expect(fix?.label).toBe('離陸 を削除')
    expect(fix!.apply(d).items.map((it) => it.command)).toEqual([16, 16])
  })

  it('has no fix for other codes, a missing item or a survey item', () => {
    const d = draft([item(22), item(16)])
    expect(findingFix({ code: 'long_flight', seq: null }, d, ctx)).toBeNull()
    expect(findingFix({ code: 'param_ignored', seq: 9, param: { index: 1, sent: 1, stored: 0 } }, d, ctx)).toBeNull()
    const surveyed: Draft = { ...d, surveys: [{ id: 's', uids: [2], spec: {} } as never] }
    expect(findingFix({ code: 'param_ignored', seq: 2, param: { index: 1, sent: 1, stored: 0 } }, surveyed, ctx)).toBeNull()
  })

  it('has an English label', () => {
    const d = draft([item(84), item(31, [100, 0, 0, 0])])
    expect(findingFix({ code: 'param_ignored', seq: 2, param: { index: 1, sent: 100, stored: 0 } }, d, { ...ctx, dict: dictionaries.en })?.label).toBe('Move to Radius')
  })
})
