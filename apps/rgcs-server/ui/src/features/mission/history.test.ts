import { describe, expect, it } from 'vitest'
import { HISTORY_DEPTH, canRedo, canUndo, initHistory, push, redo, undo } from './history'
import { appendWaypoint, emptyDraft, moveItem } from './model'

describe('history', () => {
  it('undo_restores_dragged_position', () => {
    const d0 = appendWaypoint(emptyDraft(), 35.481883, 138.48029)
    const h0 = initHistory(d0)
    const h1 = push(h0, moveItem(d0, 1, 35.489883, 138.48829))
    expect(h1.present.items[0]).toMatchObject({ lat: 35.489883, lon: 138.48829 })
    const h2 = undo(h1)
    expect(h2.present.items[0]).toMatchObject({ lat: 35.481883, lon: 138.48029 })
    expect(h2.present).toBe(d0)
    expect(canUndo(h2)).toBe(false)
    expect(canRedo(h2)).toBe(true)
    expect(redo(h2).present).toBe(h1.present)
    expect(undo(h0)).toBe(h0)
    expect(redo(h1)).toBe(h1)
  })

  it('new_edit_clears_redo', () => {
    const d0 = emptyDraft()
    const h = push(initHistory(d0), appendWaypoint(d0, 36.1, 139.1))
    const undone = undo(h)
    const branched = push(undone, appendWaypoint(d0, 36.2, 139.2))
    expect(canRedo(branched)).toBe(false)
    expect(branched.present.items[0]?.lat).toBe(36.2)
  })

  it('history_keeps_sixty_snapshots', () => {
    let h = initHistory(emptyDraft())
    for (let i = 0; i < 61; i++) h = push(h, appendWaypoint(h.present, 36 + i * 0.001, 139))
    expect(HISTORY_DEPTH).toBe(60)
    expect(h.past).toHaveLength(60)
    expect(h.past[0]?.items).toHaveLength(1)
    expect(h.present.items).toHaveLength(61)
  })
})
