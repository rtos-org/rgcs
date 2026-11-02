import { cleanup, createEvent, fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { t } from '../../shared/i18n'
import { hasPosition } from '../mission/geo'
import { MissionList } from '../mission/MissionList'
import { appendWaypoint, type Draft } from '../mission/model'
import { generateSurvey, surveyNumbers } from './generate'
import { HOME, surveyDraft } from './surveyFixture'

const dict = t('ja')

/** WP, survey, WP. */
function fixture(): Draft {
  const { draft } = surveyDraft()
  const before = appendWaypoint({ ...draft, items: [], nextUid: draft.nextUid }, 36.2, 139)
  const head = before.items[0]!
  const d = appendWaypoint({ ...draft, items: [head, ...draft.items], nextUid: before.nextUid }, 36.3, 139)
  return d
}

function setup(d: Draft = fixture(), selected: ReadonlySet<number> = new Set()) {
  const onSelect = vi.fn()
  const onMove = vi.fn()
  const onContext = vi.fn()
  const onReorder = vi.fn()
  render(<MissionList items={d.items} surveys={d.surveys} home={HOME} selected={selected} kind="plane" dict={dict} onSelect={onSelect} onReorder={onReorder} onMove={onMove} onContext={onContext} />)
  return { d, onSelect, onMove, onContext, onReorder }
}

describe('MissionList survey groups', () => {
  it('shows one collapsed row reading サーベイ {name} · {n} WP · {photos} 枚', () => {
    const { d } = setup()
    const s = d.surveys[0]!
    const gen = generateSurvey(s.spec, HOME)
    if ('error' in gen) throw new Error(gen.error)
    const photos = surveyNumbers(s.spec, gen.geometry, gen.items).photos
    const wps = d.items.filter((it) => s.uids.includes(it.uid) && hasPosition(it)).length
    expect(screen.getAllByRole('option')).toHaveLength(2)
    const group = screen.getByTestId('survey-row')
    expect(group.textContent).toContain(`サーベイ Field · ${wps} WP · ${photos} 枚`)
  })

  it('expanding shows the children with their mission seq numbers, read-only', () => {
    const { d } = setup()
    fireEvent.click(screen.getByRole('button', { name: dict.svRowToggle }))
    const s = d.surveys[0]!
    const kids = within(screen.getByTestId('survey-row')).getAllByRole('option')
    expect(kids).toHaveLength(s.uids.length)
    kids.forEach((row, k) => {
      expect(row.dataset.seq).toBe(String(k + 2))
      expect(row).toHaveClass('sv-child')
      expect(row.getAttribute('draggable')).not.toBe('true')
      expect(within(row).queryByRole('button', { name: dict.mUp })).toBeNull()
      expect(within(row).queryByRole('button', { name: dict.mDown })).toBeNull()
    })
    expect(kids[0]!.dataset.seq).toBe('2')
    expect(kids.at(-1)!.dataset.seq).toBe(String(s.uids.length + 1))
  })

  it('a child click selects it; its context menu is disabled', () => {
    const { d, onSelect, onContext } = setup()
    fireEvent.click(screen.getByRole('button', { name: dict.svRowToggle }))
    const kids = within(screen.getByTestId('survey-row')).getAllByRole('option')
    fireEvent.click(kids[3]!)
    expect(onSelect).toHaveBeenCalledWith(d.surveys[0]!.uids[3], false, false)
    fireEvent.contextMenu(kids[3]!)
    expect(onContext).not.toHaveBeenCalled()
  })

  it('the group row selects the first child and drags all of them as a unit', () => {
    const { d, onSelect, onMove } = setup()
    const head = screen.getByTestId('survey-head')
    fireEvent.click(head)
    expect(onSelect).toHaveBeenCalledWith(d.surveys[0]!.uids[0], false, false)
    expect(head.getAttribute('draggable')).toBe('true')
    fireEvent.dragStart(head, { dataTransfer: { setData: vi.fn(), effectAllowed: '' } })
    const rows = screen.getAllByRole('option')
    const last = rows.at(-1)!
    last.getBoundingClientRect = () => ({ top: 0, bottom: 40, height: 40, left: 0, right: 300, width: 300, x: 0, y: 0, toJSON: () => ({}) })
    const ev = createEvent.drop(last)
    Object.defineProperty(ev, 'clientY', { value: 35 })
    fireEvent(last, ev)
    expect(onMove).toHaveBeenCalledWith(new Set(d.surveys[0]!.uids), d.items.length)
  })

  it('the group row has no reorder buttons', () => {
    setup()
    expect(within(screen.getByTestId('survey-head')).queryByRole('button', { name: dict.mUp })).toBeNull()
  })

  it('▲ on the row after a survey jumps over the whole group; ▼ on the row before it likewise', () => {
    const { d, onMove, onReorder } = setup()
    const n = d.surveys[0]!.uids.length
    const [first, after] = [d.items[0]!, d.items.at(-1)!]
    const rows = screen.getAllByRole('option')
    fireEvent.click(within(rows.at(-1)!).getByRole('button', { name: dict.mUp }))
    expect(onMove).toHaveBeenLastCalledWith(new Set([after.uid]), 1)
    fireEvent.click(within(rows[0]!).getByRole('button', { name: dict.mDown }))
    expect(onMove).toHaveBeenLastCalledWith(new Set([first.uid]), n + 1)
    expect(onReorder).not.toHaveBeenCalled()
  })

  it('▲▼ between plain rows still reorders one step', () => {
    const { d, onReorder } = setup()
    const extra = appendWaypoint(d, 36.4, 139)
    cleanup()
    const { onReorder: again } = setup(extra)
    const rows = screen.getAllByRole('option')
    fireEvent.click(within(rows.at(-1)!).getByRole('button', { name: dict.mUp }))
    expect(again).toHaveBeenCalledWith(extra.items.at(-1)!.uid, -1)
    expect(onReorder).not.toHaveBeenCalled()
  })
})
