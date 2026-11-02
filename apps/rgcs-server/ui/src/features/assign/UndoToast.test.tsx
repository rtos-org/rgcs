import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Assignment, Mission, MissionItem, MissionSummaryRow, VehicleState } from '../../shared/api/types'
import { t } from '../../shared/i18n'
import { MissionStore } from '../mission/store'
import { PlanSetStore } from '../plans/store'
import { AssignBoard } from './AssignBoard'
import { AssignmentStore, type AssignApi } from './store'
import { UNDO_MS, UndoToast } from './UndoToast'
import { clearPlanLibraryCache, type LibraryApi } from './usePlanLibrary'

const dict = t('ja')

const item = (command: number, lat: number): MissionItem => ({ command, frame: 'rel', params: [0, 0, 0, 0], lat, lon: 137.64, alt: 50, autocontinue: true })
const mission = (id: number): Mission => ({
  id, name: `p${id}`, sysid: null, default_alt: 50, default_frame: 'rel', speed: 8, home: null,
  items: [item(22, 0), item(16, 36.25 + id / 100)], fence: [], rally: [], surveys: [],
})
const SUMMARIES: MissionSummaryRow[] = [
  { id: 1, name: '上高地 北', sysid: null, item_count: 2, updated_at: 100 },
  { id: 2, name: '梓川 南', sysid: null, item_count: 2, updated_at: 200 },
]

const vehicle = (sysid: number, name: string): VehicleState =>
  ({
    sysid, name, kind: 'copter', mode: 'LOITER', armed: false, lat: 36.2, lon: 137.6, alt_rel: 0, alt_msl: 0, hdg: 0, ground_speed: 0, climb: 0,
    battery: { pct: 87, volt: 24, current: null }, link: 'ok', last_rx_ms: 0, gps: { fix: 3, sats: 12, hdop: 1 }, warn: false, unread: 0,
  }) as VehicleState

const row = (sysid: number, plan_id: number | null): Assignment => ({ sysid, plan_id, assigned_by: 'admin', assigned_at: 1, written: null })

function setup() {
  const put = vi.fn(async (sysid: number, plan_id: number | null): Promise<Assignment> => row(sysid, plan_id))
  const api: AssignApi = { list: vi.fn(async () => []), put }
  const store = new AssignmentStore(api, { pushLocalResult: vi.fn() })
  const library: LibraryApi = { list: vi.fn(async () => SUMMARIES), get: vi.fn(async (id: number) => mission(id)) }
  render(
    <AssignBoard vehicles={[vehicle(1, 'UAV-01'), vehicle(2, 'UAV-02')]} openRows={[]} dict={dict} onOverlay={vi.fn()} onFit={vi.fn()} onWrite={vi.fn()}
      store={store} library={{ api: library, plans: new PlanSetStore(), editor: new MissionStore() }} />,
  )
  return { put, store }
}

const planCard = (name: string) => screen.getByRole('button', { name }) as HTMLElement
const vehicleCard = (name: string) => within(screen.getByTestId('as-vehicle-list')).getByRole('button', { name })
const ready = () => waitFor(() => expect(screen.getByText('上高地 北')).toBeInTheDocument())
const toast = () => screen.queryByRole('status')
const planOf = (store: AssignmentStore, sysid: number) => store.getState().get(sysid)?.plan_id ?? null

let now = 1000

beforeEach(() => {
  now = 1000
  vi.spyOn(Date, 'now').mockImplementation(() => now)
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })))
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  clearPlanLibraryCache()
})

/** Tap a plan, then a vehicle (far enough apart not to be a double-tap). */
function tapAssign(plan: string, vehicleName: string) {
  now += 1000
  fireEvent.click(planCard(plan))
  now += 1000
  fireEvent.click(vehicleCard(vehicleName))
}

describe('UndoToast', () => {
  it('assign_shows_a_toast_and_undo_restores', async () => {
    const { put, store } = setup()
    await ready()
    tapAssign('上高地 北', 'UAV-01')
    expect(toast()?.textContent).toContain('上高地 北 を UAV-01 に割り当てました')
    await waitFor(() => expect(put).toHaveBeenCalledWith(1, 1))
    fireEvent.click(screen.getByRole('button', { name: '元に戻す' }))
    await waitFor(() => expect(put).toHaveBeenLastCalledWith(1, null))
    expect(planOf(store, 1)).toBeNull()
    expect(toast()).toBeNull()
    // unassign says so too, and its undo puts the plan back
    act(() => store.applyFrame([row(2, 2)]))
    fireEvent.click(screen.getByRole('button', { name: 'UAV-02 の割当を外す' }))
    expect(toast()?.textContent).toContain('UAV-02 の割当を外しました')
    fireEvent.click(screen.getByRole('button', { name: '元に戻す' }))
    await waitFor(() => expect(put).toHaveBeenLastCalledWith(2, 2))
    expect(planOf(store, 2)).toBe(2)
  })

  it('replace_says_what_was_replaced', async () => {
    const { put, store } = setup()
    await ready()
    act(() => store.applyFrame([row(1, 2)]))
    tapAssign('上高地 北', 'UAV-01')
    expect(toast()?.textContent).toContain('UAV-01: 梓川 南 を 上高地 北 に置き換えました')
    // a new action replaces the toast (the plan stays picked)
    now += 1000
    fireEvent.click(vehicleCard('UAV-02'))
    expect(toast()?.textContent).toContain('上高地 北 を UAV-02 に割り当てました')
    expect(screen.getAllByRole('status')).toHaveLength(1)
    await waitFor(() => expect(put).toHaveBeenCalledTimes(2))
  })

  it('move_undo_restores_both_vehicles', async () => {
    const { put, store } = setup()
    await ready()
    act(() => store.applyFrame([row(1, 1), row(2, 2)]))
    const mouse = { pointerType: 'mouse', pointerId: 1, button: 0 }
    const slot = vehicleCard('UAV-01').querySelector('.as-slot.filled')!
    document.elementFromPoint = vi.fn(() => vehicleCard('UAV-02'))
    fireEvent.pointerDown(slot, { ...mouse, clientX: 300, clientY: 40 })
    fireEvent.pointerMove(window, { ...mouse, clientX: 300, clientY: 200 })
    fireEvent.pointerUp(window, { ...mouse, clientX: 300, clientY: 200 })
    await waitFor(() => expect(put).toHaveBeenCalledTimes(2))
    expect(toast()?.textContent).toContain('上高地 北 を UAV-01 から UAV-02 に移しました')
    fireEvent.click(screen.getByRole('button', { name: '元に戻す' }))
    await waitFor(() => expect(put).toHaveBeenCalledTimes(4))
    expect(planOf(store, 1)).toBe(1)
    expect(planOf(store, 2)).toBe(2)
  })

  it('the_toast_closes_after_4_5_s', () => {
    vi.useFakeTimers()
    const onClose = vi.fn()
    const undo = { text: 'x', changes: [] }
    const { rerender } = render(<UndoToast undo={undo} dict={dict} onUndo={vi.fn()} onClose={onClose} />)
    expect(UNDO_MS).toBe(4500)
    act(() => vi.advanceTimersByTime(4000))
    // a new action restarts the clock
    rerender(<UndoToast undo={{ ...undo }} dict={dict} onUndo={vi.fn()} onClose={onClose} />)
    act(() => vi.advanceTimersByTime(4499))
    expect(onClose).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(onClose).toHaveBeenCalledTimes(1)
    rerender(<UndoToast undo={null} dict={dict} onUndo={vi.fn()} onClose={onClose} />)
    expect(screen.queryByRole('status')).toBeNull()
  })
})
