import { describe, expect, it } from 'vitest'
import type { Mission } from '../../shared/api/types'
import { appendWaypoint, emptyDraft, toMission } from '../mission/model'
import { INITIAL_MISSION_UI, MissionStore, edit, loaded, setBusy } from '../mission/store'
import { activeRow } from './model'
import { PlanSetStore } from './store'
import { isPristine, openMission, removeLive, switchIfIdle } from './usePlanSet'

const setup = () => ({ b: new PlanSetStore(), m: new MissionStore() })
const mission = (name: string): Mission => ({ ...toMission(appendWaypoint(emptyDraft(), 36, 139)), name })
const names = (b: PlanSetStore) => b.getState().rows.map((r) => r.ui.history.present.mission.name)

describe('usePlanSet helpers', () => {
  it('an_untouched_editor_takes_the_mission_in_place', () => {
    const { b, m } = setup()
    expect(isPristine(m.getState())).toBe(true)
    openMission(b, m, loaded(INITIAL_MISSION_UI, mission('A'), null))
    expect(b.getState().rows).toHaveLength(1)
    expect(m.getState().history.present.mission.name).toBe('A')
    expect(isPristine(m.getState())).toBe(false)
  })

  it('a_touched_editor_keeps_its_row_and_the_mission_gets_a_new_one', () => {
    const { b, m } = setup()
    m.update((u) => edit(u, appendWaypoint(u.history.present, 35, 139)))
    openMission(b, m, loaded(INITIAL_MISSION_UI, mission('B'), 4))
    expect(b.getState().rows).toHaveLength(2)
    expect(b.getState().rows[0]!.ui.history.present.items.length).toBeGreaterThan(0)
    expect(m.getState().savedId).toBe(4)
  })

  it('a_saved_mission_already_open_switches_to_its_row', () => {
    const { b, m } = setup()
    openMission(b, m, loaded(INITIAL_MISSION_UI, mission('A'), 7))
    openMission(b, m, loaded(INITIAL_MISSION_UI, mission('B'), 8))
    openMission(b, m, loaded(INITIAL_MISSION_UI, mission('A'), 7))
    expect(names(b)).toEqual(['A', 'B'])
    expect(m.getState().savedId).toBe(7)
  })

  it('removing_the_edited_row_loads_the_next_one', () => {
    const { b, m } = setup()
    openMission(b, m, loaded(INITIAL_MISSION_UI, mission('A'), 1))
    openMission(b, m, loaded(INITIAL_MISSION_UI, mission('B'), 2))
    openMission(b, m, loaded(INITIAL_MISSION_UI, mission('C'), 3))
    removeLive(b, m, b.getState().rows[0]!.key)
    expect(names(b)).toEqual(['B', 'C'])
    expect(m.getState().savedId).toBe(3)
    removeLive(b, m, b.getState().active)
    expect(names(b)).toEqual(['B'])
    expect(m.getState()).toBe(activeRow(b.getState()).ui)
  })

  it('no_switching_while_the_editor_is_busy', () => {
    const { b, m } = setup()
    openMission(b, m, loaded(INITIAL_MISSION_UI, mission('A'), 1))
    openMission(b, m, loaded(INITIAL_MISSION_UI, mission('B'), 2))
    const first = b.getState().rows[0]!.key
    m.update((u) => setBusy(u, 'saving'))
    switchIfIdle(b, m, first)
    expect(m.getState().savedId).toBe(2)
    m.update((u) => setBusy(u, 'idle'))
    switchIfIdle(b, m, first)
    expect(m.getState().savedId).toBe(1)
  })

  it('the_edited_row_is_not_removed_while_busy', () => {
    const { b, m } = setup()
    openMission(b, m, loaded(INITIAL_MISSION_UI, mission('A'), 1))
    openMission(b, m, loaded(INITIAL_MISSION_UI, mission('B'), 2))
    m.update((u) => setBusy(u, 'saving'))
    removeLive(b, m, b.getState().active)
    expect(names(b)).toEqual(['A', 'B'])
    expect(m.getState().savedId).toBe(2)
    // a parked row can still go
    removeLive(b, m, b.getState().rows[0]!.key)
    expect(names(b)).toEqual(['B'])
  })

  it('opening_and_removing_carry_the_clipboard', () => {
    const { b, m } = setup()
    const clip = { clipboard: toMission(appendWaypoint(emptyDraft(), 1, 2)).items, clipboardUids: [99] }
    m.update((u) => ({ ...u, ...clip }))
    openMission(b, m, loaded(INITIAL_MISSION_UI, mission('A'), 1))
    expect(m.getState().clipboard).toBe(clip.clipboard)
    openMission(b, m, loaded(INITIAL_MISSION_UI, mission('B'), 2))
    expect(m.getState().clipboard).toBe(clip.clipboard)
    removeLive(b, m, b.getState().active)
    expect(m.getState().clipboardUids).toEqual([99])
  })
})
