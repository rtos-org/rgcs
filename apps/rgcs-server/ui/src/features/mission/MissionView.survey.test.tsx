import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { VehicleState } from '../../shared/api/types'
import { t } from '../../shared/i18n'
import { at, surveyDraft } from '../survey/surveyFixture'

// map clicks go where the real map sends them: the survey drawing first, else "add a waypoint"
const POINTS = [at(-300, -300), at(-300, -200), at(-300, -100), at(0, 0), at(600, 0), at(600, 500)]
let clicks = 0
let contextUid = 0
type Ring = readonly { lat: number; lon: number }[]
interface MapProps {
  onAdd: (lat: number, lon: number) => void
  onContext: (m: { uid: number; x: number; y: number }) => void
  surveyDraw?: { ring: readonly unknown[]; onClick: (lat: number, lon: number) => void } | null
  draft: { surveys: readonly { id: string; spec: { polygon: Ring } }[] }
  predict?: (d: never) => { points: readonly unknown[] } | null
  survey?: { onPolygon: (id: string, ring: Ring, done: boolean) => void; showFootprints: boolean; previewing: boolean } | null
}
/** The ring a map vertex drag sends: vertex 2 moved 0.001° east of where the drag started. */
let dragged: Ring = []
const dragVertex = (p: MapProps, done: boolean) => {
  const s = p.draft.surveys[0]!
  if (!done) dragged = s.spec.polygon.map((q, i) => (i === 2 ? { lat: q.lat, lon: q.lon + 0.001 } : q))
  p.survey?.onPolygon(s.id, dragged, done)
}
vi.mock('./MissionMap', () => ({
  MissionMap: (p: MapProps) => (
    <div
      data-testid="mission-map"
      data-drawing={p.surveyDraw ? p.surveyDraw.ring.length : -1}
      data-lon2={p.draft.surveys[0]?.spec.polygon[2]?.lon ?? ''}
      data-predicted={p.predict ? (p.predict(p.draft as never)?.points.length ?? 0) : -1}
      data-foot={String(p.survey?.showFootprints ?? '')}
      data-previewing={String(p.survey?.previewing ?? '')}
    >
      <button type="button" onClick={() => dragVertex(p, false)}>
        vertex-drag
      </button>
      <button type="button" onClick={() => dragVertex(p, true)}>
        vertex-drop
      </button>
      <button
        type="button"
        onClick={() => {
          const pt = POINTS[clicks++ % POINTS.length]!
          if (p.surveyDraw) p.surveyDraw.onClick(pt.lat, pt.lon)
          else p.onAdd(pt.lat, pt.lon)
        }}
      >
        map-click
      </button>
      <button type="button" onClick={() => p.onContext({ uid: contextUid, x: 0, y: 0 })}>
        map-context
      </button>
    </div>
  ),
}))

const { MissionView } = await import('./MissionView')
const { MissionStore, edit, selectOne } = await import('./store')
const { PlanSetStore } = await import('../plans/store')
const { rasterStyle } = await import('../map/style')

const dict = t('ja')
const copter: VehicleState = {
  sysid: 1, name: 'UAV-01', kind: 'copter', mode: 'STABILIZE', armed: false, lat: 35.479883, lon: 138.47829, alt_rel: 0, alt_msl: 0, hdg: 0,
  ground_speed: 0, climb: 0, battery: { pct: 90, volt: 24, current: null }, link: 'ok', last_rx_ms: 0, gps: { fix: 3, sats: 12, hdop: 1 }, warn: false, unread: 0,
}
const envelope = (data: unknown) => new Response(JSON.stringify({ success: true, data }), { status: 200, headers: { 'content-type': 'application/json' } })

function setup() {
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => envelope([])))
  const store = new MissionStore()
  render(<MissionView vehicles={new Map([[1, copter]])} dict={dict} style={rasterStyle('https://t/{z}/{x}/{y}.png', 'x')} store={store} plans={new PlanSetStore()} />)
  return store
}
const mapClick = (n: number) => {
  for (let i = 0; i < n; i++) fireEvent.click(screen.getByText('map-click'))
}
const view = () => screen.getByTestId('mission-view')
const openPalette = () => fireEvent.click(screen.getByRole('button', { name: new RegExp(dict.mInsertCmd) }))
const palette = () => screen.getByRole('dialog', { name: dict.mInsertCmd })
/** Takeoff + three waypoints, the first waypoint selected. */
function planWithSelection(store: InstanceType<typeof MissionStore>) {
  mapClick(3)
  const wp1 = store.getState().history.present.items[1]!
  fireEvent.click(document.querySelectorAll<HTMLElement>('.wrow')[1]!)
  return wp1.uid
}

describe('MissionView survey drawing', () => {
  beforeEach(() => {
    clicks = 0
  })
  afterEach(() => vi.unstubAllGlobals())

  it('palette サーベイ enters drawing; three clicks + Enter create a survey after the selected item', async () => {
    const store = setup()
    // the airframe comes from the write target, which the operator picks
    fireEvent.change(within(screen.getByRole('complementary', { name: 'editor' })).getByLabelText('対象機体'), { target: { value: '1' } })
    const after = planWithSelection(store)
    openPalette()
    fireEvent.click(within(palette()).getByRole('button', { name: /^サーベイ/ }))
    expect(screen.queryByRole('dialog', { name: dict.mInsertCmd })).toBeNull()
    expect(screen.getByTestId('survey-draw-hint').textContent).toContain(dict.svDrawHint)
    expect(screen.getByTestId('mission-map').dataset.drawing).toBe('0')
    mapClick(3)
    expect(store.getState().history.present.items).toHaveLength(4)
    await act(async () => {
      fireEvent.keyDown(view(), { key: 'Enter' })
    })
    const d = store.getState().history.present
    expect(d.surveys).toHaveLength(1)
    const s = d.surveys[0]!
    const i = d.items.findIndex((it) => it.uid === after)
    expect(d.items[i + 1]!.uid).toBe(s.uids[0])
    expect(s.spec.airframe).toBe('copter')
    expect([...store.getState().selected]).toEqual([s.uids[0]])
    expect(screen.queryByTestId('survey-draw-hint')).toBeNull()
    expect(screen.getByTestId('survey-panel')).toBeInTheDocument()
    expect(screen.getAllByTestId('survey-row')).toHaveLength(1)
  })

  it('Esc while drawing leaves the draft unchanged', () => {
    const store = setup()
    planWithSelection(store)
    const before = store.getState().history.present
    openPalette()
    fireEvent.click(within(palette()).getByRole('button', { name: /^サーベイ/ }))
    mapClick(3)
    fireEvent.keyDown(view(), { key: 'Escape' })
    expect(store.getState().history.present).toBe(before)
    expect(screen.queryByTestId('survey-draw-hint')).toBeNull()
    expect(screen.getByTestId('mission-map').dataset.drawing).toBe('-1')
  })

  it('palette KML opens the file picker; two polygons ask which one inline', async () => {
    const store = setup()
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
    openPalette()
    fireEvent.click(within(palette()).getByRole('button', { name: /KML から読み込む/ }))
    expect(click).toHaveBeenCalled()
    click.mockRestore()
    const ring = (lat: number) => `139,${lat} 139.01,${lat} 139.01,${lat + 0.01} 139,${lat}`
    const mark = (name: string, lat: number) => `<Placemark><name>${name}</name><Polygon><outerBoundaryIs><LinearRing><coordinates>${ring(lat)}</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>`
    const text = `<kml xmlns="http://www.opengis.net/kml/2.2"><Document>${mark('North', 36.2)}${mark('South', 36.1)}</Document></kml>`
    await act(async () => {
      fireEvent.change(screen.getByTestId('survey-kml-file'), { target: { files: [new File([text], 'a.kml')] } })
    })
    fireEvent.click(within(screen.getByRole('list', { name: dict.svKmlChoose })).getByRole('button', { name: /South/ }))
    const d = store.getState().history.present
    expect(d.surveys.map((s) => s.spec.name)).toEqual(['South'])
  })

  /** Draws a survey after the first waypoint; returns its uids. */
  async function drawSurvey(store: InstanceType<typeof MissionStore>) {
    planWithSelection(store)
    openPalette()
    fireEvent.click(within(palette()).getByRole('button', { name: /^サーベイ/ }))
    mapClick(3)
    await act(async () => {
      fireEvent.keyDown(view(), { key: 'Enter' })
    })
    return store.getState().history.present.surveys[0]!.uids
  }
  const intactAfter = (store: InstanceType<typeof MissionStore>, uids: readonly number[]) => {
    const d = store.getState().history.present
    expect(d.surveys).toHaveLength(1)
    expect(d.surveys[0]!.uids).toEqual(uids)
    const end = d.items.findIndex((it) => it.uid === uids.at(-1))
    return d.items[end + 1]!
  }

  it('group-row click then palette WAYPOINT: the waypoint goes right after the survey, which stays intact', async () => {
    const store = setup()
    const uids = await drawSurvey(store)
    const nextUid = store.getState().history.present.nextUid
    fireEvent.click(screen.getByTestId('survey-head'))
    expect([...store.getState().selected]).toEqual([uids[0]])
    openPalette()
    fireEvent.click(within(palette()).getAllByRole('button', { name: /^ウェイポイント/ })[0]!)
    const wp = intactAfter(store, uids)
    expect([wp.uid, wp.command]).toEqual([nextUid, 16])
  })

  it('the map context-menu insert on a survey item also goes after the survey', async () => {
    const store = setup()
    const uids = await drawSurvey(store)
    const nextUid = store.getState().history.present.nextUid
    contextUid = uids[1]!
    fireEvent.click(screen.getByText('map-context'))
    fireEvent.click(screen.getByRole('menuitem', { name: dict.mInsertAfter }))
    expect(intactAfter(store, uids).uid).toBe(nextUid)
  })
})

describe('MissionView survey on the map', () => {
  afterEach(() => vi.unstubAllGlobals())
  const frame = () => act(async () => void (await new Promise((r) => setTimeout(r, 40))))

  /** A plane survey (with a home) in the store and selected; no vehicle unless given. */
  function seeded(vehicles: ReadonlyMap<number, VehicleState> = new Map()) {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => envelope([])))
    const store = new MissionStore()
    const { draft } = surveyDraft()
    store.update((u) => selectOne(edit(u, draft), draft.surveys[0]!.uids[0]!, false))
    render(<MissionView vehicles={vehicles} dict={dict} style={rasterStyle('https://t/{z}/{x}/{y}.png', 'x')} store={store} plans={new PlanSetStore()} />)
    return store
  }
  const lon2 = () => Number(screen.getByTestId('mission-map').dataset.lon2)

  it('a vertex drag previews on the map (no commit) and its release is one undo step', async () => {
    const store = seeded()
    const start = store.getState().history
    const before = start.present.surveys[0]!.spec.polygon[2]!.lon
    expect(lon2()).toBe(before)
    fireEvent.click(screen.getByText('vertex-drag'))
    await frame()
    expect(lon2()).toBeCloseTo(before + 0.001, 9)
    expect(screen.getByTestId('mission-map').dataset.previewing).toBe('true')
    expect(store.getState().history).toBe(start)
    fireEvent.click(screen.getByText('vertex-drop'))
    const h = store.getState().history
    expect(h.past).toHaveLength(start.past.length + 1)
    expect(h.present.surveys[0]!.spec.polygon[2]!.lon).toBeCloseTo(before + 0.001, 9)
    expect(lon2()).toBeCloseTo(before + 0.001, 9)
    expect(screen.getByTestId('mission-map').dataset.previewing).toBe('false')
    // the panel and the map share the survey: the panel still shows it after the commit
    expect(screen.getByTestId('survey-panel')).toBeInTheDocument()
  })

  it('without a vehicle the predicted line flies the survey at its own speed / bank / WP radius', () => {
    seeded()
    expect(Number(screen.getByTestId('mission-map').dataset.predicted)).toBeGreaterThan(1)
  })

  it('the footprint button shows with a survey and switches the map footprints', () => {
    localStorage.removeItem('rgcs.surveyFoot')
    seeded()
    expect(screen.getByTestId('mission-map').dataset.foot).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: dict.svFootToggle }))
    expect(screen.getByTestId('mission-map').dataset.foot).toBe('true')
  })
})
