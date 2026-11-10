import { act, render, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { created, FakeMap } from '../../test/fakeMaplibre'

vi.mock('maplibre-gl', async () => (await import('../../test/fakeMaplibre')).maplibreModule)

const { MissionMap } = await import('./MissionMap')
const { appendWaypoint, emptyDraft, removeItems } = await import('./model')
const { rasterStyle } = await import('../map/style')
const { toMercator } = await import('../map/air')
const { missionAirData } = await import('./missionAir')
const { planSetMapOf } = await import('../plans/usePlanSetMap')
const { activeRow, addRow, emptyWorkspace } = await import('../plans/model')
const { INITIAL_MISSION_UI } = await import('./store')
const { overlayPrefsStore } = await import('../overlays/prefs')
const { pluginsStore } = await import('../overlays/plugins')
const { overlayFetch } = await import('../overlays/testData')

const style = rasterStyle('https://t/{z}/{x}/{y}.png', 'x')
const draft3 = () => appendWaypoint(appendWaypoint(appendWaypoint(emptyDraft(), 36.1, 139.1), 36.2, 139.2), 36.3, 139.3)
const badges = () => created.markers.filter((m) => m.el.classList.contains('rg-wp') && !m.removed)
const feet = () => created.markers.filter((m) => m.el.classList.contains('rg-foot') && !m.removed)
const handles = () => created.markers.filter((m) => m.el.classList.contains('rg-mid') && !m.removed)

function renderMap(over: Partial<React.ComponentProps<typeof MissionMap>> = {}) {
  const props = {
    draft: draft3(),
    selected: new Set<number>(),
    tool: 'add' as const,
    style,
    vehicle: null,
    fitRequest: 0,
    onAdd: vi.fn(),
    onInsertAfter: vi.fn(),
    onMove: vi.fn(),
    onMoveSelected: vi.fn(),
    onShiftAlt: vi.fn(),
    onBoxSelect: vi.fn(),
    onArc: vi.fn(),
    onPlanClick: vi.fn(),
    onFenceEdit: vi.fn(),
    onRallyMove: vi.fn(),
    onSelect: vi.fn(),
    onBackgroundClick: vi.fn(),
    onContext: vi.fn(),
    ...over,
  }
  const utils = render(<MissionMap {...props} />)
  return { ...utils, props }
}

describe('MissionMap', () => {
  beforeEach(() => {
    created.maps = []
    created.markers = []
    created.deferLoad = false
  })

  it('passes the configured encoding to the DEM source', () => {
    const addSource = vi.spyOn(FakeMap.prototype, 'addSource')
    renderMap({ terrainTiles: 'https://dem/{z}/{x}/{y}.png', terrainEncoding: 'mapbox', mode: '3d' })
    expect(addSource).toHaveBeenCalledWith('dem', expect.objectContaining({ encoding: 'mapbox', minzoom: 6 }))
    addSource.mockRestore()
  })

  it('3d_can_tilt_down_to_near_the_ground', () => {
    renderMap()
    expect((created.maps[0]!.options as { maxPitch?: number }).maxPitch).toBe(85)
  })

  it('path_is_set_when_the_style_loads_after_mount_with_an_existing_draft', () => {
    created.deferLoad = true
    renderMap()
    const map = created.maps[0]!
    expect(map.sources.size).toBe(0)
    act(() => map.fire('load'))
    const path = map.sources.get('mission-path')!
    const last = path.setData.mock.calls.at(-1)![0] as { features: unknown[] }
    expect(last.features).toHaveLength(2)
  })

  it('renders_one_badge_per_item_and_a_handle_per_leg', () => {
    renderMap({ selected: new Set([2]) })
    expect(created.maps).toHaveLength(1)
    expect((created.maps[0]!.options as { boxZoom: boolean }).boxZoom).toBe(false)
    expect(badges()).toHaveLength(3)
    expect(handles()).toHaveLength(2)
    expect(badges()[1]!.el.className).toBe('rg-wp sel')
    expect(badges()[0]!.lngLat).toEqual([139.1, 36.1])
    // the TAKEOFF (badge T) stays put: ArduCopter takes off where it stands
    expect(badges().map((m) => m.draggable)).toEqual([false, true, true])
    const path = created.maps[0]!.sources.get('mission-path')!
    const last = path.setData.mock.calls.at(-1)![0] as { features: unknown[] }
    expect(last.features).toHaveLength(2)
  })

  it('click_in_add_tool_calls_onAdd_with_lnglat_and_select_tool_clears', () => {
    const { props, rerender } = renderMap()
    act(() => created.maps[0]!.fire('click', { lngLat: { lat: 36.5, lng: 139.5 }, originalEvent: {} }))
    expect(props.onAdd).toHaveBeenCalledWith(36.5, 139.5)
    rerender(<MissionMap {...props} tool="select" />)
    act(() => created.maps[0]!.fire('click', { lngLat: { lat: 36.6, lng: 139.6 }, originalEvent: {} }))
    expect(props.onAdd).toHaveBeenCalledTimes(1)
    expect(props.onBackgroundClick).toHaveBeenCalledTimes(1)
  })

  it('dragend_calls_onMove_with_the_marker_position_and_multi_drag_moves_the_selection', () => {
    const { props, rerender } = renderMap()
    const b = badges()[1]!
    act(() => {
      b.fire('dragstart')
      b.setLngLat([139.25, 36.25])
      b.fire('dragend')
    })
    expect(props.onMove).toHaveBeenCalledWith(2, 36.25, 139.25)
    expect(props.onMoveSelected).not.toHaveBeenCalled()
    rerender(<MissionMap {...props} selected={new Set([1, 2])} />)
    const a = badges()[0]!
    act(() => {
      a.fire('dragstart')
      a.setLngLat([139.15, 36.15])
      a.fire('dragend')
    })
    expect(props.onMoveSelected).toHaveBeenCalledWith(expect.closeTo(0.05, 6), expect.closeTo(0.05, 6))
  })

  it('ctrl_or_cmd_click_toggles_shift_click_selects_a_range_and_contextmenu_reports_the_item', () => {
    const { props } = renderMap()
    const el = badges()[2]!.el
    act(() => el.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true })))
    expect(props.onSelect).toHaveBeenCalledWith(3, true, false)
    act(() => el.dispatchEvent(new MouseEvent('click', { bubbles: true, metaKey: true })))
    expect(props.onSelect).toHaveBeenLastCalledWith(3, true, false)
    act(() => el.dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true })))
    expect(props.onSelect).toHaveBeenLastCalledWith(3, false, true)
    act(() => el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 40, clientY: 50 })))
    expect(props.onContext).toHaveBeenCalledWith({ uid: 3, x: 40, y: 50 })
    act(() => handles()[0]!.el.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(props.onInsertAfter).toHaveBeenCalledWith(1, expect.closeTo(36.15, 9), expect.closeTo(139.15, 9))
  })

  it('fit_request_fits_the_bounds_of_the_items', () => {
    const { props, rerender } = renderMap()
    expect(created.maps[0]!.fitted).toHaveLength(0)
    rerender(<MissionMap {...props} fitRequest={1} />)
    expect(created.maps[0]!.fitted).toHaveLength(1)
    // MapLibre keeps the terrain elevation frozen after an animation unless it is told to freeze it
    expect(created.maps[0]!.fitOptions[0]).toMatchObject({ freezeElevation: true })
  })
  it('a fit request with points fits them (one point: zooms in on it)', () => {
    const { props, rerender } = renderMap()
    const m = created.maps[0]!
    rerender(<MissionMap {...props} fitTo={{ seq: 1, points: [{ lat: 36.1, lon: 137.1 }, { lat: 36.2, lon: 137.2 }] }} />)
    expect(m.fitted).toHaveLength(1)
    rerender(<MissionMap {...props} fitTo={{ seq: 2, points: [{ lat: 35.5, lon: 139.5 }] }} />)
    expect(m.jumps.at(-1)).toEqual({ center: [139.5, 35.5], zoom: 16 })
    // the same request again does nothing
    rerender(<MissionMap {...props} fitTo={{ seq: 2, points: [{ lat: 35.5, lon: 139.5 }] }} />)
    expect(m.fitted).toHaveLength(1)
  })
  it('3D adds the terrain, the altitude path layer and shows the ground footprint instead of the 2D path', () => {
    const { rerender, props } = renderMap({ terrainTiles: 'https://dem/{z}/{x}/{y}.png', mode: '2d' })
    const m = created.maps[0]!
    expect(m.sources.has('dem')).toBe(true)
    expect(m.layers).toContain('mission-air3d')
    rerender(<MissionMap {...props} terrainTiles="https://dem/{z}/{x}/{y}.png" mode="3d" />)
    expect(m.terrain).toEqual({ source: 'dem', exaggeration: 1 })
    expect(m.visibility.get('mission-path-line')).toBe('none')
    expect(m.visibility.get('mission-foot')).toBe('visible')
  })
  it('floats the badges and the mid-leg handles rebuilt by an edit', () => {
    const { rerender, props } = renderMap({ terrainTiles: 'https://dem/{z}/{x}/{y}.png', mode: '3d' })
    const m = created.maps[0]!
    rerender(<MissionMap {...props} terrainTiles="https://dem/{z}/{x}/{y}.png" mode="3d" draft={appendWaypoint(props.draft, 36.4, 139.4)} />)
    const layer = m.layerObjs.get('mission-air3d') as { onFrame: (m: number[]) => void }
    layer.onFrame([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
    expect(handles()).toHaveLength(3)
    expect(handles().every((h) => h.offset !== null)).toBe(true)
    expect(badges().every((b) => b.offset !== null)).toBe(true)
  })

  const DEM = 'https://dem/{z}/{x}/{y}.png'
  /** A frame where one metre of altitude at item 2 is 2 px up the 800×600 screen. */
  const frame = () => {
    const k = 2 / (300 * toMercator(139.2, 36.2, 1).z)
    const layer = created.maps[0]!.layerObjs.get('mission-air3d') as { onFrame: (m: number[]) => void }
    act(() => layer.onFrame([1, 0, 0, 0, 0, 1, 0, 0, 0, k, 1, 0, 0, 0, 0, 1]))
  }
  const altDrag = (el: HTMLElement, fromY: number, toY: number) => {
    act(() => {
      el.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientY: fromY, bubbles: true }))
      window.dispatchEvent(new MouseEvent('pointermove', { clientY: toY }))
    })
  }
  it('in 3D the vehicle marker flies at its altitude and follows it as it climbs', () => {
    const v = { ...(uav as object), lat: 36.2, lon: 139.2, alt_rel: 20, alt_msl: 520 } as never
    const { props, rerender } = renderMap({ terrainTiles: DEM, mode: '3d', vehicle: v })
    const mk = () => created.markers.find((x) => x.el.querySelector('.vmk'))!
    frame()
    const low = mk().offset![1]
    expect(low).toBeLessThan(0)
    rerender(<MissionMap {...props} terrainTiles={DEM} mode="3d" vehicle={{ ...(v as object), alt_rel: 120, alt_msl: 620 } as never} />)
    frame()
    expect(mk().offset![1]).toBeCloseTo(low - 200, 0)
  })

  it('in 3D the target vehicle is a low-poly model and its disc hides', () => {
    const v = { ...(uav as object), kind: 'plane', hdg: 45, lat: 36.2, lon: 139.2, alt_rel: 20, alt_msl: 520 } as never
    const { props, rerender } = renderMap({ terrainTiles: DEM, mode: '3d', vehicle: v })
    const layer = created.maps[0]!.layerObjs.get('mission-air3d-models') as { visible: boolean; models: { model: string; hdg: number }[] }
    expect(layer.visible).toBe(true)
    expect(layer.models.map((x) => [x.model, x.hdg])).toEqual([['plane', 45]])
    const el = created.markers.find((x) => x.el.querySelector('.vmk'))!.el
    expect(el.classList.contains('model3d')).toBe(true)
    rerender(<MissionMap {...props} terrainTiles={DEM} mode="2d" vehicle={v} />)
    expect(el.classList.contains('model3d')).toBe(false)
  })

  it('in 3D a badge drags up and down to change only the altitude, previewing the chip', () => {
    const { props } = renderMap({ terrainTiles: DEM, mode: '3d' })
    frame()
    const b = badges()[1]!
    document.body.append(b.el) // MapLibre puts markers in the page; the fake does not
    expect(b.draggable).toBe(false)
    altDrag(b.el, 300, 250)
    expect(b.el.querySelector('.altc')!.textContent).toBe('75 m REL')
    act(() => {
      window.dispatchEvent(new MouseEvent('pointerup', { clientY: 250 }))
      b.el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(props.onShiftAlt).toHaveBeenCalledWith(new Set([2]), 25)
    expect(props.onSelect).not.toHaveBeenCalled()
    expect(props.onMove).not.toHaveBeenCalled()
    expect(b.el.querySelector('.altc')!.textContent).toBe('50 m REL')
  })
  it('an altitude drag on a selected badge moves the whole selection; a plain click still selects', () => {
    const { props } = renderMap({ terrainTiles: DEM, mode: '3d', selected: new Set([1, 2]) })
    frame()
    const b = badges()[1]!
    altDrag(b.el, 300, 280)
    act(() => window.dispatchEvent(new MouseEvent('pointerup', { clientY: 280 })))
    expect(props.onShiftAlt).toHaveBeenCalledWith(new Set([1, 2]), 10)
    act(() => {
      b.el.dispatchEvent(new MouseEvent('pointerdown', { button: 0, clientY: 300, bubbles: true }))
      window.dispatchEvent(new MouseEvent('pointerup', { clientY: 301 }))
      b.el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(props.onShiftAlt).toHaveBeenCalledTimes(1)
    expect(props.onSelect).toHaveBeenCalledWith(2, false, false)
  })
  it('in 3D the ground foot drags to change only the position; 2D has no feet', () => {
    const { props, rerender } = renderMap({ terrainTiles: DEM, mode: '3d' })
    expect(feet()).toHaveLength(2) // none under the TAKEOFF
    expect(feet().every((f) => f.draggable)).toBe(true)
    const f = feet()[0]!
    act(() => {
      f.fire('dragstart')
      f.setLngLat([139.25, 36.25])
      f.fire('drag')
    })
    expect(badges()[1]!.lngLat).toEqual([139.25, 36.25])
    act(() => f.fire('dragend'))
    expect(props.onMove).toHaveBeenCalledWith(2, 36.25, 139.25)
    expect(props.onShiftAlt).not.toHaveBeenCalled()
    act(() => f.el.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true })))
    expect(props.onSelect).toHaveBeenCalledWith(2, true, false)
    rerender(<MissionMap {...props} terrainTiles={DEM} mode="2d" />)
    expect(feet()).toHaveLength(0)
    expect(badges().map((b) => b.draggable)).toEqual([false, true, true])
  })

  const uav = { sysid: 1, name: 'UAV-01', kind: 'copter', mode: 'STABILIZE', armed: false, lat: 36.2509, lon: 137.6385, alt_rel: 0, alt_msl: 1505, hdg: 0, ground_speed: 0, climb: 0, battery: { pct: 90, volt: 16, current: null }, link: 'ok', last_rx_ms: 0, gps: { fix: 3, sats: 10, hdop: 1 }, warn: false, unread: 0 } as never
  it('opens over the target vehicle once (with or without a mission), again when the target changes, and on a focus request', () => {
    const { props, rerender } = renderMap({ draft: emptyDraft(), vehicle: null })
    const m = created.maps[0]!
    expect(m.jumps).toHaveLength(0)
    rerender(<MissionMap {...props} vehicle={uav} />)
    expect(m.jumps).toEqual([{ center: [137.6385, 36.2509] }])
    // the vehicle moving does not drag the view along
    rerender(<MissionMap {...props} vehicle={{ ...(uav as object), lat: 36.26 } as never} />)
    expect(m.jumps).toHaveLength(1)
    rerender(<MissionMap {...props} vehicle={{ ...(uav as object), sysid: 2, lat: 35.0, lon: 138.5 } as never} />)
    expect(m.jumps.at(-1)).toEqual({ center: [138.5, 35.0] })
    rerender(<MissionMap {...props} vehicle={{ ...(uav as object), sysid: 2, lat: 35.0, lon: 138.5 } as never} focus={{ lat: 35.6812, lon: 139.7671, seq: 1 }} />)
    expect(m.jumps.at(-1)).toEqual({ center: [139.7671, 35.6812], zoom: 16 })
    created.maps = []
    renderMap({ vehicle: uav })
    expect(created.maps[0]!.jumps).toEqual([{ center: [137.6385, 36.2509] }])
  })

  it('opens over the vehicle under StrictMode too (the first map is thrown away)', () => {
    const { props } = renderMap({ draft: emptyDraft(), vehicle: null })
    created.maps = []
    render(
      <StrictMode>
        <MissionMap {...props} vehicle={uav} />
      </StrictMode>,
    )
    expect(created.maps.at(-1)!.jumps).toEqual([{ center: [137.6385, 36.2509] }])
  })

  it('keeps its feet under StrictMode when it mounts in 3D', () => {
    const { props } = renderMap()
    created.markers = []
    render(
      <StrictMode>
        <MissionMap {...props} terrainTiles={DEM} mode="3d" />
      </StrictMode>,
    )
    expect(feet()).toHaveLength(2) // every item but the TAKEOFF
  })

  // MapLibre fires dragstart only after its first move has already moved the marker.
  it('a multi foot drag moves the selection by the whole pointer travel (MapLibre moves before dragstart)', () => {
    const { props } = renderMap({ terrainTiles: DEM, mode: '3d', selected: new Set([1, 2]) })
    const f = feet()[0]!
    act(() => {
      f.setLngLat([139.21, 36.21])
      f.fire('dragstart')
      f.setLngLat([139.25, 36.25])
      f.fire('drag')
    })
    expect(badges()[1]!.lngLat[0]).toBeCloseTo(139.25, 9)
    act(() => f.fire('dragend'))
    expect(props.onMoveSelected).toHaveBeenCalledWith(expect.closeTo(0.05, 9), expect.closeTo(0.05, 9))
  })
  it('a multi badge drag in 2D also counts from the item, not from the first move', () => {
    const { props } = renderMap({ selected: new Set([1, 2]) })
    const b = badges()[1]!
    act(() => {
      b.setLngLat([139.21, 36.21])
      b.fire('dragstart')
      b.setLngLat([139.25, 36.25])
      b.fire('dragend')
    })
    expect(props.onMoveSelected).toHaveBeenCalledWith(expect.closeTo(0.05, 9), expect.closeTo(0.05, 9))
  })
  it('a foot drag cut short (item deleted, or 2D) drops its preview', () => {
    const { props, rerender } = renderMap({ terrainTiles: DEM, mode: '3d', selected: new Set([1, 2]) })
    const f = feet()[0]!
    act(() => {
      f.fire('dragstart')
      f.setLngLat([139.25, 36.25])
      f.fire('drag')
    })
    // the takeoff (item 1) stays put: only item 2 moves with its foot
    expect(badges()[0]!.lngLat[0]).toBeCloseTo(139.1, 9)
    expect(badges()[1]!.lngLat[0]).toBeCloseTo(139.25, 9)
    rerender(<MissionMap {...props} terrainTiles={DEM} mode="3d" selected={new Set([1])} draft={removeItems(props.draft, new Set([2]))} />)
    expect(badges()[0]!.lngLat).toEqual([139.1, 36.1])
    const g = feet()[0]!
    act(() => {
      g.fire('dragstart')
      g.setLngLat([139.15, 36.15])
      g.fire('drag')
    })
    rerender(<MissionMap {...props} terrainTiles={DEM} mode="2d" selected={new Set([1])} draft={removeItems(props.draft, new Set([2]))} />)
    expect(badges()[0]!.lngLat).toEqual([139.1, 36.1])
  })
  it('a cancelled altitude drag reverts; another pointer cannot drive or end it', () => {
    const { props } = renderMap({ terrainTiles: DEM, mode: '3d' })
    frame()
    const b = badges()[1]!
    const ev = (type: string, y: number, id: number) => Object.assign(new MouseEvent(type, { button: 0, clientY: y, bubbles: true }), { pointerId: id })
    act(() => {
      b.el.dispatchEvent(ev('pointerdown', 300, 1))
      window.dispatchEvent(ev('pointermove', 250, 1))
      window.dispatchEvent(ev('pointermove', 100, 2))
      window.dispatchEvent(ev('pointerup', 100, 2))
    })
    expect(b.el.querySelector('.altc')!.textContent).toBe('75 m REL')
    act(() => window.dispatchEvent(ev('pointercancel', 250, 1)))
    expect(b.el.querySelector('.altc')!.textContent).toBe('50 m REL')
    expect(props.onShiftAlt).not.toHaveBeenCalled()
  })
  it('a touch on a 3D badge does not pan the map', () => {
    renderMap({ terrainTiles: DEM, mode: '3d' })
    const t = new Event('touchstart', { bubbles: true, cancelable: true })
    badges()[1]!.el.dispatchEvent(t)
    expect(t.defaultPrevented).toBe(true)
  })

  it('the click that ends an altitude drag off the badge never reaches the map (no new WP)', async () => {
    const { container } = renderMap({ terrainTiles: DEM, mode: '3d' })
    frame()
    const mapEl = container.querySelector('[data-testid="mission-map"]')!
    const onMapClick = vi.fn()
    mapEl.addEventListener('click', onMapClick)
    altDrag(badges()[1]!.el, 300, 250)
    act(() => {
      window.dispatchEvent(new MouseEvent('pointerup', { clientY: 250 }))
      mapEl.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(onMapClick).not.toHaveBeenCalled()
    await new Promise((r) => setTimeout(r, 0))
    mapEl.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    expect(onMapClick).toHaveBeenCalledTimes(1)
  })

  it('shift-drag on the map draws a box and selects the badges inside it (not a pan, no click)', () => {
    const { props, container } = renderMap()
    const mapEl = container.querySelector('[data-testid="mission-map"]') as HTMLElement
    badges().forEach((b, i) => {
      const dot = b.el.querySelector('.dot') as HTMLElement
      dot.getBoundingClientRect = () => ({ left: 100 * (i + 1) - 10, top: 90, width: 20, height: 20, right: 100 * (i + 1) + 10, bottom: 110, x: 0, y: 0, toJSON: () => ({}) })
    })
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true, shiftKey: true, button: 0, clientX: 50, clientY: 50 })
    mapEl.dispatchEvent(down)
    expect(down.defaultPrevented).toBe(true)
    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 250, clientY: 150 }))
    })
    expect(mapEl.querySelector('.box-select')).not.toBeNull()
    const onMapClick = vi.fn()
    mapEl.addEventListener('click', onMapClick)
    act(() => {
      window.dispatchEvent(new MouseEvent('mouseup', { clientX: 250, clientY: 150 }))
      mapEl.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(props.onBoxSelect).toHaveBeenCalledWith([1, 2])
    expect(mapEl.querySelector('.box-select')).toBeNull()
    expect(onMapClick).not.toHaveBeenCalled()
  })
  it('box select is a mission-tab tool (fence / rally leave the waypoints alone)', () => {
    const { props, container } = renderMap({ tab: 'fence' })
    const mapEl = container.querySelector('[data-testid="mission-map"]') as HTMLElement
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true, shiftKey: true, button: 0, clientX: 50, clientY: 50 })
    mapEl.dispatchEvent(down)
    expect(down.defaultPrevented).toBe(false)
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 250, clientY: 150 }))
    window.dispatchEvent(new MouseEvent('mouseup', { clientX: 250, clientY: 150 }))
    expect(props.onBoxSelect).not.toHaveBeenCalled()
  })
  it('a plain drag (no Shift) is left to the map', () => {
    const { props, container } = renderMap()
    const mapEl = container.querySelector('[data-testid="mission-map"]') as HTMLElement
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, clientX: 50, clientY: 50 })
    mapEl.dispatchEvent(down)
    expect(down.defaultPrevented).toBe(false)
    window.dispatchEvent(new MouseEvent('mouseup', { clientX: 250, clientY: 150 }))
    expect(props.onBoxSelect).not.toHaveBeenCalled()
  })

  describe('the + between two waypoints', () => {
    const pdown = (el: HTMLElement, x: number, y: number) => el.dispatchEvent(Object.assign(new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y }), { pointerId: 1 }))
    const pmove = (x: number, y: number) => window.dispatchEvent(Object.assign(new MouseEvent('pointermove', { clientX: x, clientY: y }), { pointerId: 1 }))
    const pup = (x: number, y: number) => window.dispatchEvent(Object.assign(new MouseEvent('pointerup', { clientX: x, clientY: y }), { pointerId: 1 }))
    it('a touch on the + does not pan the map', () => {
      renderMap()
      const t = new Event('touchstart', { bubbles: true, cancelable: true })
      handles()[0]!.el.dispatchEvent(t)
      expect(t.defaultPrevented).toBe(true)
    })
    it('a short click still inserts a waypoint', () => {
      const { props } = renderMap()
      const h = handles()[0]!.el
      act(() => {
        pdown(h, 10, 10)
        pup(10, 10)
        h.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
      expect(props.onInsertAfter).toHaveBeenCalledTimes(1)
      expect(props.onArc).not.toHaveBeenCalled()
    })
    it('a long press released without moving changes nothing (no arc, no insert)', () => {
      vi.useFakeTimers()
      const { props } = renderMap()
      const h = handles()[0]!.el
      document.body.append(h)
      act(() => pdown(h, 10, 10))
      act(() => vi.advanceTimersByTime(600))
      act(() => {
        pup(10, 10)
        h.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
      vi.useRealTimers()
      expect(props.onArc).not.toHaveBeenCalled()
      expect(props.onInsertAfter).not.toHaveBeenCalled()
    })
    it('a long press then drag bends the leg into an arc through the pointer (no insert)', () => {
      vi.useFakeTimers()
      // leg 2 → 3 runs north-east from (139.2, 36.2) to (139.3, 36.3); its + is at (139.25, 36.25)
      const { props } = renderMap({ draft: appendWaypoint(appendWaypoint(appendWaypoint(emptyDraft(), 36.1, 139.1), 36.2, 139.2), 36.3, 139.3) })
      const h = handles()[1]!.el
      document.body.append(h) // MapLibre puts markers in the page; the fake does not
      act(() => pdown(h, 2500, -2500))
      act(() => vi.advanceTimersByTime(600))
      expect(h.classList.contains('arc-armed')).toBe(true)
      // pointer at (139.24, 36.26): to the left (north-west) of the north-east chord → clockwise (+)
      act(() => pmove(2400, -2600))
      act(() => {
        pup(2400, -2600)
        h.dispatchEvent(new MouseEvent('click', { bubbles: true }))
      })
      vi.useRealTimers()
      expect(props.onArc).toHaveBeenCalledTimes(1)
      const [uid, angle] = (props.onArc as ReturnType<typeof vi.fn>).mock.calls[0]!
      expect(uid).toBe(3)
      expect(angle).toBeGreaterThan(0)
      expect(props.onInsertAfter).not.toHaveBeenCalled()
    })
  })

  describe('fence and rally', () => {
    const withPlan = () => {
      const d = draft3()
      return {
        ...d,
        mission: {
          ...d.mission,
          fence: [
            { kind: 'polygon' as const, inclusion: true, vertices: [{ lat: 36.0, lon: 139.0 }, { lat: 36.0, lon: 139.5 }, { lat: 36.5, lon: 139.5 }] },
            { kind: 'circle' as const, inclusion: false, center: { lat: 36.2, lon: 139.2 }, radius: 200 },
          ],
          rally: [{ lat: 36.15, lon: 139.15, alt: 60 }],
        },
      }
    }
    const fenceData = () => created.maps[0]!.sources.get('plan-fence')!.setData.mock.calls.at(-1)![0] as { features: { properties: { inc: number }; geometry: { type: string } }[] }
    const vertexPts = () => created.markers.filter((m) => m.el.classList.contains('rg-fence-pt') && !m.removed)
    const rallyPts = () => created.markers.filter((m) => m.el.classList.contains('rg-rally') && !m.removed)
    it('draws inclusion (green) and exclusion (red) zones and the rally points in every tab', () => {
      renderMap({ draft: withPlan(), tab: 'mission' })
      const fc = fenceData()
      expect(fc.features.map((f) => [f.geometry.type, f.properties.inc])).toEqual([
        ['Polygon', 1],
        ['Polygon', 0],
      ])
      expect(rallyPts()).toHaveLength(1)
      expect(rallyPts()[0]!.draggable).toBe(false)
      expect(vertexPts()).toHaveLength(0)
    })
    it('in the fence tab the vertices and circle handles drag; map clicks go to the plan, not the waypoints', () => {
      const { props } = renderMap({ draft: withPlan(), tab: 'fence' })
      // 3 vertices + circle centre + radius handle
      expect(vertexPts()).toHaveLength(5)
      const v = vertexPts()[1]!
      act(() => {
        v.setLngLat([139.6, 36.05])
        v.fire('dragend')
      })
      expect(props.onFenceEdit).toHaveBeenCalledWith({ kind: 'vertex', zone: 0, index: 1, lat: 36.05, lon: 139.6 })
      act(() => created.maps[0]!.fire('click', { lngLat: { lat: 36.3, lng: 139.3 }, originalEvent: {} }))
      expect(props.onPlanClick).toHaveBeenCalledWith('fence', 36.3, 139.3)
      expect(props.onAdd).not.toHaveBeenCalled()
      expect(badges().every((b) => !b.draggable)).toBe(true)
    })
    it('in the rally tab rally points drag and map clicks add', () => {
      const { props } = renderMap({ draft: withPlan(), tab: 'rally' })
      const r = rallyPts()[0]!
      expect(r.draggable).toBe(true)
      act(() => {
        r.setLngLat([139.16, 36.16])
        r.fire('dragend')
      })
      expect(props.onRallyMove).toHaveBeenCalledWith(0, 36.16, 139.16)
      act(() => created.maps[0]!.fire('click', { lngLat: { lat: 36.3, lng: 139.3 }, originalEvent: {} }))
      expect(props.onPlanClick).toHaveBeenCalledWith('rally', 36.3, 139.3)
    })
  })

  it('the_active_path_uses_its_row_colour', () => {
    const { rerender, props } = renderMap({ pathColor: '#ff4d79' })
    const map = created.maps[0]!
    const line = map.layerObjs.get('mission-path-line') as { paint: Record<string, unknown> }
    expect(line.paint['line-color']).toBe('#ff4d79')
    rerender(<MissionMap {...props} pathColor="#31d848" />)
    expect(map.paint.get('mission-path-line.line-color')).toBe('#31d848')
    // back to one mission: the altitude gradient again
    rerender(<MissionMap {...props} pathColor={undefined} />)
    expect(map.paint.get('mission-path-line.line-color')).toEqual(expect.arrayContaining(['interpolate']))
    // 3D: the level legs take the row colour (steep climbs still turn red)
    const level = appendWaypoint(appendWaypoint(emptyDraft(), 36.1, 139.1), 36.2, 139.2)
    const air = missionAirData(level, new Set(), () => 100, null, null, null, '#31d848')
    const rgb = [0x31 / 255, 0xd8 / 255, 0x48 / 255]
    for (const v of air.lines.flat()) v.c.forEach((c, i) => expect(c).toBeCloseTo(rgb[i]!, 5))
    expect(air.lines.flat().length).toBeGreaterThan(0)
  })

  describe('plans overlay', () => {
    const brLayers = ['plans-fence', 'plans-fence-line', 'plans-paths', 'plans-predicted', 'plans-rally']
    const other = { key: 'r2', color: '#5fd39b', draft: draft3(), predicted: null }
    const labels = () => created.markers.filter((m) => m.el.classList.contains('plans-label') && !m.removed)

    it('a_single_plan_adds_no_other_plan_layers', () => {
      renderMap()
      expect(created.maps[0]!.layers.filter((id) => id.startsWith('plans'))).toEqual([])
    })

    it('other_missions_are_drawn_below_the_active_mission_without_click_handlers', () => {
      renderMap({ others: [other] })
      const map = created.maps[0]!
      expect(map.layers.filter((id) => id.startsWith('plans'))).toEqual(brLayers)
      for (const id of brLayers) expect(['plan-fence-fill', 'mission-path-casing']).toContain(map.before.get(id))
      expect(map.sources.get('plans-paths')!.setData).toHaveBeenLastCalledWith(expect.objectContaining({ features: expect.arrayContaining([expect.objectContaining({ properties: expect.objectContaining({ color: '#5fd39b' }) })]) }))
      expect(map.handlers.get('click')).toHaveLength(1)
    })

    it('no_crossing_labels_are_drawn', () => {
      // two missions crossing at the same altitude: only their colours tell them apart
      const ew = appendWaypoint(appendWaypoint(emptyDraft(), 36.2, 139.1), 36.2, 139.3)
      const ns = appendWaypoint(appendWaypoint(emptyDraft(), 36.1, 139.2), 36.3, 139.2)
      const ui = (d: typeof ew, id: number) => ({ ...INITIAL_MISSION_UI, savedId: id, history: { ...INITIAL_MISSION_UI.history, present: d } })
      const ws = addRow(addRow(emptyWorkspace(), ui(ew, 1)), ui(ns, 2))
      const bm = planSetMapOf(ws)
      expect(bm).not.toHaveProperty('labels')
      renderMap({ draft: activeRow(ws).ui.history.present, ...bm })
      expect(created.maps[0]!.layers.filter((id) => id.startsWith('plans'))).toEqual(brLayers)
      expect(labels()).toHaveLength(0)
      expect(document.querySelector('.plans-label')).toBeNull()
    })
  })
})

describe('MissionMap survey drawing', () => {
  beforeEach(() => {
    created.maps = []
    created.markers = []
    created.deferLoad = false
  })

  it('routes map clicks to the drawing instead of adding a waypoint, and draws the ring', () => {
    const onClick = vi.fn()
    const onClose = vi.fn()
    const ring = [
      { lat: 36, lon: 139 },
      { lat: 36, lon: 139.01 },
      { lat: 36.01, lon: 139.01 },
    ]
    const { props, rerender } = renderMap({ surveyDraw: { ring, onClick, onClose } })
    const map = created.maps[0]!
    act(() => map.fire('click', { lngLat: { lat: 36.5, lng: 139.5 } }))
    expect(onClick).toHaveBeenCalledWith(36.5, 139.5)
    expect(props.onAdd).not.toHaveBeenCalled()
    expect(map.layers.filter((id) => id.startsWith('survey-draw-')).length).toBeGreaterThan(0)
    const data = map.sources.get('survey-draw')!.setData.mock.calls.at(-1)![0] as { features: { geometry: { type: string } }[] }
    expect(data.features.map((f) => f.geometry.type)).toContain('LineString')
    // the first vertex closes the ring
    const first = created.markers.find((m) => m.el.classList.contains('sv-draw-close') && !m.removed)!
    first.el.click()
    expect(onClose).toHaveBeenCalled()
    rerender(<MissionMap {...props} surveyDraw={null} />)
    const cleared = map.sources.get('survey-draw')!.setData.mock.calls.at(-1)![0] as { features: unknown[] }
    expect(cleared.features).toEqual([])
    expect(created.markers.filter((m) => m.el.classList.contains('sv-draw-close') && !m.removed)).toHaveLength(0)
  })

  it('while drawing every vertex is a draggable handle: a drag moves it, a click on it adds no vertex', () => {
    const onClick = vi.fn()
    const onClose = vi.fn()
    const onMove = vi.fn()
    const ring = [
      { lat: 36, lon: 139 },
      { lat: 36, lon: 139.01 },
      { lat: 36.01, lon: 139.01 },
    ]
    renderMap({ surveyDraw: { ring, onClick, onClose, onMove } })
    const vtx = created.markers.filter((m) => m.el.classList.contains('sv-vtx') && !m.removed)
    expect(vtx).toHaveLength(3)
    expect(vtx.every((m) => m.draggable)).toBe(true)
    vtx[1]!.setLngLat([139.02, 36.005])
    act(() => vtx[1]!.fire('drag'))
    expect(onMove).toHaveBeenLastCalledWith(1, 36.005, 139.02)
    act(() => vtx[1]!.el.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(onClick).not.toHaveBeenCalled()
    expect(onClose).not.toHaveBeenCalled()
    // the first one still closes the ring when clicked
    act(() => vtx[0]!.el.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(onClose).toHaveBeenCalled()
  })

  it('while drawing: no mid-leg handles, a badge click is a vertex at the waypoint, badges do not drag, no box select', () => {
    const onClick = vi.fn()
    const { props, container } = renderMap({ tool: 'add', surveyDraw: { ring: [], onClick, onClose: vi.fn() } })
    expect(handles()).toHaveLength(0)
    const b = badges()[1]!
    expect(b.draggable).toBe(false)
    act(() => b.el.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(onClick).toHaveBeenCalledWith(36.2, 139.2)
    expect(props.onSelect).not.toHaveBeenCalled()
    expect(props.onInsertAfter).not.toHaveBeenCalled()
    expect(props.onAdd).not.toHaveBeenCalled()
    const mapEl = container.querySelector('[data-testid="mission-map"]') as HTMLElement
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true, shiftKey: true, button: 0, clientX: 50, clientY: 50 })
    mapEl.dispatchEvent(down)
    expect(down.defaultPrevented).toBe(false)
  })

  it('handles come back when the drawing ends', () => {
    const { props, rerender } = renderMap({ surveyDraw: { ring: [], onClick: vi.fn(), onClose: vi.fn() } })
    expect(handles()).toHaveLength(0)
    rerender(<MissionMap {...props} surveyDraw={null} />)
    expect(handles()).toHaveLength(2)
    expect(badges()[1]!.draggable).toBe(true)
  })

  it('adds no survey layers until a drawing starts', () => {
    renderMap()
    expect(created.maps[0]!.layers.some((id) => id.startsWith('survey-draw-'))).toBe(false)
  })
})

describe('MissionMap survey preview', () => {
  beforeEach(() => {
    created.maps = []
    created.markers = []
    created.deferLoad = false
  })
  const mids = () => created.markers.filter((m) => m.el.classList.contains('rg-mid')).length

  it('while a survey drag previews: no mid-leg handles, none rebuilt per frame, the predicted line stays on the last committed draft', () => {
    const predict = vi.fn(() => null)
    const survey = { metrics: () => null, onPolygon: vi.fn(), onAngle: vi.fn(), onCancel: vi.fn(), showFootprints: false, previewing: false }
    const { props, rerender } = renderMap({ predict, survey })
    expect(handles()).toHaveLength(2)
    const calls = predict.mock.calls.length
    const frame1 = appendWaypoint(props.draft, 36.4, 139.4)
    const frame2 = appendWaypoint(frame1, 36.5, 139.5)
    rerender(<MissionMap {...props} predict={predict} survey={{ ...survey, previewing: true }} draft={frame1} />)
    expect(handles()).toHaveLength(0)
    rerender(<MissionMap {...props} predict={predict} survey={{ ...survey, previewing: true }} draft={frame2} />)
    expect(mids()).toBe(2)
    expect(predict).toHaveBeenCalledTimes(calls)
    rerender(<MissionMap {...props} predict={predict} survey={survey} draft={frame2} />)
    expect(handles()).toHaveLength(4)
    expect(predict).toHaveBeenCalledTimes(calls + 1)
  })

  it('draws a plugin overlay right above the base map and below the mission path', async () => {
    vi.stubGlobal('fetch', vi.fn(overlayFetch()))
    // the shared plugin list may have been read (empty) by an earlier test
    await pluginsStore().reload()
    overlayPrefsStore().toggle('carrier/lte', 60)
    try {
      renderMap()
      const m = created.maps.at(-1)!
      await waitFor(() => expect(m.layers).toContain('ov/carrier/lte'))
      expect(m.before.get('ov/carrier/lte')).toBe('mission-path-casing')
    } finally {
      overlayPrefsStore().toggle('carrier/lte', 60)
      vi.unstubAllGlobals()
    }
  })
})
