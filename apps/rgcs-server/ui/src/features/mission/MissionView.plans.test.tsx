// MissionView with several missions open (spec 2026-10-20 §9): framing a row, multi-file open and
// the collapsible right panel. The map is mocked: it reports what it is asked to frame.
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VehicleState } from '../../shared/api/types'
import { t } from '../../shared/i18n'

vi.mock('./MissionMap', () => ({
  MissionMap: (p: { fitTo?: { seq: number; points: readonly { lat: number; lon: number }[] } | null; panelCollapsed?: boolean; pathColor?: string }) => (
    <div data-testid="mission-map" data-fit={JSON.stringify(p.fitTo?.points ?? [])} data-seq={p.fitTo?.seq ?? 0} data-collapsed={String(p.panelCollapsed ?? false)} data-pathcolor={p.pathColor ?? 'none'} />
  ),
}))

const { MissionView } = await import('./MissionView')
const { MissionStore } = await import('./store')
const { PlanSetStore } = await import('../plans/store')
const { appendWaypoint, emptyDraft, toMission } = await import('./model')
const { serializeRgcsMission } = await import('./files')
const { rasterStyle } = await import('../map/style')
const { vehicleStore } = await import('../vehicles/store')

const copter: VehicleState = {
  sysid: 1, name: 'UAV-01', kind: 'copter', mode: 'STABILIZE', armed: false, lat: 35.479883, lon: 138.47829, alt_rel: 0, alt_msl: 0, hdg: 0,
  ground_speed: 0, climb: 0, battery: { pct: 90, volt: 24, current: null }, link: 'ok', last_rx_ms: 0, gps: { fix: 3, sats: 12, hdop: 1 }, warn: false, unread: 0,
}
const style = rasterStyle('https://t/{z}/{x}/{y}.png', 'x')
const envelope = (data: unknown) => new Response(JSON.stringify({ success: true, data }), { status: 200, headers: { 'content-type': 'application/json' } })

function setup() {
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => envelope([])))
  const store = new MissionStore()
  const plans = new PlanSetStore()
  const view = () => <MissionView vehicles={new Map([[1, copter]])} dict={t('ja')} style={style} store={store} plans={plans} />
  const utils = render(view())
  return { ...utils, view, store, plans }
}

const planRows = () => [...document.querySelectorAll<HTMLElement>('.plans-row')]
const names = () => planRows().map((r) => r.querySelector('.plans-name')?.textContent)
const fitted = () => JSON.parse(screen.getByTestId('mission-map').dataset.fit!) as { lat: number; lon: number }[]
/** A mission of waypoints at (lat0 + i·0.01, 139), a fence circle and a rally point. */
function missionFile(name: string, lat0: number, points: number, withPlan = false): File {
  const draft = Array.from({ length: points }).reduce<ReturnType<typeof emptyDraft>>((d, _, i) => appendWaypoint(d, lat0 + i * 0.01, 139), emptyDraft())
  const m = toMission(draft)
  const plan = withPlan ? { fence: [{ kind: 'circle' as const, inclusion: true, center: { lat: lat0, lon: 139.5 }, radius: 100 }], rally: [{ lat: lat0 - 0.5, lon: 139, alt: 50 }] } : {}
  return new File([serializeRgcsMission({ ...m, ...plan, name })], `${name}.rgcsmission`)
}
const pick = async (files: File[]) => {
  await act(async () => {
    fireEvent.change(screen.getByTestId('mission-file'), { target: { files } })
  })
}

describe('MissionView plans feedback (§9)', () => {
  beforeEach(() => localStorage.removeItem('rgcs.planPanel'))
  afterEach(() => vi.unstubAllGlobals())

  it('the_open_plans_have_no_named_container_to_save_or_open', () => {
    setup()
    expect(document.querySelector('.plans-head')).toBeNull()
    expect(document.body.textContent).not.toMatch(/ブリーフィング/)
    expect(screen.queryByRole('textbox', { name: /ブリーフィング/ })).toBeNull()
    // an untouched editor is the new plan: 新しいプラン adds a row only once something is in it
    expect(names()).toEqual(['新しいプラン'])
    expect(screen.getByRole('button', { name: '新しいプラン' })).toBeInTheDocument()
    expect(screen.getByRole('list', { name: '開いているプラン' })).toBeInTheDocument()
  })

  it('the_label_menu_hides_wp_numbers_altitudes_and_insert_buttons_one_by_one', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => envelope([])))
    const { LabelPrefsStore } = await import('./labelPrefs')
    const items: Record<string, string> = {}
    const labels = new LabelPrefsStore({ getItem: (k) => items[k] ?? null, setItem: (k, v) => void (items[k] = v) })
    render(<MissionView vehicles={new Map([[1, copter]])} dict={t('ja')} style={style} store={new MissionStore()} plans={new PlanSetStore()} labels={labels} />)
    const root = screen.getByTestId('mission-view')
    fireEvent.click(screen.getByRole('button', { name: '地図のラベル' }))
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'WP 番号' }))
    expect(root.classList.contains('labels-no-num')).toBe(true)
    expect(root.classList.contains('labels-no-alt')).toBe(false)
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: '高度と高度の種類 (3D)' }))
    expect(root.classList.contains('labels-no-alt')).toBe(true)
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'WP 番号' }))
    expect(root.classList.contains('labels-no-num')).toBe(false)
    fireEvent.click(screen.getByRole('menuitemcheckbox', { name: 'WP 間の挿入ボタン (+)' }))
    expect(root.classList.contains('labels-no-mid')).toBe(true)
  })

  it('several_files_open_several_rows_and_a_bad_one_does_not_stop_the_rest', async () => {
    const { store } = setup()
    expect((screen.getByTestId('mission-file') as HTMLInputElement).multiple).toBe(true)
    const imports = () => vehicleStore.getState().results.filter((r) => r.cmd === 'mission_import')
    const before = imports().length
    // two bad files failing within the same millisecond: both errors are kept, each naming its file
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000)
    try {
      await pick([missionFile('Alpha', 36, 2), new File(['{ nonsense'], 'Broken.rgcsmission'), new File(['{ worse'], 'Worse.rgcsmission'), missionFile('Gamma', 35, 1)])
    } finally {
      now.mockRestore()
    }
    expect(names()).toEqual(['Alpha', 'Gamma'])
    expect(store.getState().history.present.mission.name).toBe('Gamma')
    const failed = imports().slice(0, imports().length - before)
    expect(failed).toHaveLength(2)
    expect(failed.every((r) => !r.ok && r.id < 0)).toBe(true)
    expect(failed.map((r) => r.reason).join(' ')).toContain('Broken.rgcsmission')
    expect(failed.map((r) => r.reason).join(' ')).toContain('Worse.rgcsmission')
  })

  it('a_single_mission_keeps_the_altitude_colours_and_two_use_the_row_colour', async () => {
    const { plans } = setup()
    const color = () => screen.getByTestId('mission-map').dataset.pathcolor
    expect(color()).toBe('none')
    await pick([missionFile('Alpha', 36, 2)])
    expect(color()).toBe('none')
    await pick([missionFile('Beta', 35, 2)])
    expect(color()).toBe(plans.getState().rows[1]!.color)
  })

  it('double_clicking_a_row_frames_that_mission', async () => {
    const { store } = setup()
    await pick([missionFile('Alpha', 36, 2, true), missionFile('Beta', 35, 3)])
    // a parked row: the first click switches to it, the double-click frames it
    const alpha = planRows()[0]!.querySelector('.plans-name')!
    fireEvent.click(alpha)
    expect(store.getState().history.present.mission.name).toBe('Alpha')
    fireEvent.doubleClick(alpha)
    const pts = fitted()
    const lats = pts.map((p) => p.lat)
    // its waypoints, the fence circle (east of them) and the rally point (south)
    expect(lats).toEqual(expect.arrayContaining([36, 36.01, 35.5]))
    expect(Math.max(...pts.map((p) => p.lon))).toBeGreaterThan(139.5)
    // nothing of Beta's
    expect(lats.some((l) => l < 35.1)).toBe(false)
    // the active row frames too, with the live draft
    fireEvent.click(planRows()[1]!.querySelector('.plans-name')!)
    const seq = Number(screen.getByTestId('mission-map').dataset.seq)
    fireEvent.doubleClick(planRows()[1]!.querySelector('.plans-name')!)
    expect(Number(screen.getByTestId('mission-map').dataset.seq)).toBe(seq + 1)
    expect(fitted().map((p) => p.lat).sort()).toEqual([35, 35.01, 35.02])
    // anywhere on the row frames it (here the row itself, beside the name)
    fireEvent.doubleClick(planRows()[1]!)
    expect(Number(screen.getByTestId('mission-map').dataset.seq)).toBe(seq + 2)
    // a double-click on the row's controls frames nothing
    fireEvent.doubleClick(within(planRows()[1]!).getByLabelText('色'))
    fireEvent.doubleClick(within(planRows()[1]!).getByLabelText('上へ'))
    expect(Number(screen.getByTestId('mission-map').dataset.seq)).toBe(seq + 2)
  })

  it('the_right_panel_collapses_on_every_tab_and_remembers_it', () => {
    const { unmount, view } = setup()
    const tabs = () => within(screen.getByRole('group', { name: '計画の種類' }))
    const map = () => screen.getByTestId('mission-map')
    expect(map().dataset.collapsed).toBe('false')
    fireEvent.click(within(screen.getByRole('complementary', { name: 'editor' })).getByRole('button', { name: 'パネルをたたむ' }))
    expect(screen.queryByRole('complementary', { name: 'editor' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'パネルを開く' })).toBeInTheDocument()
    expect(map().dataset.collapsed).toBe('true')
    expect(localStorage.getItem('rgcs.planPanel')).toBe('collapsed')
    // the other tabs stay collapsed, and their panels collapse the same way
    fireEvent.click(tabs().getByRole('button', { name: 'フェンス' }))
    expect(screen.queryByRole('complementary', { name: 'フェンス設定' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'パネルを開く' }))
    expect(map().dataset.collapsed).toBe('false')
    fireEvent.click(within(screen.getByRole('complementary', { name: 'フェンス設定' })).getByRole('button', { name: 'パネルをたたむ' }))
    fireEvent.click(tabs().getByRole('button', { name: 'ラリー' }))
    expect(screen.queryByRole('complementary', { name: 'ラリーポイント設定' })).not.toBeInTheDocument()
    // a new visit (reload) keeps it collapsed
    unmount()
    render(view())
    expect(screen.getByRole('button', { name: 'パネルを開く' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'パネルを開く' }))
    expect(within(screen.getByRole('complementary', { name: 'ラリーポイント設定' })).getByRole('button', { name: 'パネルをたたむ' })).toBeInTheDocument()
    expect(localStorage.getItem('rgcs.planPanel')).toBe('open')
    localStorage.removeItem('rgcs.planTab')
  })
})
