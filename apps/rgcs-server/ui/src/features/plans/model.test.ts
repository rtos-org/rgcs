import { describe, expect, it } from 'vitest'
import { INITIAL_MISSION_UI } from '../mission/store'
import { PALETTE, activate, activeRow, addRow, assign, emptyWorkspace, forgetSaved, moveRow, parkActive, removeRow, reseedKeys, setColor, setHidden } from './model'

const saved = (id: number) => ({ ...INITIAL_MISSION_UI, savedId: id })

/** HSL hue (deg) and saturation (0–1) of '#rrggbb'. */
function hs(hex: string): { h: number; s: number } {
  const n = Number.parseInt(hex.slice(1), 16)
  const [r, g, b] = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
  const [mx, mn] = [Math.max(r, g, b), Math.min(r, g, b)]
  const d = mx - mn
  const l = (mx + mn) / 2
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
  const h = d === 0 ? 0 : mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4
  return { h: (h * 60 + 360) % 360, s }
}
const hueDist = (a: number, b: number) => Math.min(Math.abs(a - b) % 360, 360 - (Math.abs(a - b) % 360))

describe('plans workspace model', () => {
  it('forget_saved_turns_the_rows_of_a_deleted_plan_into_unsaved_ones', () => {
    const ws = addRow(addRow(emptyWorkspace(), saved(3)), saved(4))
    const out = forgetSaved(ws, 3)
    const row = out.rows.find((r) => r.ui.history === ws.rows[1]!.ui.history)!
    expect(row.ui.savedId).toBeNull()
    expect(row.ui.dirty).toBe(true)
    expect(row.missing).toBe(false)
    expect(out.rows[2]!.ui.savedId).toBe(4)
    expect(forgetSaved(ws, 99)).toBe(ws)
  })

  it('palette_colours_are_distinct_and_the_next_colour_is_the_farthest_hue', () => {
    expect(PALETTE).toHaveLength(8)
    const hues = PALETTE.map((c) => hs(c))
    for (const { s } of hues) expect(s).toBeGreaterThan(0.6)
    for (let i = 0; i < hues.length; i++) for (let j = i + 1; j < hues.length; j++) expect(hueDist(hues[i]!.h, hues[j]!.h)).toBeGreaterThanOrEqual(28)
    // the rows are blue and green: the next one is the unused colour farthest in hue from both
    // (and from the amber selection highlight)
    const base = emptyWorkspace()
    const ws = { ...base, rows: [{ ...base.rows[0]!, color: PALETTE[0]! }, { ...base.rows[0]!, key: 'x', color: PALETTE[1]! }] }
    const next = addRow(ws, saved(3)).rows[2]!.color
    const score = (c: string) => Math.min(...[PALETTE[0]!, PALETTE[1]!, '#f2b544'].map((u) => hueDist(hs(u).h, hs(c).h)))
    const best = Math.max(...PALETTE.slice(2).map(score))
    expect(score(next)).toBe(best)
    // a row recoloured by hand: the farthest is still judged from the colours in use
    const e = emptyWorkspace()
    const red = addRow(setColor(e, e.rows[0]!.key, PALETTE[3]!), saved(4))
    expect(hueDist(hs(red.rows[1]!.color).h, hs(PALETTE[3]!).h)).toBeGreaterThan(90)
  })

  it('add_assigns_the_next_unused_colour_and_activates', () => {
    const ws = addRow(emptyWorkspace(), saved(1))
    expect(ws.rows).toHaveLength(2)
    expect(ws.rows[0].color).toBe(PALETTE[0])
    expect(ws.rows[1].color).toBe(PALETTE[1])
    expect(ws.active).toBe(ws.rows[1].key)
    expect(new Set(ws.rows.map((r) => r.key)).size).toBe(2)
  })

  it('adding_a_mission_already_in_the_workspace_selects_it_instead', () => {
    const a = addRow(emptyWorkspace(), saved(7))
    const b = addRow(a, saved(8))
    const c = addRow(b, saved(7))
    expect(c.rows).toHaveLength(3)
    expect(c.active).toBe(a.rows[1].key)
  })

  it('assigning_a_taken_vehicle_moves_it', () => {
    const ws = addRow(emptyWorkspace(), saved(1))
    const [r0, r1] = ws.rows
    const a = assign(ws, r0.key, 5)
    const b = assign(a, r1.key, 5)
    expect(b.rows[0].sysid).toBeNull()
    expect(b.rows[1].sysid).toBe(5)
    expect(assign(b, r1.key, null).rows[1].sysid).toBeNull()
  })

  it('removing_the_active_row_activates_a_neighbour_and_never_leaves_zero_rows', () => {
    const ws = addRow(addRow(emptyWorkspace(), saved(1)), saved(2))
    const mid = activate(ws, ws.rows[1].key)
    const r = removeRow(mid, ws.rows[1].key)
    expect(r.rows).toHaveLength(2)
    expect(r.active).toBe(ws.rows[2].key)
    const last = removeRow(r, r.rows[1].key)
    expect(last.active).toBe(r.rows[0].key)
    const none = removeRow(last, last.rows[0].key)
    expect(none.rows).toHaveLength(1)
    expect(none.active).toBe(none.rows[0].key)
    expect(none.rows[0].ui.savedId).toBeNull()
  })

  it('move_and_colour_are_immutable', () => {
    const ws = addRow(emptyWorkspace(), saved(1))
    const snap = JSON.stringify(ws)
    const moved = moveRow(ws, ws.rows[1].key, -1)
    const col = setColor(ws, ws.rows[0].key, '#000000')
    expect(JSON.stringify(ws)).toBe(snap)
    expect(moved.rows[0].key).toBe(ws.rows[1].key)
    expect(moveRow(ws, ws.rows[0].key, -1)).toBe(ws)
    expect(col.rows[0].color).toBe('#000000')
  })

  it('park_activate_and_active_row', () => {
    const ws = addRow(emptyWorkspace(), saved(1))
    const parked = parkActive(ws, saved(9))
    expect(activeRow(parked).ui.savedId).toBe(9)
    expect(activate(parked, ws.rows[0].key).active).toBe(ws.rows[0].key)
  })

  it('reseedKeys_avoids_collisions', () => {
    reseedKeys([{ key: 'r500' }])
    const ws = addRow(emptyWorkspace(), saved(1))
    expect(ws.rows.every((r) => r.key !== 'r500')).toBe(true)
    expect(Number(ws.rows[1].key.slice(1))).toBeGreaterThan(500)
  })

  it('set_hidden_ignores_the_active_row_and_activate_shows_the_row', () => {
    const ws = addRow(emptyWorkspace(), saved(1))
    const [first, second] = ws.rows
    expect(ws.rows.every((r) => !r.hidden)).toBe(true)
    expect(setHidden(ws, second.key, true)).toBe(ws)
    const hid = setHidden(ws, first.key, true)
    expect(hid.rows[0].hidden).toBe(true)
    expect(hid.rows[1].hidden).toBe(false)
    const shown = activate(hid, first.key)
    expect(shown.active).toBe(first.key)
    expect(shown.rows[0].hidden).toBe(false)
  })

  it('removing_the_active_row_shows_the_hidden_neighbour_that_takes_over', () => {
    const ws = addRow(addRow(emptyWorkspace(), saved(1)), saved(2))
    const hid = setHidden(activate(ws, ws.rows[0].key), ws.rows[1].key, true)
    const after = removeRow(hid, hid.active)
    expect(after.active).toBe(ws.rows[1].key)
    expect(activeRow(after).hidden).toBe(false)
  })
})
