// The planner's 編集 | 割当 modes (spec 2026-10-31 §3.1, §9) and the edit-mode write target
// (spec 2026-10-20 §8): the write goes exactly where the right panel says, or nowhere. The open
// rows show their assigned vehicles as chips (server assignments), not a select.
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Assignment, VehicleState } from '../../shared/api/types'
import type { AssignOverlayInput } from '../assign/assignOverlay'
import { t } from '../../shared/i18n'

vi.mock('./MissionMap', () => ({
  MissionMap: (p: { assign?: AssignOverlayInput | null }) => <div data-testid="mission-map" data-assign={p.assign ? 'on' : 'off'} />,
}))

const { MissionView } = await import('./MissionView')
const { MissionStore, loaded } = await import('./store')
const { PlanSetStore } = await import('../plans/store')
const { appendWaypoint, emptyDraft, toMission } = await import('./model')
const { serializeRgcsMission } = await import('./files')
const { rasterStyle } = await import('../map/style')
const { assignmentStore } = await import('../assign/store')

const copter = (sysid: number): VehicleState => ({
  sysid, name: `UAV-0${sysid}`, kind: 'copter', mode: 'STABILIZE', armed: false, lat: 35.479883, lon: 138.47829, alt_rel: 0, alt_msl: 0, hdg: 0,
  ground_speed: 0, climb: 0, battery: { pct: 90, volt: 24, current: null }, link: 'ok', last_rx_ms: 0, gps: { fix: 3, sats: 12, hdop: 1 }, warn: false, unread: 0,
})
const style = rasterStyle('https://t/{z}/{x}/{y}.png', 'x')
const envelope = (data: unknown) => new Response(JSON.stringify({ success: true, data }), { status: 200, headers: { 'content-type': 'application/json' } })
const row = (sysid: number, plan_id: number | null): Assignment => ({ sysid, plan_id, assigned_by: 'admin', assigned_at: 1, written: null })

function setup(opts: { opsSelected?: number | null; extra?: VehicleState[]; fetchImpl?: (url: string) => Response } = {}) {
  const fetchMock = vi.fn<typeof fetch>(async (input) => (opts.fetchImpl ? opts.fetchImpl(String(input)) : envelope([])))
  vi.stubGlobal('fetch', fetchMock)
  const store = new MissionStore()
  const plans = new PlanSetStore()
  const vehicles = new Map([[1, copter(1)], [2, copter(2)], ...(opts.extra ?? []).map((v) => [v.sysid, v] as const)])
  render(<MissionView vehicles={vehicles} dict={t('ja')} style={style} store={store} plans={plans} opsSelected={opts.opsSelected ?? null} />)
  return { store, plans, fetchMock }
}

function missionFile(name: string, lat0: number, sysid: number | null = null): File {
  const draft = appendWaypoint(appendWaypoint(emptyDraft(), lat0, 139), lat0 + 0.01, 139)
  return new File([serializeRgcsMission({ ...toMission(draft), name, sysid })], `${name}.rgcsmission`)
}
const savedMission = (name: string, id: number) => ({ ...toMission(appendWaypoint(appendWaypoint(emptyDraft(), 36, 139), 36.01, 139)), name, id })
const pick = async (files: File[]) => {
  await act(async () => {
    fireEvent.change(screen.getByTestId('mission-file'), { target: { files } })
  })
}
const planRows = () => [...document.querySelectorAll<HTMLElement>('.plans-row')]
const editor = () => within(screen.getByRole('complementary', { name: 'editor' }))
const panelSelect = () => editor().getByLabelText('対象機体') as HTMLSelectElement
const writeButton = () => editor().getByRole('button', { name: '機体に書き込む' })
const modes = () => within(screen.getByRole('group', { name: 'モード' }))
const chips = (r: HTMLElement) => within(r).queryByRole('group', { name: '割当機体' })

describe('MissionView 編集 | 割当 modes', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    assignmentStore.applyFrame([])
  })

  it('assign_mode_swaps_both_panels_and_back', async () => {
    const { store } = setup()
    await pick([missionFile('Alpha', 36)])
    const before = store.getState()
    expect(screen.getByRole('complementary', { name: 'フライトプラン' })).toBeInTheDocument()
    expect(screen.getByTestId('mission-map').dataset.assign).toBe('off')
    await act(async () => {
      fireEvent.click(modes().getByRole('button', { name: '割当' }))
    })
    expect(screen.queryByRole('complementary', { name: 'editor' })).not.toBeInTheDocument()
    expect(screen.queryByRole('complementary', { name: 'フライトプラン' })).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: '計画の種類' })).not.toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: 'プラン' })).toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: '機体' })).toBeInTheDocument()
    expect(screen.getByTestId('mission-map').dataset.assign).toBe('on')
    expect(modes().getByRole('button', { name: '割当' }).getAttribute('aria-pressed')).toBe('true')
    // back to 編集: the editor is as it was
    fireEvent.click(modes().getByRole('button', { name: '編集' }))
    expect(screen.queryByRole('complementary', { name: '機体' })).not.toBeInTheDocument()
    expect(editor().getByRole('button', { name: '機体に書き込む' })).toBeInTheDocument()
    expect(planRows()[0]!.querySelector('.plans-name')?.textContent).toBe('Alpha')
    expect(store.getState().history).toBe(before.history)
    expect(screen.getByTestId('mission-map').dataset.assign).toBe('off')
    // no switching while the editor saves / writes / reads
    act(() => store.update((u) => ({ ...u, busy: 'saving' })))
    expect(screen.queryByRole('group', { name: 'モード' })).not.toBeInTheDocument()
  })

  it('row_chips_list_assigned_vehicles_and_open_assign_mode', async () => {
    const { store } = setup()
    act(() => store.update((u) => loaded(u, savedMission('Alpha', 7), 7)))
    act(() => assignmentStore.applyFrame([row(2, 7), row(1, 7), row(3, 9)]))
    await pick([missionFile('Beta', 35)])
    const [alpha, beta] = planRows()
    expect(within(chips(alpha!)!).getAllByRole('button').map((b) => b.textContent)).toEqual(['UAV-01', 'UAV-02'])
    // an unsaved row has no chips
    expect(chips(beta!)).toBeNull()
    expect(store.getState().history.present.mission.name).toBe('Beta')
    // a chip opens the board without switching the row
    await act(async () => {
      fireEvent.click(within(chips(alpha!)!).getByRole('button', { name: 'UAV-02' }))
    })
    expect(screen.getByRole('complementary', { name: '機体' })).toBeInTheDocument()
    expect(store.getState().history.present.mission.name).toBe('Beta')
  })

  it('compare_table_has_no_write_button', async () => {
    const { store } = setup()
    act(() => store.update((u) => loaded(u, savedMission('Alpha', 7), 7)))
    act(() => assignmentStore.applyFrame([row(2, 7), row(1, 7)]))
    await pick([missionFile('Beta', 35)])
    const table = screen.getByTestId('plans-compare')
    expect(within(table).queryByRole('button')).toBeNull()
    expect(screen.queryByRole('button', { name: '割当どおり書き込む' })).toBeNull()
    const cells = within(table).getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[1]!.textContent)
    expect(cells).toEqual(['UAV-01, UAV-02', '—'])
  })
})

describe('MissionView write target (§8)', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('an_unassigned_row_never_falls_back_to_another_rows_vehicle', async () => {
    const { store, plans } = setup()
    await pick([missionFile('Alpha', 36), missionFile('Beta', 35)])
    fireEvent.click(planRows()[0]!.querySelector('.plans-name')!)
    expect(store.getState().history.present.mission.name).toBe('Alpha')
    // A gets UAV-02 from the right panel: the row is assigned, the mission's own vehicle is not written
    fireEvent.change(panelSelect(), { target: { value: '2' } })
    expect(plans.getState().rows[0]!.sysid).toBe(2)
    expect(store.getState().history.present.mission.sysid).toBeNull()
    // UAV-02 moves to B: A is unassigned
    fireEvent.click(planRows()[1]!.querySelector('.plans-name')!)
    fireEvent.change(panelSelect(), { target: { value: '2' } })
    fireEvent.click(planRows()[0]!.querySelector('.plans-name')!)
    expect(plans.getState().rows[0]!.sysid).toBeNull()
    expect(panelSelect().value).toBe('')
    expect(panelSelect().selectedOptions[0]!.textContent).toBe('未割当')
    expect(writeButton()).toBeDisabled()
    expect(editor().getByText('一覧で機体を割り当てると書き込めます')).toBeInTheDocument()
  })

  it('a_single_unassigned_mission_cannot_be_written_until_a_vehicle_is_picked', async () => {
    const { store, plans } = setup()
    await pick([missionFile('Alpha', 36)])
    expect(planRows()).toHaveLength(1)
    // the select says 未割当: no hidden fallback to the first vehicle
    expect(panelSelect().value).toBe('')
    expect(panelSelect().selectedOptions[0]!.textContent).toBe('未割当')
    expect(writeButton()).toBeDisabled()
    expect(editor().getByText('書込先の機体を選んでください')).toBeInTheDocument()
    fireEvent.change(panelSelect(), { target: { value: '2' } })
    expect(plans.getState().rows[0]!.sysid).toBe(2)
    expect(store.getState().history.present.mission.sysid).toBe(2)
    expect(writeButton()).toBeEnabled()
    expect(editor().queryByText('書込先の機体を選んでください')).not.toBeInTheDocument()
  })

  it('a_mission_saved_for_a_connected_vehicle_opens_with_it_visibly_selected', async () => {
    const { plans } = setup()
    await pick([missionFile('Alpha', 36, 2)])
    expect(panelSelect().value).toBe('2')
    expect(plans.getState().rows[0]!.sysid).toBe(2)
    expect(writeButton()).toBeEnabled()
  })

  it('a_mission_saved_for_a_vehicle_not_connected_opens_unassigned_and_names_it', async () => {
    setup({ extra: [{ ...copter(3), link: 'lost' }] })
    await pick([missionFile('Alpha', 36, 3)])
    expect(panelSelect().value).toBe('')
    expect(writeButton()).toBeDisabled()
    expect(editor().getByText('保存時の機体 UAV-03 は未接続')).toBeInTheDocument()
  })

  it('read_from_vehicle_preselects_the_ops_selection_and_assigns_what_it_read', async () => {
    const read = toMission(appendWaypoint(appendWaypoint(emptyDraft(), 36, 139), 36.01, 139))
    const { fetchMock, plans } = setup({ opsSelected: 2, fetchImpl: (url) => envelope(url === '/api/vehicles/2/mission' ? { ...read, sysid: 2 } : []) })
    const btn = editor().getByRole('button', { name: 'UAV-02 から読込' })
    expect(btn).toBeEnabled()
    await act(async () => {
      fireEvent.click(btn)
    })
    expect(fetchMock.mock.calls.some(([u]) => String(u) === '/api/vehicles/2/mission')).toBe(true)
    expect(plans.getState().rows.find((r) => r.key === plans.getState().active)!.sysid).toBe(2)
    expect(panelSelect().value).toBe('2')
  })
})
