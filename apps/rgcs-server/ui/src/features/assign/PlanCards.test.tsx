import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Mission, MissionItem } from '../../shared/api/types'
import { t } from '../../shared/i18n'
import { PlanCards, type PlanCardsProps } from './PlanCards'
import type { LibraryPlan } from './usePlanLibrary'

const dict = t('ja')

const item = (command: number, lat: number): MissionItem => ({ command, frame: 'rel', params: [0, 0, 0, 0], lat, lon: 137.64, alt: 50, autocontinue: true })

const mission = (id: number, items: readonly MissionItem[]): Mission => ({
  id, name: `p${id}`, sysid: null, default_alt: 50, default_frame: 'rel', speed: 8, home: null,
  items: [...items], fence: [], rally: [], surveys: [],
})

const plan = (id: number, name: string, over: Partial<LibraryPlan> = {}): LibraryPlan => ({
  id, name, updated_at: 100, mission: mission(id, [item(22, 36.25), item(16, 36.25), item(16, 36.26)]), dirty: false, ...over,
})

const PLANS = [
  plan(1, '上高地 北'),
  plan(2, '上高地 南', { mission: mission(2, [item(16, 36.25), item(16, 36.251)]) }),
  plan(3, '河原 測量', { dirty: true }),
]

function setup(over: Partial<PlanCardsProps> = {}) {
  const props: PlanCardsProps = {
    plans: PLANS,
    colours: new Map([[1, '#3d9eff'], [2, '#31d848'], [3, '#d76afb']]),
    counts: new Map([[1, 2]]),
    picked: null,
    dragging: null,
    dragProps: vi.fn(() => ({ onPointerDown: vi.fn() })),
    filter: '',
    onFilter: vi.fn(),
    onTap: vi.fn(),
    dict,
    ...over,
  }
  const view = render(<PlanCards {...props} />)
  return { props, view }
}

const card = (name: string) => screen.getByRole('button', { name })

afterEach(() => vi.useRealTimers())

describe('PlanCards', () => {
  it('filters_by_name', () => {
    const { props } = setup({ filter: '上高地' })
    expect(screen.getAllByRole('button', { pressed: false }).map((b) => b.getAttribute('aria-label'))).toEqual(['上高地 北', '上高地 南'])
    fireEvent.change(screen.getByRole('textbox', { name: 'プランを絞り込み' }), { target: { value: '河原' } })
    expect(props.onFilter).toHaveBeenCalledWith('河原')
  })

  it('shows_an_empty_note_when_nothing_matches', () => {
    setup({ filter: 'zzz' })
    expect(screen.getByText('該当するプランはありません')).toBeInTheDocument()
  })

  it('tags_show_the_vehicle_count', () => {
    setup()
    expect(within(card('上高地 北')).getByText('2 機に割当')).toBeInTheDocument()
    expect(within(card('上高地 北')).getByText('離陸あり')).toBeInTheDocument()
    expect(within(card('上高地 南')).getByText('未割当')).toBeInTheDocument()
    expect(within(card('上高地 南')).getByText('地上走行')).toBeInTheDocument()
    expect(within(card('上高地 北')).getByText(/^\d+ m$|km$/)).toBeInTheDocument()
    expect(card('上高地 北').querySelector<HTMLElement>('.as-chip')?.style.background).toBe('rgb(61, 158, 255)')
  })

  it('a_dirty_plan_is_locked_and_says_why_on_tap', () => {
    const { props } = setup()
    const dirty = card('河原 測量')
    expect(within(dirty).getByText('未保存の変更あり')).toBeInTheDocument()
    expect(dirty.classList.contains('dirty')).toBe(true)
    expect(props.dragProps).toHaveBeenCalledWith({ planId: 3, from: null }, false)
    expect(props.dragProps).toHaveBeenCalledWith({ planId: 1, from: null }, true)
    vi.useFakeTimers()
    fireEvent.click(dirty)
    expect(props.onTap).toHaveBeenCalledWith({ kind: 'plan', id: 3 })
    expect(within(dirty).getByRole('status')).toHaveTextContent('未保存の変更があります。保存すると割り当てられます')
    act(() => vi.advanceTimersByTime(5000))
    expect(within(dirty).queryByRole('status')).toBeNull()
  })

  it('picked_card_has_aria_pressed', () => {
    const { props } = setup({ picked: 2 })
    expect(card('上高地 南')).toHaveAttribute('aria-pressed', 'true')
    expect(card('上高地 南').classList.contains('picked')).toBe(true)
    expect(card('上高地 北')).toHaveAttribute('aria-pressed', 'false')
    fireEvent.keyDown(card('上高地 北'), { key: 'Enter' })
    expect(props.onTap).toHaveBeenCalledWith({ kind: 'plan', id: 1 })
  })

  it('tapping_the_empty_list_reports_an_empty_tap', () => {
    const { props } = setup()
    fireEvent.click(screen.getByTestId('as-plan-list'))
    expect(props.onTap).toHaveBeenCalledWith({ kind: 'empty' })
  })
})
