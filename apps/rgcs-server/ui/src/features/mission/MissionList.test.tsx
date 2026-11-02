import { createEvent, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { t } from '../../shared/i18n'
import { MissionList } from './MissionList'
import { appendWaypoint, emptyDraft } from './model'

const dict = t('ja')
const draft = () => [0, 1, 2, 3].reduce((d, k) => appendWaypoint(d, 36 + k / 100, 139), emptyDraft())

// jsdom has no DragEvent, so the pointer position is put on the event by hand
function dragAt(kind: 'dragOver' | 'drop', el: HTMLElement, clientY: number) {
  const ev = createEvent[kind](el)
  Object.defineProperty(ev, 'clientY', { value: clientY })
  fireEvent(el, ev)
}

function setup(selected: ReadonlySet<number> = new Set()) {
  const onMove = vi.fn()
  render(<MissionList items={draft().items} selected={selected} kind="copter" dict={dict} onSelect={vi.fn()} onReorder={vi.fn()} onMove={onMove} onContext={vi.fn()} />)
  const rows = screen.getAllByRole('option')
  // jsdom has no layout: give every row a 40 px box stacked from y = 0
  rows.forEach((row, i) => (row.getBoundingClientRect = () => ({ top: i * 40, bottom: i * 40 + 40, height: 40, left: 0, right: 300, width: 300, x: 0, y: i * 40, toJSON: () => ({}) })))
  return { rows, onMove }
}

describe('MissionList drag & drop', () => {
  it('drops a row before or after the row under the pointer, with a marker while dragging', () => {
    const { rows, onMove } = setup()
    fireEvent.dragStart(rows[0]!, { dataTransfer: { setData: vi.fn(), effectAllowed: '' } })
    dragAt('dragOver', rows[2]!, 2 * 40 + 30)
    // after row 2 = before row 3: the marker sits on the lower row
    expect(rows[3]).toHaveClass('drop-before')
    dragAt('dragOver', rows[2]!, 2 * 40 + 5)
    expect(rows[2]).toHaveClass('drop-before')
    dragAt('drop', rows[2]!, 2 * 40 + 5)
    expect(onMove).toHaveBeenCalledWith(new Set([1]), 2)
    expect(rows[2]).not.toHaveClass('drop-before')
  })

  it('dragging a selected row carries the whole selection; past the last row the marker goes under it', () => {
    const { rows, onMove } = setup(new Set([2, 3]))
    fireEvent.dragStart(rows[1]!, { dataTransfer: { setData: vi.fn(), effectAllowed: '' } })
    dragAt('dragOver', rows[3]!, 3 * 40 + 35)
    expect(rows[3]).toHaveClass('drop-after')
    dragAt('drop', rows[3]!, 3 * 40 + 35)
    expect(onMove).toHaveBeenCalledWith(new Set([2, 3]), 4)
  })
})
