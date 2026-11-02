import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { FenceZone, Mission } from '../../shared/api/types'
import { t } from '../../shared/i18n'
import { emptyDraft, toMission } from '../mission/model'
import type { BatchState, Leftover } from './batch'
import { BatchWriteSheet, type SheetLine } from './BatchWriteSheet'

const dict = t('ja')
const ZONE: FenceZone = { kind: 'circle', inclusion: true, center: { lat: 35, lon: 139 }, radius: 100 }
const mission = (name: string, extra: Partial<Mission> = {}): Mission => ({ ...toMission(emptyDraft()), name, ...extra })
const lines: SheetLine[] = [
  { key: 'a', color: '#9cc9ff', name: 'Alpha', sysid: 1, vehicle: 'UAV-01', distanceM: 2400, mission: mission('Alpha') },
  { key: 'b', color: '#5fd39b', name: 'Beta', sysid: 2, vehicle: 'UAV-02', distanceM: 800, mission: mission('Beta', { fence: [ZONE] }) },
  { key: 'c', color: '#d8a8ff', name: 'Gamma', sysid: 3, vehicle: 'UAV-03', distanceM: 500, mission: mission('Gamma') },
]
const left: ReadonlyMap<number, Leftover> = new Map([
  [1, { fence: 3, rally: 2 }],
  [2, { fence: 0, rally: 0 }],
  [3, { fence: null, rally: 0 }],
])
const NONE: ReadonlyMap<string, BatchState> = new Map()

describe('BatchWriteSheet', () => {
  it('shows_leftovers_with_keep_default_and_passes_the_choice_to_the_jobs', () => {
    const onWrite = vi.fn()
    render(<BatchWriteSheet lines={lines} leftovers={left} states={NONE} running={false} dict={dict} onWrite={onWrite} onClose={vi.fn()} />)
    const sheet = screen.getByRole('dialog', { name: '割当どおり書き込む' })
    expect(sheet.classList.contains('sheet')).toBe(true)
    const items = within(sheet).getAllByRole('listitem')
    expect(items[0]!.textContent).toContain('Alpha')
    expect(items[0]!.textContent).toContain('UAV-01')
    expect(items[0]!.textContent).toContain('2.40 km')
    expect(within(items[0]!).getByText('前のフェンス 3 区画が残っています')).toBeInTheDocument()
    expect(within(items[0]!).getByText('前のラリー 2 点が残っています')).toBeInTheDocument()
    // the mission brings its own fence, nothing left to report
    expect(items[1]!.textContent).not.toContain('前のフェンス')
    expect(within(items[2]!).getByText('前のフェンス: 不明')).toBeInTheDocument()
    const keeps = within(items[0]!).getAllByRole('button', { name: '残す' })
    expect(keeps.every((b) => b.classList.contains('on'))).toBe(true)
    fireEvent.click(within(items[0]!).getAllByRole('button', { name: '消す' })[0]!)
    fireEvent.click(within(sheet).getByRole('button', { name: '3 機に書き込む' }))
    expect(onWrite).toHaveBeenCalledWith([
      { key: 'a', sysid: 1, mission: lines[0]!.mission, clearFence: true, clearRally: false },
      { key: 'b', sysid: 2, mission: lines[1]!.mission, clearFence: false, clearRally: false },
      { key: 'c', sysid: 3, mission: lines[2]!.mission, clearFence: false, clearRally: false },
    ])
  })

  it('shows_progress_and_reasons_per_line_while_running', () => {
    const states: ReadonlyMap<string, BatchState> = new Map([
      ['a', { key: 'a', phase: 'done', reason: null }],
      ['b', { key: 'b', phase: 'failed', reason: 'offline' }],
      ['c', { key: 'c', phase: 'writing', reason: null }],
    ])
    render(<BatchWriteSheet lines={lines} leftovers={left} states={states} running={true} dict={dict} onWrite={vi.fn()} onClose={vi.fn()} />)
    const items = screen.getAllByRole('listitem')
    expect(items[0]!.querySelector('.plans-phase')?.textContent).toBe('完了・照合一致')
    expect(items[0]!.querySelector('.plans-phase svg')).not.toBeNull()
    expect(items[1]!.querySelector('.plans-phase')?.textContent).toBe('未接続')
    expect(items[1]!.querySelector('.plans-phase svg')).not.toBeNull()
    expect(items[2]!.querySelector('.plans-phase')?.textContent).toBe('書込中')
    expect(screen.queryByRole('button', { name: '3 機に書き込む' })).toBeNull()
    // no closing while the writes run
    expect(screen.getAllByRole('button', { name: '閉じる' }).every((b) => (b as HTMLButtonElement).disabled)).toBe(true)
  })

  it('waits_for_the_leftover_read_before_writing', () => {
    render(<BatchWriteSheet lines={lines} leftovers={null} states={NONE} running={false} dict={dict} onWrite={vi.fn()} onClose={vi.fn()} />)
    expect(screen.getByText('機体のフェンス・ラリーを読み取り中…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '3 機に書き込む' })).toBeDisabled()
  })

  it('a_stale_erase_choice_never_clears_what_is_no_longer_shown', () => {
    const onWrite = vi.fn()
    const props = { lines: lines.slice(0, 1), states: NONE, running: false, dict, onWrite, onClose: vi.fn() }
    const { rerender } = render(<BatchWriteSheet {...props} leftovers={new Map([[1, { fence: 3, rally: 2 }]])} />)
    for (const b of screen.getAllByRole('button', { name: '消す' })) fireEvent.click(b)
    // re-read: both now unknown, so no control is shown and nothing may be cleared
    rerender(<BatchWriteSheet {...props} leftovers={new Map([[1, { fence: null, rally: null }]])} />)
    expect(screen.queryByRole('button', { name: '消す' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '1 機に書き込む' }))
    expect(onWrite).toHaveBeenLastCalledWith([{ key: 'a', sysid: 1, mission: lines[0]!.mission, clearFence: false, clearRally: false }])
  })

  it('names_the_fence_or_rally_step_when_only_that_failed', () => {
    const states: ReadonlyMap<string, BatchState> = new Map([
      ['a', { key: 'a', phase: 'failed', reason: 'fenceMismatch' }],
      ['b', { key: 'b', phase: 'failed', reason: 'rallyMismatch' }],
    ])
    render(<BatchWriteSheet lines={lines.slice(0, 2)} leftovers={left} states={states} running={false} dict={dict} onWrite={vi.fn()} onClose={vi.fn()} />)
    const items = screen.getAllByRole('listitem')
    expect(items[0]!.querySelector('.plans-phase')?.textContent).toBe('フェンス照合不一致')
    expect(items[1]!.querySelector('.plans-phase')?.textContent).toBe('ラリー照合不一致')
  })
})

describe('BatchWriteSheet armed vehicles', () => {
  const armed: SheetLine[] = [
    { ...lines[0]!, savedId: 10, durationS: 300, updated: true },
    { ...lines[2]!, armed: 'AUTO', savedId: 30, durationS: 90 },
  ]
  const show = (onWrite = vi.fn()) => render(<BatchWriteSheet lines={armed} leftovers={new Map()} states={NONE} running={false} dict={dict} onWrite={onWrite} onClose={vi.fn()} />)

  it('armed_rows_start_unchecked_and_are_skipped', () => {
    const onWrite = vi.fn()
    show(onWrite)
    const items = screen.getAllByRole('listitem')
    expect(items[0]!.textContent).toContain('5:00')
    expect(within(items[0]!).getByText('前回の書込からプランが更新されています')).toBeInTheDocument()
    expect(items[0]!.querySelector('.plans-phase')?.textContent).toBe('待機')
    expect(items[1]!.classList.contains('armed')).toBe(true)
    const box = within(items[1]!).getByRole('checkbox', { name: '飛行中の UAV-03 のミッションを置き換える (AUTO)' })
    expect(box).not.toBeChecked()
    expect(items[1]!.querySelector('.plans-phase')?.textContent).toBe('対象外')
    expect(screen.getByText(/AUTO で飛行中の機体はミッションの差し替えを受け付け/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '1 機に書き込む' }))
    expect(onWrite).toHaveBeenCalledWith([{ key: 'a', sysid: 1, mission: armed[0]!.mission, savedId: 10, clearFence: false, clearRally: false }])
  })

  it('checking_an_armed_row_includes_it', () => {
    const onWrite = vi.fn()
    show(onWrite)
    const items = screen.getAllByRole('listitem')
    fireEvent.click(within(items[1]!).getByRole('checkbox'))
    expect(items[1]!.querySelector('.plans-phase')?.textContent).toBe('待機')
    fireEvent.click(screen.getByRole('button', { name: '2 機に書き込む' }))
    expect(onWrite.mock.lastCall?.[0].map((j: { sysid: number; savedId?: number }) => [j.sysid, j.savedId])).toEqual([[1, 10], [3, 30]])
  })

  it('no_auto_note_without_an_armed_row', () => {
    render(<BatchWriteSheet lines={armed.slice(0, 1)} leftovers={new Map()} states={NONE} running={false} dict={dict} onWrite={vi.fn()} onClose={vi.fn()} />)
    expect(screen.queryByText(/AUTO で飛行中/)).toBeNull()
  })
})
