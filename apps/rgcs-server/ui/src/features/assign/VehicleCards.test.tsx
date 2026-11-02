import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { Assignment, Mission, MissionItem, VehicleKind, VehicleState } from '../../shared/api/types'
import { t } from '../../shared/i18n'
import { batteryPct } from './logic'
import type { LibraryPlan } from './usePlanLibrary'
import { VehicleCards, type VehicleCardsProps } from './VehicleCards'

const dict = t('ja')

const item = (command: number, lat: number): MissionItem => ({ command, frame: 'rel', params: [0, 0, 0, 0], lat, lon: 137.64, alt: 50, autocontinue: true })

const mission = (id: number, items: readonly MissionItem[]): Mission => ({
  id, name: `p${id}`, sysid: null, default_alt: 50, default_frame: 'rel', speed: 8, home: null,
  items: [...items], fence: [], rally: [], surveys: [],
})

const AIR = mission(1, [item(22, 36.25), item(16, 36.25), item(16, 36.27)])
const GROUND = mission(2, [item(16, 36.25), item(16, 36.252)])
const PLANS: readonly LibraryPlan[] = [
  { id: 1, name: '上高地 北', updated_at: 200, mission: AIR, dirty: false },
  { id: 2, name: '河原 走行', updated_at: 300, mission: GROUND, dirty: false },
]

const vehicle = (sysid: number, name: string, kind: VehicleKind, over: Partial<VehicleState> = {}): VehicleState =>
  ({
    sysid, name, kind, mode: 'LOITER', armed: false, lat: 36.25, lon: 137.63, alt_rel: 0, alt_msl: 0, hdg: 0, ground_speed: 0, climb: 0,
    battery: { pct: 87, volt: 24, current: null }, link: 'ok', last_rx_ms: 0, gps: { fix: 3, sats: 12, hdop: 1 }, warn: false, unread: 0,
    ...over,
  }) as VehicleState

const written = (plan_id: number, plan_updated_at: number) => ({ plan_id, plan_updated_at, at: 1, by: 'admin' })
const row = (sysid: number, plan_id: number | null, w: Assignment['written'] = null): Assignment => ({ sysid, plan_id, assigned_by: 'admin', assigned_at: 1, written: w })
const rows = (...list: Assignment[]) => new Map(list.map((a) => [a.sysid, a]))

function setup(over: Partial<VehicleCardsProps> = {}) {
  const props: VehicleCardsProps = {
    vehicles: [vehicle(1, 'UAV-01', 'copter')],
    assignments: new Map(),
    plans: PLANS,
    colours: new Map([[1, '#3d9eff'], [2, '#31d848']]),
    endurance: new Map(),
    picked: null,
    drag: { dragging: null, over: null, blocked: null, overReason: null },
    dragProps: vi.fn(() => ({ onPointerDown: vi.fn() })),
    filter: '',
    onFilter: vi.fn(),
    flash: new Map(),
    onTap: vi.fn(),
    onUnassign: vi.fn(),
    onWrite: vi.fn(),
    onWriteAll: vi.fn(),
    dict,
    ...over,
  }
  const view = render(<VehicleCards {...props} />)
  return { props, view }
}

const names = (c: HTMLElement) => [...c.querySelectorAll('.as-vcard')].map((e) => e.getAttribute('aria-label'))
const card = (name: string) => screen.getByRole('button', { name })

describe('VehicleCards', () => {
  it('online_first_then_name', () => {
    const vehicles = [vehicle(2, 'B-02', 'copter', { link: 'lost' }), vehicle(3, 'C-03', 'rover'), vehicle(1, 'A-01', 'plane', { link: 'delay' }), vehicle(4, 'A-00', 'copter', { link: 'lost' })]
    const { view } = setup({ vehicles })
    expect(names(view.container)).toEqual(['A-01', 'C-03', 'A-00', 'B-02'])
    expect(screen.getByText('2 / 4 接続')).toBeInTheDocument()
    expect(within(card('B-02')).getByText('未接続')).toBeInTheDocument()
    expect(card('B-02').classList.contains('off')).toBe(true)
  })

  it('filters_by_name_kind_mode', () => {
    const vehicles = [vehicle(1, 'UAV-01', 'copter'), vehicle(2, 'UAV-02', 'rover', { mode: 'AUTO' }), vehicle(3, 'Survey', 'plane', { vtol: true })]
    const { view, props } = setup({ vehicles, filter: 'rover' })
    expect(names(view.container)).toEqual(['UAV-02'])
    view.rerender(<VehicleCards {...props} filter="auto" />)
    expect(names(view.container)).toEqual(['UAV-02'])
    view.rerender(<VehicleCards {...props} filter="quadplane" />)
    expect(names(view.container)).toEqual(['Survey'])
    view.rerender(<VehicleCards {...props} filter=" uav-01 " />)
    expect(names(view.container)).toEqual(['UAV-01'])
    view.rerender(<VehicleCards {...props} filter="zzz" />)
    expect(screen.getByText('該当する機体はありません')).toBeInTheDocument()
    fireEvent.change(screen.getByRole('textbox', { name: '機体を絞り込み' }), { target: { value: 'x' } })
    expect(props.onFilter).toHaveBeenCalledWith('x')
  })

  it('badges_follow_cardStatus', () => {
    const vehicles = [
      vehicle(1, 'V-ok', 'copter'), vehicle(2, 'V-pending', 'copter'), vehicle(3, 'V-updated', 'copter'),
      vehicle(4, 'V-unknown', 'copter', { link: 'lost' }), vehicle(5, 'V-none', 'copter'),
    ]
    const assignments = rows(row(1, 1, written(1, 200)), row(2, 1, written(2, 300)), row(3, 1, written(1, 100)), row(4, 1), row(5, null))
    setup({ vehicles, assignments })
    const badge = (n: string) => card(n).querySelector('.as-badge:not(.fly)')
    expect(badge('V-ok')).toHaveTextContent('一致')
    expect(badge('V-ok')?.classList.contains('ok')).toBe(true)
    expect(badge('V-pending')).toHaveTextContent('書込待ち')
    expect(badge('V-pending')?.classList.contains('wait')).toBe(true)
    expect(badge('V-updated')).toHaveTextContent('更新あり')
    expect(badge('V-unknown')).toHaveTextContent('不明 (未接続)')
    expect(badge('V-none')).toBeNull()
    expect(within(card('V-none')).getByText('ここへドラッグ')).toBeInTheDocument()
    expect(within(card('V-ok')).getByText('上高地 北')).toBeInTheDocument()
  })

  it('armed_is_marked', () => {
    setup({ vehicles: [vehicle(1, 'UAV-01', 'copter', { armed: true, mode: 'AUTO' }), vehicle(2, 'UAV-02', 'copter')] })
    const mode = within(card('UAV-01')).getByText('ARMED AUTO')
    expect(mode.classList.contains('armed')).toBe(true)
    expect(within(card('UAV-01')).getByText('飛行中')).toBeInTheDocument()
    expect(card('UAV-01').classList.contains('armed')).toBe(true)
    expect(within(card('UAV-02')).getByText('LOITER')).toBeInTheDocument()
    expect(within(card('UAV-02')).queryByText('飛行中')).toBeNull()
    expect(within(card('UAV-02')).getByText('87%')).toBeInTheDocument()
  })

  it('shows_gps_none_without_a_position', () => {
    setup({ vehicles: [vehicle(1, 'UAV-01', 'copter', { gps: { fix: 1, sats: 3, hdop: null } })] })
    expect(within(card('UAV-01')).getByText('GPS 未取得')).toBeInTheDocument()
  })

  it('x_unassigns', () => {
    const { props } = setup({ assignments: rows(row(1, 1)) })
    const x = screen.getByRole('button', { name: 'UAV-01 の割当を外す' })
    fireEvent.pointerDown(x)
    fireEvent.click(x)
    expect(props.onUnassign).toHaveBeenCalledWith(1)
    expect(props.onTap).not.toHaveBeenCalled()
    fireEvent.click(card('UAV-01'))
    expect(props.onTap).toHaveBeenCalledWith({ kind: 'vehicle', sysid: 1 })
    expect(props.dragProps).toHaveBeenCalledWith({ planId: 1, from: 1 }, true)
  })

  it('incompatible_cards_say_why_while_a_plan_is_picked', () => {
    const vehicles = [vehicle(1, 'UAV-01', 'copter'), vehicle(2, 'R-01', 'rover')]
    const { view, props } = setup({ vehicles, picked: 1 })
    expect(within(card('R-01')).getByText('Rover は離陸のあるプランを走れません')).toBeInTheDocument()
    expect(within(card('R-01')).getByText('置けません')).toBeInTheDocument()
    expect(card('R-01').classList.contains('cannot')).toBe(true)
    expect(within(card('UAV-01')).getByText('タップで割り当てる')).toBeInTheDocument()
    expect(card('UAV-01').classList.contains('can')).toBe(true)
    view.rerender(<VehicleCards {...props} picked={null} />)
    expect(within(card('R-01')).queryByText('Rover は離陸のあるプランを走れません')).toBeNull()
    expect(card('R-01').classList.contains('cannot')).toBe(false)
    // an assigned plan that does not suit the vehicle says why without a pick
    view.rerender(<VehicleCards {...props} picked={null} assignments={rows(row(1, 2))} />)
    expect(within(card('UAV-01')).getByText('この機体は TAKEOFF のないプランを飛べません')).toBeInTheDocument()
  })

  it('drag_marks_the_target_under_the_pointer', () => {
    const vehicles = [vehicle(1, 'UAV-01', 'copter'), vehicle(2, 'R-01', 'rover')]
    const drag = { dragging: { planId: 1, from: null }, over: '1', blocked: null, overReason: null }
    const { view, props } = setup({ vehicles, drag })
    expect(card('UAV-01')).toHaveAttribute('data-drop', '1')
    expect(card('UAV-01').classList.contains('over')).toBe(true)
    expect(card('R-01').classList.contains('cannot')).toBe(true)
    view.rerender(<VehicleCards {...props} drag={{ ...drag, over: null, blocked: '1', overReason: 'もう割り当てています' }} />)
    expect(card('UAV-01').classList.contains('cannot')).toBe(true)
    expect(within(card('UAV-01')).getByText('もう割り当てています')).toBeInTheDocument()
  })

  it('battery_estimate_is_amber_over_70_and_red_over_100', () => {
    const vehicles = [vehicle(1, 'UAV-01', 'copter'), vehicle(2, 'UAV-02', 'copter'), vehicle(3, 'UAV-03', 'copter')]
    const pct1 = batteryPct(AIR, 'copter', 60)
    const assignments = rows(row(1, 1), row(2, 1), row(3, 1))
    const per = (target: number) => (pct1 ?? 1) * 60 / target
    setup({ vehicles, assignments, endurance: new Map([[1, 60], [2, per(85)], [3, per(130)]]) })
    const bat = (n: string) => card(n).querySelector('.as-bat')
    expect(bat('UAV-01')).toHaveTextContent(`電池 目安 ${pct1}%`)
    expect(bat('UAV-01')?.className).toBe('as-bat num')
    expect(bat('UAV-02')?.classList.contains('amber')).toBe(true)
    expect(bat('UAV-03')?.classList.contains('red')).toBe(true)
  })

  it('shows_a_flash_line', () => {
    setup({ flash: new Map([[1, '位置が分かりません']]) })
    expect(within(card('UAV-01')).getByText('位置が分かりません')).toBeInTheDocument()
  })

  it('a_flash_that_repeats_the_reason_line_is_not_shown_twice', () => {
    const vehicles = [vehicle(2, 'R-01', 'rover')]
    setup({ vehicles, picked: 1, flash: new Map([[2, 'Rover は離陸のあるプランを走れません']]) })
    expect(within(card('R-01')).getAllByText('Rover は離陸のあるプランを走れません')).toHaveLength(1)
  })

  it('footer_counts_write_targets', () => {
    const vehicles = [vehicle(1, 'UAV-01', 'copter'), vehicle(2, 'UAV-02', 'copter'), vehicle(3, 'UAV-03', 'copter'), vehicle(4, 'UAV-04', 'copter', { link: 'lost' })]
    const assignments = rows(row(1, 1), row(2, 1, written(1, 100)), row(3, 1, written(1, 200)), row(4, 1))
    const { props, view } = setup({ vehicles, assignments })
    const all = screen.getByRole('button', { name: '変更のある 2 機に書き込む' })
    expect(all).toBeEnabled()
    fireEvent.click(all)
    expect(props.onWriteAll).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'UAV-02 に書き込む' }))
    expect(props.onWrite).toHaveBeenCalledWith(2)
    expect(props.onTap).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'UAV-03 に書き込む' })).toBeNull()
    expect(screen.getByText('書き込むのは保存済みのプランだけです')).toBeInTheDocument()
    view.rerender(<VehicleCards {...props} assignments={rows(row(3, 1, written(1, 200)))} />)
    expect(screen.getByRole('button', { name: '書き込む変更はありません' })).toBeDisabled()
  })
})
