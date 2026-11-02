import { describe, expect, it } from 'vitest'
import { appendWaypoint } from '../mission/model'
import { MissionStore, edit, selectOne } from '../mission/store'
import { PlanSetStore, openInNewRow, replaceWorkspace, switchRow } from './store'
import { activeRow, emptyWorkspace } from './model'

const setup = () => ({ b: new PlanSetStore(), m: new MissionStore() })
const addWp = (m: MissionStore, lat: number) => m.update((ui) => edit(ui, appendWaypoint(ui.history.present, lat, 139)))

describe('plans store', () => {
  it('switching_rows_keeps_each_missions_edits_undo_and_selection', () => {
    const { b, m } = setup()
    openInNewRow(b, m, m.getState())
    const [a, bRow] = b.getState().rows.map((r) => r.key)
    switchRow(b, m, a)
    addWp(m, 35)
    const uid = m.getState().history.present.items[0].uid
    m.update((ui) => selectOne(ui, uid, false))
    switchRow(b, m, bRow)
    expect(m.getState().history.present.items).toHaveLength(0)
    addWp(m, 36)
    switchRow(b, m, a)
    const ui = m.getState()
    expect(ui.history.present.items).toHaveLength(1)
    expect(ui.history.present.items[0].lat).toBe(35)
    expect(ui.history.past.length).toBeGreaterThan(0)
    expect(ui.selected.has(uid)).toBe(true)
    expect(b.getState().rows.find((r) => r.key === bRow)?.ui.history.present.items).toHaveLength(1)
  })

  it('open_in_new_row_parks_the_current_one', () => {
    const { b, m } = setup()
    addWp(m, 35)
    openInNewRow(b, m, { ...m.getState(), history: m.getState().history, savedId: 9 })
    const ws = b.getState()
    expect(ws.rows).toHaveLength(2)
    expect(ws.rows[0].ui.history.present.items).toHaveLength(1)
    expect(activeRow(ws).ui.savedId).toBe(9)
    expect(m.getState().savedId).toBe(9)
  })

  it('replace_workspace_loads_the_active_row', () => {
    const { b, m } = setup()
    const ws = emptyWorkspace()
    replaceWorkspace(b, m, ws)
    expect(b.getState().rows).toEqual(ws.rows)
    expect(m.getState()).toBe(activeRow(b.getState()).ui)
  })
})
