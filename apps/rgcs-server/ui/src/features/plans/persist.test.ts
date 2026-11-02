import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { appendWaypoint } from '../mission/model'
import { MissionStore, edit } from '../mission/store'
import { PlanSetStore, openInNewRow } from './store'
import { assign, setColor, setHidden } from './model'
import { LEGACY_STORAGE_KEY, STORAGE_KEY, restore, restoreInto, serialize, startPersistence } from './persist'

const build = () => {
  const b = new PlanSetStore()
  const m = new MissionStore()
  m.update((ui) => edit(ui, appendWaypoint(ui.history.present, 35, 139)))
  openInNewRow(b, m, m.getState())
  const [r0, r1] = b.getState().rows
  b.update((w) => assign(setColor(w, r1.key, '#123456'), r0.key, 3))
  return { b, m }
}

describe('open plans persistence', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('serialize_restore_round_trip_keeps_order_colour_assignment_dirty_and_draft', () => {
    const { b, m } = build()
    const ws = restore(serialize(b.getState(), m.getState()))
    expect(ws).not.toBeNull()
    expect(ws!.rows.map((r) => r.key)).toEqual(b.getState().rows.map((r) => r.key))
    expect(ws!.rows[1].color).toBe('#123456')
    expect(ws!.rows[0].sysid).toBe(3)
    expect(ws!.rows[0].ui.dirty).toBe(true)
    expect(ws!.rows[0].ui.history.present.items).toHaveLength(1)
    expect(ws!.rows[0].ui.history.past).toHaveLength(0)
    expect(ws!.active).toBe(b.getState().active)
  })

  it('hidden_round_trips_and_defaults_to_false', () => {
    const { b, m } = build()
    const [r0, r1] = b.getState().rows
    expect(r1.key).toBe(b.getState().active)
    b.update((w) => setHidden(w, r0.key, true))
    const ws = restore(serialize(b.getState(), m.getState()))
    expect(ws!.rows.map((r) => r.hidden)).toEqual([true, false])
    const old = JSON.parse(serialize(b.getState(), m.getState()))
    for (const r of old.rows) delete r.hidden
    expect(restore(JSON.stringify(old))!.rows.every((r) => r.hidden === false)).toBe(true)
  })

  it('restore_shows_an_active_row_stored_as_hidden', () => {
    const { b, m } = build()
    const p = JSON.parse(serialize(b.getState(), m.getState()))
    p.rows.forEach((r: { key: string; hidden?: boolean }) => (r.hidden = r.key === p.active))
    const ws = restore(JSON.stringify(p))
    expect(ws!.rows.find((r) => r.key === ws!.active)!.hidden).toBe(false)
  })

  it('restore_reads_a_stored_mission_without_surveys', () => {
    const { b, m } = build()
    const old = JSON.parse(serialize(b.getState(), m.getState()))
    for (const r of old.rows) delete r.mission.surveys
    const ws = restore(JSON.stringify(old))
    expect(ws!.rows[0].ui.history.present.surveys).toEqual([])
    expect(JSON.parse(serialize(ws!, ws!.rows[0].ui)).rows[0].mission.surveys).toEqual([])
  })

  it('restore_ignores_corrupt_or_old_payloads', () => {
    for (const t of ['{', '{"v":0}', null, '{"v":1,"rows":[]}', '[]', '{"v":1,"rows":[{}]}']) expect(restore(t)).toBeNull()
  })

  it('restore_into_loads_the_editor', () => {
    const { b, m } = build()
    const text = serialize(b.getState(), m.getState())
    const b2 = new PlanSetStore()
    const m2 = new MissionStore()
    expect(restoreInto(b2, m2, { getItem: (k) => (k === STORAGE_KEY ? text : null) })).toBe(true)
    expect(b2.getState().rows).toHaveLength(2)
    expect(restoreInto(b2, m2, { getItem: () => { throw new Error('x') } })).toBe(false)
  })

  it('stores_under_the_plans_key_without_a_container_id_or_name', () => {
    const { b, m } = build()
    expect(STORAGE_KEY).toBe('rgcs.plans.v1')
    const p = JSON.parse(serialize(b.getState(), m.getState()))
    expect(Object.keys(p).sort()).toEqual(['active', 'rows', 'v'])
  })

  it('restore_into_falls_back_to_the_old_briefing_key_once', () => {
    const { b, m } = build()
    const old = { ...JSON.parse(serialize(b.getState(), m.getState())), id: 7, name: 'morning' }
    const items: Record<string, string> = { [LEGACY_STORAGE_KEY]: JSON.stringify(old) }
    const storage = { getItem: (k: string) => items[k] ?? null, removeItem: (k: string) => void delete items[k] }
    const b2 = new PlanSetStore()
    expect(restoreInto(b2, new MissionStore(), storage)).toBe(true)
    expect(b2.getState().rows).toHaveLength(2)
    expect(b2.getState()).not.toHaveProperty('name')
    expect(items).toEqual({})
  })

  it('persistence_debounces_writes_from_both_stores_and_stops_on_unsubscribe', () => {
    const { b, m } = build()
    const setItem = vi.fn()
    const stop = startPersistence(b, m, { setItem }, 500)
    m.update((ui) => edit(ui, appendWaypoint(ui.history.present, 36, 139)))
    m.update((ui) => edit(ui, appendWaypoint(ui.history.present, 37, 139)))
    vi.advanceTimersByTime(499)
    expect(setItem).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(setItem).toHaveBeenCalledTimes(1)
    expect(setItem.mock.calls[0][0]).toBe(STORAGE_KEY)
    b.update((w) => setColor(w, w.active, '#abcdef'))
    stop()
    vi.advanceTimersByTime(1000)
    expect(setItem).toHaveBeenCalledTimes(1)
  })

  it('write_failures_are_swallowed', () => {
    const { b, m } = build()
    startPersistence(b, m, { setItem: () => { throw new Error('quota') } }, 10)
    b.update((w) => setColor(w, w.active, '#abcdef'))
    expect(() => vi.advanceTimersByTime(20)).not.toThrow()
  })
})
