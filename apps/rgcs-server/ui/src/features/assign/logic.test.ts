import { describe, expect, it } from 'vitest'
import type { Assignment, Mission, MissionItem, VehicleKind } from '../../shared/api/types'
import { PALETTE } from '../plans/palette'
import { assignedTo, batteryPct, cardStatus, compatibility, planColours, writeTargets, type CardStatus, type VersionedPlan } from './logic'

const item = (command: number, hold = 0): MissionItem => ({ command, frame: 'rel', params: [hold, 0, 0, 0], lat: 36.25, lon: 137.64, alt: 50, autocontinue: true })

const mission = (id: number, items: readonly MissionItem[]): Mission => ({
  id,
  name: `p${id}`,
  sysid: null,
  default_alt: 50,
  default_frame: 'rel',
  speed: 8,
  home: null,
  items: [...items],
  fence: [],
  rally: [],
  surveys: [],
})

const lib = (id: number, updated_at: number, items: readonly MissionItem[] = [item(22), item(16)]): VersionedPlan => ({ id, updated_at, mission: mission(id, items) })

const written = (plan_id: number, plan_updated_at: number) => ({ plan_id, plan_updated_at, at: 1, by: 'admin' })

const assign = (sysid: number, plan_id: number | null, w: Assignment['written'] = null): Assignment => ({ sysid, plan_id, assigned_by: 'admin', assigned_at: 1, written: w })

describe('cardStatus', () => {
  const plan = { id: 7, updated_at: 200 }
  const rows: readonly [string, Assignment | undefined, typeof plan | undefined, boolean, CardStatus][] = [
    ['no row is none', undefined, undefined, true, 'none'],
    ['no plan id is none', assign(1, null, written(7, 200)), undefined, true, 'none'],
    ['no plan id offline is none', assign(1, null), undefined, false, 'none'],
    ['never written online is pending', assign(1, 7), plan, true, 'pending'],
    ['never written offline is unknown', assign(1, 7), plan, false, 'unknown'],
    ['same id and version is ok', assign(1, 7, written(7, 200)), plan, true, 'ok'],
    ['same id and version offline is still ok', assign(1, 7, written(7, 200)), plan, false, 'ok'],
    ['same id, older version is updated', assign(1, 7, written(7, 100)), plan, true, 'updated'],
    ['same id, older version offline is updated', assign(1, 7, written(7, 100)), plan, false, 'updated'],
    ['another plan written is pending', assign(1, 7, written(3, 200)), plan, true, 'pending'],
    ['another plan written offline is pending', assign(1, 7, written(3, 200)), plan, false, 'pending'],
    ['assigned plan not loaded is pending', assign(1, 7, written(7, 200)), undefined, true, 'pending'],
  ]
  it.each(rows)('%s', (_name, a, p, online, want) => {
    expect(cardStatus(a, p, online)).toBe(want)
  })
})

describe('compatibility', () => {
  const takeoff = mission(1, [item(22), item(16)])
  const vtol = mission(2, [item(84), item(16)])
  const ground = mission(3, [item(16), item(16)])
  const empty = mission(4, [])
  const rows: readonly [string, Mission, VehicleKind, string | null][] = [
    ['rover with no takeoff', ground, 'rover', null],
    ['rover with a takeoff', takeoff, 'rover', 'asRoverNoTakeoff'],
    ['rover with a vtol takeoff', vtol, 'rover', 'asRoverNoTakeoff'],
    ['copter with a takeoff', takeoff, 'copter', null],
    ['plane with a vtol takeoff', vtol, 'plane', null],
    ['copter without a takeoff', ground, 'copter', 'asAirNeedsTakeoff'],
    ['plane without a takeoff', ground, 'plane', 'asAirNeedsTakeoff'],
    ['copter with an empty plan', empty, 'copter', 'asAirNeedsTakeoff'],
    ['rover with an empty plan', empty, 'rover', null],
    ['other kind flies like the server judges it', ground, 'other', 'asAirNeedsTakeoff'],
  ]
  it.each(rows)('%s', (_name, m, kind, want) => {
    expect(compatibility(m, kind)).toBe(want)
  })
})

describe('batteryPct', () => {
  // A takeoff then a 600 s hold: no home, so no distance; duration = 600 s = 10 min.
  const tenMin = mission(1, [item(22), item(16, 600)])
  const rows: readonly [string, Mission, VehicleKind, number | null, number | null][] = [
    ['ten of twenty minutes', tenMin, 'copter', 20, 50],
    ['ten of eight minutes', tenMin, 'copter', 8, 125],
    ['unknown endurance', tenMin, 'copter', null, null],
    ['zero endurance', tenMin, 'copter', 0, null],
    ['incompatible plan', tenMin, 'rover', 20, null],
  ]
  it.each(rows)('%s', (_name, m, kind, endurance, want) => {
    expect(batteryPct(m, kind, endurance)).toBe(want)
  })
})

describe('writeTargets', () => {
  const plans = [lib(1, 100), lib(2, 200), lib(3, 300, [item(16)])]
  const vehicles = [
    { sysid: 5, kind: 'copter', link: 'ok' }, // pending
    { sysid: 2, kind: 'copter', link: 'delay' }, // updated
    { sysid: 3, kind: 'copter', link: 'ok' }, // ok
    { sysid: 4, kind: 'copter', link: 'lost' }, // pending but offline
    { sysid: 6, kind: 'rover', link: 'ok' }, // pending but incompatible (takeoff)
    { sysid: 7, kind: 'copter', link: 'ok' }, // none
    { sysid: 8, kind: 'rover', link: 'ok' }, // pending, compatible ground plan
    { sysid: 9, kind: 'copter', link: 'ok' }, // assigned plan not in the library
  ] as const
  const assignments = new Map<number, Assignment>([
    [5, assign(5, 1)],
    [2, assign(2, 2, written(2, 150))],
    [3, assign(3, 2, written(2, 200))],
    [4, assign(4, 1)],
    [6, assign(6, 1)],
    [7, assign(7, null)],
    [8, assign(8, 3, written(1, 100))],
    [9, assign(9, 42)],
  ])

  it('picks online pending or updated vehicles with a compatible plan, by sysid', () => {
    expect(writeTargets(vehicles, assignments, plans)).toEqual([2, 5, 8])
  })

  it('is empty with no assignments', () => {
    expect(writeTargets(vehicles, new Map(), plans)).toEqual([])
  })
})

describe('planColours', () => {
  const row = (savedId: number | null, color: string) => ({ color, ui: { savedId } })
  const plans = [{ id: 3 }, { id: 1 }, { id: 2 }, { id: 4 }]

  it('open plans keep their row colour', () => {
    const got = planColours([row(2, '#abcdef'), row(null, PALETTE[1]!)], plans)
    expect(got.get(2)).toBe('#abcdef')
  })

  it('others take palette colours in id order, skipping the used ones', () => {
    const got = planColours([row(2, PALETTE[0]!), row(null, PALETTE[1]!)], plans)
    expect(got.get(2)).toBe(PALETTE[0])
    const others = [got.get(1), got.get(3), got.get(4)]
    expect(new Set(others).size).toBe(3)
    for (const c of others) expect([PALETTE[0], PALETTE[1]]).not.toContain(c)
    expect(others.every((c) => PALETTE.includes(c!))).toBe(true)
  })

  it('assigns in id order with nextColor', () => {
    const got = planColours([], plans)
    // nextColor([]) is the first palette colour; id 1 gets it, whatever the input order.
    expect(got.get(1)).toBe(PALETTE[0])
    expect(got.size).toBe(4)
  })

  it('does not mutate its inputs', () => {
    const rows = Object.freeze([Object.freeze(row(1, '#111111'))])
    const frozen = Object.freeze(plans.map((p) => Object.freeze({ ...p })))
    expect(() => planColours(rows, frozen)).not.toThrow()
  })
})

describe('assignedTo', () => {
  it('lists_the_vehicles_holding_a_plan_by_name', () => {
    const rows = new Map([[1, assign(1, 7)], [2, assign(2, 8)], [3, assign(3, 7)], [9, assign(9, 7)]])
    const vehicles = [{ sysid: 1, name: 'UAV-B' }, { sysid: 2, name: 'UAV-C' }, { sysid: 3, name: 'UAV-A' }]
    expect(assignedTo(7, rows, vehicles)).toEqual([{ sysid: 9, name: '#9' }, { sysid: 3, name: 'UAV-A' }, { sysid: 1, name: 'UAV-B' }])
    expect(assignedTo(8, rows, vehicles)).toEqual([{ sysid: 2, name: 'UAV-C' }])
    expect(assignedTo(5, rows, vehicles)).toEqual([])
    expect(assignedTo(null, new Map([[4, assign(4, null)]]), vehicles)).toEqual([])
  })
})
