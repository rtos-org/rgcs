import { describe, expect, it } from 'vitest'
import type { Mission } from '../../shared/api/types'
import { regenerateSurvey } from '../survey/draftOps'
import { ALPHA7R4, defaultSpec } from '../survey/spec'
import { appendWaypoint, emptyDraft, insertAfter, insertCommandAfter, removeItems, reorder, updateItem } from './model'
import { INITIAL_MISSION_UI, MissionStore, addToSelection, copySelected, pasteClipboard, clearSelection, edit, loaded, markSaved, redoUi, removeSelected, selectOne, selectRange, setTool, undoUi } from './store'

const threePoints = () => appendWaypoint(appendWaypoint(appendWaypoint(emptyDraft(), 36.1, 139.1), 36.2, 139.2), 36.3, 139.3)

const surveyed = (): Mission => ({
  ...emptyDraft().mission,
  items: threePoints().items.map(({ uid: _u, ...it }) => it),
  surveys: [{ id: 's1', first: 1, count: 2, spec: { ...defaultSpec([], ALPHA7R4, 'copter'), name: 'Field' } }],
})

describe('mission ui transitions', () => {
  it('regenerating_a_selected_survey_keeps_it_selected_and_undo_too', () => {
    const ui = selectOne(loaded(INITIAL_MISSION_UI, surveyed(), null), 3, false)
    const d = ui.history.present
    const s = d.surveys[0]!
    const items = d.items.slice(1).map(({ uid: _u, ...it }) => it)
    const next = edit(ui, regenerateSurvey(d, s.id, { ...s.spec, altM: 120 }, items))
    const fresh = next.history.present.surveys[0]!.uids
    expect(fresh).not.toContain(3)
    expect([...next.selected]).toEqual([fresh[0]])
    const undone = undoUi(next)
    expect([...undone.selected]).toEqual([2])
    expect([...redoUi(undone).selected]).toEqual([fresh[0]])
  })

  it('removing_selected_plain_items_still_clears_the_selection', () => {
    const ui = selectOne(loaded(INITIAL_MISSION_UI, surveyed(), null), 1, false)
    expect(edit(ui, removeItems(ui.history.present, new Set([1]))).selected.size).toBe(0)
  })

  it('an_edit_inside_a_survey_drops_it_with_a_notice_and_undo_restores_it', () => {
    const ui = loaded(INITIAL_MISSION_UI, surveyed(), null)
    expect(ui.surveyNotice).toEqual([])
    const kept = edit(ui, insertAfter(ui.history.present, 1, 36, 139))
    expect(kept.history.present.surveys).toHaveLength(1)
    expect(kept.surveyNotice).toEqual([])
    const dropped = edit(kept, updateItem(kept.history.present, 3, { alt: 7 }))
    expect(dropped.history.present.surveys).toEqual([])
    expect(dropped.surveyNotice).toEqual(['Field'])
    const undone = undoUi(dropped)
    expect(undone.history.present.surveys).toHaveLength(1)
    expect(undone.surveyNotice).toEqual([])
    expect(redoUi(undone).surveyNotice).toEqual([])
    const next = edit(dropped, appendWaypoint(dropped.history.present, 36.5, 139.5))
    expect(next.surveyNotice).toEqual([])
  })

  it('paste_with_a_survey_item_selected_lands_after_the_survey_and_keeps_it', () => {
    const ui = copySelected(selectOne(loaded(INITIAL_MISSION_UI, surveyed(), null), 1, false))
    const pasted = pasteClipboard(selectOne(ui, 2, false))
    const d = pasted.history.present
    expect(d.surveys.map((s) => s.uids)).toEqual([[2, 3]])
    expect(d.items.map((it) => it.uid)).toEqual([1, 2, 3, 4])
    expect(pasted.surveyNotice).toEqual([])
  })

  it('a_non_insert_edit_inside_a_survey_still_drops_it', () => {
    const ui = loaded(INITIAL_MISSION_UI, surveyed(), null)
    const dropped = edit(ui, updateItem(ui.history.present, 2, { alt: 7 }))
    expect(dropped.history.present.surveys).toEqual([])
    expect(dropped.surveyNotice).toEqual(['Field'])
  })

  it('edit_pushes_history_and_marks_dirty', () => {
    const ui0 = INITIAL_MISSION_UI
    expect(ui0.dirty).toBe(false)
    const ui1 = edit(ui0, appendWaypoint(ui0.history.present, 36.1, 139.1))
    expect(ui1.dirty).toBe(true)
    expect(ui1.history.past).toHaveLength(1)
    expect(ui1.history.present.items).toHaveLength(1)
    const ui2 = undoUi(ui1)
    expect(ui2.history.present.items).toHaveLength(0)
    expect(redoUi(ui2).history.present).toBe(ui1.history.present)
  })

  it('select_range_follows_list_order', () => {
    const ui = loaded(INITIAL_MISSION_UI, { ...emptyDraft().mission, items: threePoints().items.map(({ uid: _u, ...it }) => it) } as Mission, null)
    const one = selectOne(ui, 1, false)
    expect([...one.selected]).toEqual([1])
    const range = selectRange(one, 3)
    expect([...range.selected].sort()).toEqual([1, 2, 3])
    const toggled = selectOne(range, 2, true)
    expect([...toggled.selected].sort()).toEqual([1, 3])
    expect(selectOne(toggled, 3, false).selected).toEqual(new Set([3]))
    expect(clearSelection(toggled).selected.size).toBe(0)
    expect(setTool(ui, 'add').tool).toBe('add')
    expect(selectRange(clearSelection(ui), 2).selected).toEqual(new Set([2]))
  })

  it('undo_keeps_selection_of_surviving_items', () => {
    const base = loaded(INITIAL_MISSION_UI, { ...emptyDraft().mission, items: threePoints().items.map(({ uid: _u, ...it }) => it) } as Mission, 4)
    expect(base.savedId).toBe(4)
    expect(base.dirty).toBe(false)
    const sel = selectOne(selectOne(base, 2, false), 3, true)
    const removed = removeSelected(sel)
    expect(removed.history.present.items.map((i) => i.uid)).toEqual([1])
    expect(removed.selected.size).toBe(0)
    const back = undoUi(removed)
    expect(back.history.present.items).toHaveLength(3)
    const again = removeSelected(selectOne(back, 3, false))
    expect(again.selected.size).toBe(0)
    const marked = markSaved(again, 4)
    expect(marked.dirty).toBe(false)
  })

  it('store_notifies_subscribers_on_change_only', () => {
    const s = new MissionStore()
    let n = 0
    s.subscribe(() => n++)
    expect(s.getState().tool).toBe('add')
    s.update((ui) => setTool(ui, 'select'))
    s.update((ui) => setTool(ui, 'select'))
    expect(n).toBe(1)
    expect(s.getState().tool).toBe('select')
  })
})

describe('addToSelection (map box)', () => {
  it('adds the boxed items to the selection, keeps the anchor and ignores unknown uids', () => {
    const base = edit(INITIAL_MISSION_UI, appendWaypoint(appendWaypoint(appendWaypoint(emptyDraft(), 36.1, 139.1), 36.2, 139.2), 36.3, 139.3))
    const one = selectOne(base, 1, false)
    const boxed = addToSelection(one, [2, 3, 99])
    expect(boxed.selected).toEqual(new Set([1, 2, 3]))
    expect(boxed.anchor).toBe(1)
    expect(addToSelection(boxed, [])).toBe(boxed)
  })
})

describe('copy / paste', () => {
  const base = () => edit(INITIAL_MISSION_UI, appendWaypoint(appendWaypoint(appendWaypoint(appendWaypoint(emptyDraft(), 36.1, 139.1), 36.2, 139.2), 36.3, 139.3), 36.4, 139.4))
  it('copies the selection in list order and pastes copies after the last selected item, selecting them', () => {
    const sel = selectRange(selectOne(base(), 2, false), 3)
    const copied = copySelected(sel)
    expect(copied.clipboard.map((it) => it.lat)).toEqual([36.2, 36.3])
    const pasted = pasteClipboard(copied)
    const items = pasted.history.present.items
    expect(items.map((it) => it.lat)).toEqual([36.1, 36.2, 36.3, 36.2, 36.3, 36.4])
    expect(items.map((it) => it.uid)).toEqual([1, 2, 3, 5, 6, 4])
    expect(pasted.selected).toEqual(new Set([5, 6]))
    expect(pasted.dirty).toBe(true)
    // one undo step removes the paste
    expect(undoUi(pasted).history.present.items).toHaveLength(4)
  })
  it('pastes at the end when nothing is selected, and does nothing with an empty clipboard', () => {
    const copied = copySelected(selectOne(base(), 2, false))
    const pasted = pasteClipboard(clearSelection(copied))
    expect(pasted.history.present.items.at(-1)).toMatchObject({ uid: 5, lat: 36.2 })
    const nothing = base()
    expect(pasteClipboard(nothing)).toBe(nothing)
    expect(copySelected(nothing)).toBe(nothing)
  })
})

describe('DO_JUMP follows its target item', () => {
  // T(1) WP(2) WP(3) DO_JUMP→3(4)
  const plan = () => {
    const d = appendWaypoint(appendWaypoint(appendWaypoint(emptyDraft(), 36.1, 139.1), 36.2, 139.2), 36.3, 139.3)
    const withJump = insertCommandAfter(d, 3, 'DO_JUMP')
    return edit(INITIAL_MISSION_UI, updateItem(withJump, 4, { params: [3, 2, 0, 0] }))
  }
  const jump = (ui: ReturnType<typeof plan>) => ui.history.present.items.filter((it) => it.command === 177).map((it) => it.params[0])
  it('keeps pointing at the same waypoint when items move or are inserted before it', () => {
    const ui = plan()
    expect(jump(edit(ui, reorder(ui.history.present, 3, -1)))).toEqual([2])
    expect(jump(edit(ui, insertAfter(ui.history.present, 1, 36.15, 139.15)))).toEqual([4])
  })
  it('a typed target stays as typed, a deleted target leaves the number alone', () => {
    const ui = plan()
    expect(jump(edit(ui, updateItem(ui.history.present, 4, { params: [2, 2, 0, 0] })))).toEqual([2])
    expect(jump(edit(ui, removeItems(ui.history.present, new Set([3]))))).toEqual([3])
  })
  it('a pasted jump whose target was copied with it points at the copy; the original keeps its target', () => {
    const ui = selectRange(selectOne(plan(), 3, false), 4)
    const pasted = pasteClipboard(copySelected(ui))
    // T WP WP JUMP | WP' JUMP' → the copy jumps to WP' (seq 5)
    expect(jump(pasted)).toEqual([3, 5])
  })
})
