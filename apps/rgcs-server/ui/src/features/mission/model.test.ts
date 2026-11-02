import { describe, expect, it } from 'vitest'
import { appendWaypoint, emptyDraft, isTakeoff, moveItems, moveItemsTo, takeoffFor, fromMission, insertAfter, moveItem, removeItems, reorder, setAltBulk, setArc, shiftAlts, setCommand, toMission, updateItem } from './model'

describe('mission draft model', () => {
  it('first_point_is_takeoff_then_waypoints', () => {
    const d0 = emptyDraft()
    expect(d0.items).toEqual([])
    expect(d0.mission.default_alt).toBe(50)
    const d1 = appendWaypoint(d0, 35.481883, 138.48029)
    expect(d1.items[0]).toMatchObject({ command: 22, lat: 35.481883, lon: 138.48029, alt: 50, frame: 'rel', autocontinue: true })
    const d2 = appendWaypoint(d1, 35.482883, 138.48129)
    expect(d2.items[1]?.command).toBe(16)
    expect(d2.items[1]?.params).toEqual([0, 0, 0, 0])
    expect(d2.items.map((i) => i.uid)).toEqual([1, 2])
    expect(d2.nextUid).toBe(3)
  })

  it('the first click starts with the takeoff that suits the airframe', () => {
    expect(takeoffFor('copter', false)).toBe('TAKEOFF')
    expect(takeoffFor('plane', false)).toBe('TAKEOFF')
    expect(takeoffFor('plane', true)).toBe('VTOL_TAKEOFF')
    expect(takeoffFor('rover', false)).toBeNull()
    expect(takeoffFor(null, false)).toBe('TAKEOFF')
    const qp = appendWaypoint(emptyDraft(), 36.26, 137.64, { takeoff: 'VTOL_TAKEOFF' })
    expect(qp.items.map((i) => i.command)).toEqual([84, 16])
    expect(qp.items[0]).toMatchObject({ lat: 0, lon: 0, alt: 50 })
    expect(isTakeoff(qp.items[0]!)).toBe(true)
    const rover = appendWaypoint(emptyDraft(), 36.26, 137.64, { takeoff: null })
    expect(rover.items.map((i) => i.command)).toEqual([16])
  })

  it('moving a selection leaves the takeoff where it is (it has no coordinates)', () => {
    const d = appendWaypoint(appendWaypoint(emptyDraft(), 36.26, 137.64, { takeoff: 'TAKEOFF' }), 36.27, 137.65)
    const moved = moveItems(d, new Set([1, 2, 3]), 0.01, 0.01)
    expect(moved.items.map((i) => [i.lat, i.lon].map((x) => Math.round(x * 100) / 100))).toEqual([[0, 0], [36.27, 137.65], [36.28, 137.66]])
  })

  it('dragging moves items before the drop slot, a selected block together and in order', () => {
    let d = emptyDraft()
    for (let k = 0; k < 5; k++) d = appendWaypoint(d, 36 + k / 100, 139)
    const order = (x: typeof d) => x.items.map((i) => i.uid)
    expect(order(moveItemsTo(d, new Set([2]), 5))).toEqual([1, 3, 4, 5, 2])
    expect(order(moveItemsTo(d, new Set([5]), 0))).toEqual([5, 1, 2, 3, 4])
    expect(order(moveItemsTo(d, new Set([2, 4]), 1))).toEqual([1, 2, 4, 3, 5])
    expect(order(moveItemsTo(d, new Set([1, 2]), 4))).toEqual([3, 4, 1, 2, 5])
    // dropping in place returns the same draft
    expect(moveItemsTo(d, new Set([3]), 2)).toBe(d)
    expect(moveItemsTo(d, new Set([3]), 3)).toBe(d)
    expect(order(d)).toEqual([1, 2, 3, 4, 5])
  })

  it('insert_remove_move_reorder_are_immutable', () => {
    const d = appendWaypoint(appendWaypoint(appendWaypoint(emptyDraft(), 36.1, 139.1), 36.2, 139.2), 36.3, 139.3)
    const ins = insertAfter(d, 1, 36.15, 139.15)
    expect(ins.items.map((i) => i.uid)).toEqual([1, 4, 2, 3])
    expect(ins.items[1]?.command).toBe(16)
    expect(d.items).toHaveLength(3)
    const rem = removeItems(ins, new Set([4, 3]))
    expect(rem.items.map((i) => i.uid)).toEqual([1, 2])
    const mv = moveItem(d, 2, 36.25, 139.25)
    expect(mv.items[1]).toMatchObject({ lat: 36.25, lon: 139.25 })
    expect(d.items[1]).toMatchObject({ lat: 36.2, lon: 139.2 })
    expect(mv.items[0]).toBe(d.items[0])
    const re = reorder(d, 3, -1)
    expect(re.items.map((i) => i.uid)).toEqual([1, 3, 2])
    expect(reorder(d, 1, -1)).toBe(d)
    expect(reorder(d, 3, 1)).toBe(d)
  })

  it('set_command_resets_params_to_defaults', () => {
    const d = updateItem(appendWaypoint(appendWaypoint(emptyDraft(), 36.1, 139.1), 36.2, 139.2), 2, { params: [5, 0, 0, 0] })
    const speed = setCommand(d, 2, 'DO_CHANGE_SPEED')
    expect(speed.items[1]).toMatchObject({ command: 178, params: [1, 8, -1, 0], lat: 0, lon: 0, alt: 0 })
    const back = setCommand(speed, 2, 'LOITER_TIME')
    expect(back.items[1]).toMatchObject({ command: 19, params: [10, 0, 0, 0], lat: 0, lon: 0 })
    const kept = setCommand(d, 2, 'SPLINE_WAYPOINT')
    expect(kept.items[1]).toMatchObject({ command: 82, lat: 36.2, lon: 139.2, alt: 50, params: [0, 0, 0, 0] })
    expect(setCommand(d, 2, 'NOPE')).toBe(d)
  })

  it('bulk_alt_touches_only_selected_and_round_trips_to_mission', () => {
    const d = appendWaypoint(appendWaypoint(appendWaypoint(emptyDraft(), 36.1, 139.1), 36.2, 139.2), 36.3, 139.3)
    const bulk = setAltBulk(d, new Set([2, 3]), 80, 'abs')
    expect(bulk.items.map((i) => [i.alt, i.frame])).toEqual([
      [50, 'rel'],
      [80, 'abs'],
      [80, 'abs'],
    ])
    const m = toMission(bulk)
    expect(m.items).toHaveLength(3)
    expect('uid' in (m.items[0] as object)).toBe(false)
    const again = fromMission({ ...m, id: 7 })
    expect(again.items.map((i) => i.uid)).toEqual([1, 2, 3])
    expect(again.mission.id).toBe(7)
  })
})

describe('shiftAlts', () => {
  it('adds the same metres to the given items only, keeping their frames', () => {
    const d = appendWaypoint(appendWaypoint(appendWaypoint(emptyDraft(), 36.1, 139.1), 36.2, 139.2), 36.3, 139.3)
    const s = shiftAlts(d, new Set([2, 3]), 25)
    expect(s.items.map((i) => i.alt)).toEqual([50, 75, 75])
    expect(s.items[0]).toBe(d.items[0])
    expect(d.items[1]!.alt).toBe(50)
  })
})

describe('shiftAlts floor', () => {
  it('stops Rel / Ter items at 0 m (never underground) and leaves Abs alone', () => {
    const d = appendWaypoint(appendWaypoint(emptyDraft(), 36.1, 139.1), 36.2, 139.2)
    const mixed = { ...d, items: [d.items[0]!, { ...d.items[1]!, frame: 'abs' as const, alt: 1600 }] }
    const s = shiftAlts(mixed, new Set([1, 2]), -80)
    expect(s.items.map((i) => i.alt)).toEqual([0, 1520])
  })
})

describe('takeoff at the vehicle', () => {
  // ArduCopter climbs straight up where it stands: NAV_TAKEOFF's lat / lon are ignored
  it('the first click of an empty mission adds a TAKEOFF without coordinates (flown where the vehicle stands) and a WAYPOINT at the click', () => {
    const d = appendWaypoint(emptyDraft(), 36.26, 137.64, { takeoff: 'TAKEOFF' })
    expect(d.items.map((i) => [i.command, i.lat, i.lon])).toEqual([
      [22, 0, 0],
      [16, 36.26, 137.64],
    ])
    expect(d.items.map((i) => i.uid)).toEqual([1, 2])
    expect(d.nextUid).toBe(3)
    const d2 = appendWaypoint(d, 36.27, 137.65, { takeoff: 'TAKEOFF' })
    expect(d2.items.map((i) => i.command)).toEqual([22, 16, 16])
  })
})

describe('setArc', () => {
  const d = appendWaypoint(appendWaypoint(appendWaypoint(emptyDraft(), 36.1, 139.1), 36.2, 139.2), 36.3, 139.3)
  it('turns a waypoint into an ARC_WAYPOINT with the angle in param1, and back to a waypoint at 0°', () => {
    const arc = setArc(d, 2, 75)
    expect(arc.items[1]).toMatchObject({ command: 36, params: [75, 0, 0, 0], lat: 36.2, lon: 139.2 })
    expect(arc.items[0]).toBe(d.items[0])
    expect(setArc(arc, 2, -120).items[1]!.params[0]).toBe(-120)
    expect(setArc(arc, 2, 0).items[1]).toMatchObject({ command: 16, params: [0, 0, 0, 0] })
  })
  it('leaves other commands (TAKEOFF, LAND …) alone', () => {
    expect(setArc(d, 1, 90)).toBe(d)
  })
  it('keeps params 2–4 (accept radius, pass radius, yaw) and only rewrites param1', () => {
    const wp = { ...d, items: d.items.map((it) => (it.uid === 2 ? { ...it, params: [5, 2, 3, 45] as [number, number, number, number] } : it)) }
    expect(setArc(wp, 2, 60).items[1]!.params).toEqual([60, 2, 3, 45])
    expect(setArc(setArc(wp, 2, 60), 2, 0).items[1]!.params).toEqual([0, 2, 3, 45])
  })
})
