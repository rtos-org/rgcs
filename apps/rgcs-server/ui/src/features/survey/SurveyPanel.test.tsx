import { fireEvent, render, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VehicleKind } from '../../shared/api/types'
import { t, type Dict } from '../../shared/i18n'
import { initHistory } from '../mission/history'
import { MissionSidebar } from '../mission/MissionSidebar'
import type { Draft } from '../mission/model'
import { MissionStore, edit, undoUi, useMissionUi } from '../mission/store'
import { stats } from '../mission/summary'
import { blur, footprint, gsdCm, triggerDistM } from './photo'
import { ALPHA7R4, type SurveySpec } from './spec'
import { HOME, surveyDraft } from './surveyFixture'
import { useSurveyEditor } from './useSurveyEditor'

const apiFetch = vi.fn(() => Promise.resolve([] as unknown))
vi.mock('../../shared/api/client', () => ({ apiFetch: () => apiFetch() }))
/** Front overlap 77 stands for a change after which no lane fits (as a polygon edit can do). */
const NO_LANES = 77
vi.mock('./generate', async (importOriginal) => {
  const real = await importOriginal<typeof import('./generate')>()
  return { ...real, generateSurvey: (spec: SurveySpec, home: Parameters<typeof real.generateSurvey>[1]) => (spec.frontPct === NO_LANES ? { error: 'invalid_polygon' as const } : real.generateSurvey(spec, home)) }
})

const TRIG = 206

function Harness({ store, dict, kind }: { store: MissionStore; dict: Dict; kind: VehicleKind | null }) {
  const ui = useMissionUi(store)
  const draft = ui.history.present
  const change = (fn: (d: Draft) => Draft) => store.update((u) => edit(u, fn(u.history.present)))
  const sv = useSurveyEditor({ draft, change, home: HOME, terrainTiles: null, vehicleParams: new Map() })
  const noop = () => {}
  return (
    <MissionSidebar
      draft={draft}
      selectedItems={draft.items.filter((it) => ui.selected.has(it.uid))}
      vehicles={[]}
      sysid={null}
      kind={kind}
      stats={stats(draft.items, draft.mission.home, draft.mission.speed)}
      warnings={[]}
      findings={[]}
      dirty={false}
      busy={false}
      dict={dict}
      bulk={{ alt: '50', frame: 'rel' }}
      onBulk={noop}
      onApplyBulk={noop}
      onDeselect={noop}
      onDeleteSelected={noop}
      onMeta={noop}
      onItemChange={noop}
      onItemCommand={noop}
      takeoff={null}
      onFix={noop}
      onNew={noop}
      onOpen={noop}
      onSave={noop}
      onUpload={noop}
      onRead={noop}
      canRead={false}
      onSaveFile={noop}
      onSaveRgcs={noop}
      survey={sv}
    />
  )
}

function setup(o: Partial<SurveySpec> = {}, lang: 'ja' | 'en' = 'ja') {
  const { draft } = surveyDraft(o)
  const store = new MissionStore()
  store.update((u) => ({ ...u, history: initHistory(draft), selected: new Set([draft.items[3]!.uid]) }))
  const dict = t(lang)
  const view = render(<Harness store={store} dict={dict} kind="plane" />)
  const present = () => store.getState().history.present
  return { store, dict, view, present }
}

const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement
const typeIn = (label: string, value: string) => {
  fireEvent.change(field(label), { target: { value } })
  fireEvent.blur(field(label))
}
const triggerOn = (d: Draft) => d.items.find((it) => it.command === TRIG && it.params[0] > 0)!

let dict: Dict
beforeEach(() => {
  dict = t('ja')
})

describe('SurveyPanel', () => {
  it('shows_the_survey_panel_instead_of_the_item_editor', () => {
    setup()
    expect(screen.getByTestId('survey-panel')).toBeInTheDocument()
    expect(screen.queryByTestId('item-editor')).toBeNull()
  })

  it('front_overlap_75_regenerates_with_the_new_trigger_distance', () => {
    const s = setup()
    const before = s.present().surveys[0]!.uids
    typeIn(dict.svFront, '75')
    const d = s.present()
    expect(d.surveys[0]!.uids).not.toEqual(before)
    expect(triggerOn(d).params[0]).toBeCloseTo(triggerDistM(footprint(ALPHA7R4, 100, 'landscape'), 75), 6)
    expect(screen.getByTestId('survey-panel')).toBeInTheDocument()
  })

  it('side_overlap_changes_the_item_count', () => {
    const s = setup()
    const n = s.present().items.length
    typeIn(dict.svSide, '85')
    expect(s.present().items.length).not.toBe(n)
  })

  it('a_change_that_yields_no_lanes_keeps_the_items_and_says_so', () => {
    const s = setup()
    const items = s.present().items
    expect(screen.queryByText(dict.svInvalidPolygon)).toBeNull()
    typeIn(dict.svFront, String(NO_LANES))
    expect(s.present().items).toBe(items)
    expect(screen.getByText(dict.svInvalidPolygon)).toHaveClass('hint', 'caution')
    typeIn(dict.svFront, '75')
    expect(screen.queryByText(dict.svInvalidPolygon)).toBeNull()
  })

  it('typing_gsd_2_shows_altitude_186', () => {
    setup()
    typeIn(dict.svGsd, '2.0')
    expect(field(dict.svAlt).value).toBe('186')
  })

  it('wind_4_shows_the_blur_at_22_ms', () => {
    setup()
    typeIn(dict.svWind, '4')
    const b = blur(ALPHA7R4, 22, gsdCm(ALPHA7R4, 100))
    expect(screen.getByTestId('sv-blur')).toHaveTextContent(`${b.cm.toFixed(1)} cm / ${b.px.toFixed(2)} px`)
  })

  it('a_slider_drag_then_one_undo_returns_to_before_the_drag', () => {
    const s = setup()
    const slider = screen.getByRole('slider', { name: dict.svAngle })
    const past = s.store.getState().history.past.length
    fireEvent.change(slider, { target: { value: '30' } })
    fireEvent.change(slider, { target: { value: '45' } })
    expect(s.present().surveys[0]!.spec.angleDeg).toBe(90)
    fireEvent.pointerUp(slider)
    expect(s.present().surveys[0]!.spec.angleDeg).toBe(45)
    expect(s.store.getState().history.past.length).toBe(past + 1)
    s.store.update(undoUi)
    expect(s.present().surveys[0]!.spec.angleDeg).toBe(90)
  })

  it('typing_camera_values_commits_once_on_blur', () => {
    const s = setup()
    const past = s.store.getState().history.past.length
    fireEvent.change(field(dict.svFocal), { target: { value: '2' } })
    fireEvent.change(field(dict.svFocal), { target: { value: '24' } })
    expect(s.present().surveys[0]!.spec.camera.focalMm).toBe(35)
    fireEvent.blur(field(dict.svFocal))
    expect(s.present().surveys[0]!.spec.camera.focalMm).toBe(24)
    expect(s.store.getState().history.past.length).toBe(past + 1)
  })

  it('a_copter_airframe_hides_the_turn_fields', () => {
    setup({ airframe: 'copter', speedMs: 8 })
    for (const label of [dict.svSkip, dict.svBank, dict.svLeadIn, dict.svOvershoot]) expect(screen.queryByLabelText(label)).toBeNull()
    expect(screen.queryByRole('group', { name: dict.svTurn })).toBeNull()
  })

  it('choosing_arcwaypoint_shows_the_arc_warning', () => {
    setup()
    expect(screen.queryByText(dict.svWarnArc)).toBeNull()
    fireEvent.click(within(screen.getByRole('group', { name: dict.svTurn })).getByRole('button', { name: dict.svTurnArc }))
    expect(screen.getByText(dict.svWarnArc)).toHaveClass('hint', 'caution')
  })

  it('the_wp_radius_and_l1_warnings_name_their_values', () => {
    setup()
    expect(screen.getByText(dict.svWarnWpRadius.replace('{n}', '90'))).toBeInTheDocument()
    // no vehicle: ArduPlane's NAVL1 defaults, 17 × 0.75 × 18 / π = 73 m against R 57 m
    expect(screen.getByText(dict.svWarnL1.replace('{r}', '57').replace('{l1}', '73'))).toBeInTheDocument()
  })

  it('expand_removes_the_panel_and_leaves_the_items', () => {
    const s = setup()
    const n = s.present().items.length
    fireEvent.click(screen.getByRole('button', { name: dict.svExpand }))
    expect(screen.queryByTestId('survey-panel')).toBeNull()
    expect(screen.getByTestId('item-editor')).toBeInTheDocument()
    expect(s.present().items).toHaveLength(n)
    expect(s.present().surveys).toEqual([])
  })

  it('every_panel_string_comes_from_dict', () => {
    setup({}, 'en')
    const text = screen.getByTestId('survey-panel').textContent ?? ''
    expect(text).not.toMatch(/[぀-ヿ一-鿿]/)
    expect(text).toContain(t('en').svExpand)
  })

  it('a camera list failure reads from the dictionary, the server message only as a detail', async () => {
    apiFetch.mockImplementationOnce(() => Promise.reject(new Error('HTTP 500 internal')))
    setup()
    const hint = await screen.findByText(dict.svCamLoadFailed)
    expect(hint.textContent).toBe(dict.svCamLoadFailed)
    expect(screen.getByText('HTTP 500 internal')).toHaveClass('t3')
  })
})
