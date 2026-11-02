import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Assignment, Mission, MissionItem, MissionSummaryRow, VehicleKind, VehicleState } from '../../shared/api/types'
import { t } from '../../shared/i18n'
import { MissionStore } from '../mission/store'
import { PlanSetStore } from '../plans/store'
import { BatchWriteSheet, type SheetLine } from '../plans/BatchWriteSheet'
import { AssignBoard, type AssignBoardProps } from './AssignBoard'
import { AssignmentStore, type AssignApi } from './store'
import { clearPlanLibraryCache, type LibraryApi } from './usePlanLibrary'

const dict = t('ja')

const item = (command: number, lat: number): MissionItem => ({ command, frame: 'rel', params: [0, 0, 0, 0], lat, lon: 137.64, alt: 50, autocontinue: true })
const mission = (id: number, items: readonly MissionItem[]): Mission => ({
  id, name: `p${id}`, sysid: null, default_alt: 50, default_frame: 'rel', speed: 8, home: null,
  items: [...items], fence: [], rally: [], surveys: [],
})
const MISSIONS = new Map([
  [1, mission(1, [{ ...item(22, 0), lon: 0 }, item(16, 36.25), item(16, 36.27)])],
  [2, mission(2, [item(16, 36.3), item(16, 36.31)])],
])
const SUMMARIES: MissionSummaryRow[] = [
  { id: 1, name: '上高地 北', sysid: null, item_count: 3, updated_at: 100 },
  { id: 2, name: '河原 走行', sysid: null, item_count: 2, updated_at: 200 },
]

const vehicle = (sysid: number, name: string, kind: VehicleKind, over: Partial<VehicleState> = {}): VehicleState =>
  ({
    sysid, name, kind, mode: 'LOITER', armed: false, lat: 36.2, lon: 137.6, alt_rel: 0, alt_msl: 0, hdg: 0, ground_speed: 0, climb: 0,
    battery: { pct: 87, volt: 24, current: null }, link: 'ok', last_rx_ms: 0, gps: { fix: 3, sats: 12, hdop: 1 }, warn: false, unread: 0,
    ...over,
  }) as VehicleState

const VEHICLES = [vehicle(1, 'UAV-01', 'copter'), vehicle(2, 'UAV-02', 'copter'), vehicle(3, 'UGV-03', 'rover'), vehicle(4, 'UAV-04', 'copter', { gps: { fix: 0, sats: 0, hdop: 99 } })]

function setup(over: Partial<AssignBoardProps> = {}) {
  const put = vi.fn(async (sysid: number, plan_id: number | null): Promise<Assignment> => ({ sysid, plan_id, assigned_by: 'admin', assigned_at: 1, written: null }))
  const assignApi: AssignApi = { list: vi.fn(async () => []), put }
  const store = new AssignmentStore(assignApi, { pushLocalResult: vi.fn() })
  const library: LibraryApi = { list: vi.fn(async () => SUMMARIES), get: vi.fn(async (id: number) => MISSIONS.get(id)!) }
  const props: AssignBoardProps = {
    vehicles: VEHICLES,
    openRows: [],
    dict,
    onOverlay: vi.fn(),
    onFit: vi.fn(),
    onWrite: vi.fn(),
    store,
    library: { api: library, plans: new PlanSetStore(), editor: new MissionStore() },
    ...over,
  }
  render(<AssignBoard {...props} />)
  return { props, put, store, library }
}

const planCard = (name: string) => screen.getByRole('button', { name }) as HTMLElement
const vehicleCard = (name: string) => within(screen.getByTestId('as-vehicle-list')).getByRole('button', { name })
const ready = () => waitFor(() => expect(screen.getByText('上高地 北')).toBeInTheDocument())
const flashOf = (card: HTMLElement) => card.querySelector('.as-flash')?.textContent ?? null

let now = 1000
let under: Element | null = null

beforeEach(() => {
  now = 1000
  vi.spyOn(Date, 'now').mockImplementation(() => now)
  // the endurance lookup: no registry
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 404 })))
  under = null
  document.elementFromPoint = vi.fn(() => under)
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  clearPlanLibraryCache()
})

const later = (ms = 1000) => {
  now += ms
}

describe('AssignBoard', () => {
  it('tap_plan_then_vehicle_assigns_through_the_store', async () => {
    const { put, store, props } = setup()
    await ready()
    // opening the board fits every plan and positioned vehicle
    await waitFor(() => expect(props.onFit).toHaveBeenCalledTimes(1))
    fireEvent.click(planCard('上高地 北'))
    expect(planCard('上高地 北').getAttribute('aria-pressed')).toBe('true')
    later()
    fireEvent.click(vehicleCard('UAV-01'))
    later()
    fireEvent.click(vehicleCard('UAV-02'))
    await waitFor(() => expect(put).toHaveBeenCalledTimes(2))
    expect(put.mock.calls).toEqual([[1, 1], [2, 1]])
    expect(store.getState().get(2)?.plan_id).toBe(1)
    // the vehicle already holds that plan: nothing is sent
    later()
    fireEvent.click(vehicleCard('UAV-01'))
    expect(put).toHaveBeenCalledTimes(2)
    // the map follows: the overlay carries the plans and the hovered card
    fireEvent.pointerOver(vehicleCard('UAV-02'))
    const last = vi.mocked(props.onOverlay).mock.lastCall?.[0]
    expect(last?.plans.map((p) => p.id)).toEqual([1, 2])
    expect(last?.highlight).toEqual({ vehicle: 2 })
    // Esc unpicks
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(planCard('上高地 北').getAttribute('aria-pressed')).toBe('false')
  })

  it('drop_assigns_and_a_move_unassigns_the_source', async () => {
    const { put, store } = setup()
    await ready()
    const mouse = { pointerType: 'mouse', pointerId: 1, button: 0 }
    fireEvent.pointerDown(planCard('上高地 北'), { ...mouse, clientX: 10, clientY: 10 })
    under = vehicleCard('UAV-01')
    fireEvent.pointerMove(window, { ...mouse, clientX: 300, clientY: 40 })
    expect(document.querySelector('.as-ghost')?.textContent).toBe('上高地 北')
    fireEvent.pointerUp(window, { ...mouse, clientX: 300, clientY: 40 })
    await waitFor(() => expect(put).toHaveBeenCalledWith(1, 1))
    expect(document.querySelector('.as-ghost')).toBeNull()
    // drag the chip from UAV-01 onto UAV-02: a move
    const slot = vehicleCard('UAV-01').querySelector('.as-slot.filled')!
    fireEvent.pointerDown(slot, { ...mouse, clientX: 300, clientY: 40 })
    under = vehicleCard('UAV-02')
    fireEvent.pointerMove(window, { ...mouse, clientX: 300, clientY: 200 })
    fireEvent.pointerUp(window, { ...mouse, clientX: 300, clientY: 200 })
    await waitFor(() => expect(put).toHaveBeenCalledTimes(3))
    expect(put.mock.calls.slice(1)).toEqual([[1, null], [2, 1]])
    expect(store.getState().get(1)?.plan_id).toBeNull()
    expect(store.getState().get(2)?.plan_id).toBe(1)
  })

  it('incompatible_tap_flashes_the_reason', async () => {
    const { put } = setup()
    await ready()
    fireEvent.click(planCard('上高地 北'))
    later()
    fireEvent.click(vehicleCard('UGV-03'))
    // the card already says why (its reason line), once; nothing is sent
    expect(within(vehicleCard('UGV-03')).getAllByText('Rover は離陸のあるプランを走れません')).toHaveLength(1)
    expect(put).not.toHaveBeenCalled()
    // a drop there is refused too
    const mouse = { pointerType: 'mouse', pointerId: 1, button: 0 }
    fireEvent.pointerDown(planCard('上高地 北'), { ...mouse, clientX: 10, clientY: 10 })
    under = vehicleCard('UGV-03')
    fireEvent.pointerMove(window, { ...mouse, clientX: 300, clientY: 40 })
    fireEvent.pointerUp(window, { ...mouse, clientX: 300, clientY: 40 })
    expect(put).not.toHaveBeenCalled()
    expect(flashOf(vehicleCard('UGV-03'))).toBeNull()
  })

  it('double_tap_focuses_the_map', async () => {
    const { props, put } = setup()
    await ready()
    await waitFor(() => expect(props.onFit).toHaveBeenCalledTimes(1))
    fireEvent.click(planCard('上高地 北'))
    later(100)
    fireEvent.click(planCard('上高地 北'))
    expect(props.onFit).toHaveBeenCalledTimes(2)
    expect(vi.mocked(props.onFit).mock.lastCall?.[0].map((p) => p.lat)).toEqual([36.25, 36.27])
    // the second tap did not undo the pick
    expect(planCard('上高地 北').getAttribute('aria-pressed')).toBe('true')
    // a double-tap on a vehicle assigns once and frames it with its plan's start
    later()
    fireEvent.click(vehicleCard('UAV-02'))
    later(100)
    fireEvent.click(vehicleCard('UAV-02'))
    await waitFor(() => expect(put).toHaveBeenCalledTimes(1))
    expect(put).toHaveBeenCalledWith(2, 1)
    expect(vi.mocked(props.onFit).mock.lastCall?.[0]).toEqual([{ lat: 36.2, lon: 137.6 }, { lat: 36.25, lon: 137.64 }])
  })

  it('vehicle_without_position_flashes', async () => {
    const { props } = setup()
    await ready()
    await waitFor(() => expect(props.onFit).toHaveBeenCalledTimes(1))
    fireEvent.click(vehicleCard('UAV-04'))
    later(100)
    act(() => {
      fireEvent.click(vehicleCard('UAV-04'))
    })
    expect(flashOf(vehicleCard('UAV-04'))).toBe('位置が分かりません')
    expect(props.onFit).toHaveBeenCalledTimes(1)
  })

  it('the_per_card_button_opens_the_sheet_for_that_vehicle', async () => {
    let sheet: readonly SheetLine[] = []
    const onWrite = vi.fn((lines: readonly SheetLine[]) => {
      sheet = lines
    })
    const { store } = setup({ onWrite, vehicles: [VEHICLES[0]!, { ...VEHICLES[1]!, armed: true, mode: 'AUTO' }, VEHICLES[2]!] })
    await ready()
    const row = (sysid: number, plan_id: number): Assignment => ({ sysid, plan_id, assigned_by: 'admin', assigned_at: 1, written: null })
    act(() => store.applyFrame([row(1, 1), row(2, 1), row(3, 2)]))
    fireEvent.click(screen.getByRole('button', { name: 'UAV-02 に書き込む' }))
    expect(onWrite).toHaveBeenCalledTimes(1)
    expect(sheet.map((l) => [l.sysid, l.vehicle, l.name, l.savedId, l.armed])).toEqual([[2, 'UAV-02', '上高地 北', 1, 'AUTO']])
    expect(sheet[0]!.mission).toEqual(MISSIONS.get(1))
    render(<BatchWriteSheet lines={sheet} leftovers={new Map()} states={new Map()} running={false} dict={dict} onWrite={vi.fn()} onClose={vi.fn()} />)
    const dialog = screen.getByRole('dialog', { name: '割当どおり書き込む' })
    expect(within(dialog).getAllByRole('listitem').map((li) => li.querySelector('.plans-sheet-name')?.textContent)).toEqual(['上高地 北 → UAV-02'])
    // the footer opens it for every changed vehicle
    fireEvent.click(screen.getByRole('button', { name: '変更のある 3 機に書き込む' }))
    expect(sheet.map((l) => l.sysid)).toEqual([1, 2, 3])
  })
})
