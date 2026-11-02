import { act, render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { VehicleState } from '../../shared/api/types'
import { created } from '../../test/fakeMaplibre'

vi.mock('maplibre-gl', async () => (await import('../../test/fakeMaplibre')).maplibreModule)

const { MissionMap } = await import('./MissionMap')
const { appendWaypoint, emptyDraft, toMission } = await import('./model')
const { rasterStyle } = await import('../map/style')

const style = rasterStyle('https://t/{z}/{x}/{y}.png', 'x')
const draft3 = () => appendWaypoint(appendWaypoint(appendWaypoint(emptyDraft(), 36.1, 139.1), 36.2, 139.2), 36.3, 139.3)
const live = (cls: string) => created.markers.filter((m) => m.el.classList.contains(cls) && !m.removed)
const copter: VehicleState = {
  sysid: 1, name: 'UAV-01', kind: 'copter', mode: 'STABILIZE', armed: false, lat: 36.0, lon: 139.0, alt_rel: 0, alt_msl: 0, hdg: 0,
  ground_speed: 0, climb: 0, battery: { pct: 90, volt: 24, current: null }, link: 'ok', last_rx_ms: 0, gps: { fix: 3, sats: 12, hdop: 1 }, warn: false, unread: 0,
}

function renderMap(over: Partial<React.ComponentProps<typeof MissionMap>> = {}) {
  const props = {
    draft: draft3(), selected: new Set<number>(), tool: 'add' as const, style, vehicle: null, fitRequest: 0,
    onAdd: vi.fn(), onInsertAfter: vi.fn(), onMove: vi.fn(), onMoveSelected: vi.fn(), onShiftAlt: vi.fn(), onBoxSelect: vi.fn(), onArc: vi.fn(),
    onPlanClick: vi.fn(), onFenceEdit: vi.fn(), onRallyMove: vi.fn(), onSelect: vi.fn(), onBackgroundClick: vi.fn(), onContext: vi.fn(),
    ...over,
  }
  return { ...render(<MissionMap {...props} />), props }
}

const assign = {
  plans: [{ id: 5, name: 'Plan A', mission: { ...toMission(draft3()), id: 5 } }],
  colours: new Map([[5, '#ff0000']]),
  vehicles: [copter],
  assignments: new Map([[1, { sysid: 1, plan_id: 5, assigned_by: 'admin', assigned_at: 1, written: null }]]),
  highlight: null,
}

describe('MissionMap in assign mode', () => {
  beforeEach(() => {
    created.maps = []
    created.markers = []
    created.deferLoad = false
  })

  it('assign_mode_draws_the_overlay_and_does_not_edit', () => {
    const { props } = renderMap({ assign })
    const m = created.maps[0]!
    const routes = m.sources.get('assign-routes')!
    expect((routes.setData.mock.calls.at(-1)![0] as { features: unknown[] }).features).toHaveLength(1)
    expect((m.sources.get('assign-links')!.setData.mock.calls.at(-1)![0] as { features: unknown[] }).features).toHaveLength(1)
    // the active plan's badges and handles are gone; the vehicle and the plan's name are markers
    expect(live('rg-wp')).toHaveLength(0)
    expect(live('rg-mid')).toHaveLength(0)
    expect(live('as-map-label')).toHaveLength(1)
    expect(live('rg-mk')).toHaveLength(1)
    act(() => m.fire('click', { lngLat: { lat: 36.5, lng: 139.5 }, originalEvent: {} }))
    expect(props.onAdd).not.toHaveBeenCalled()
    expect(props.onBackgroundClick).not.toHaveBeenCalled()
  })

  it('without_assign_the_overlay_is_never_added', () => {
    renderMap()
    expect(created.maps[0]!.sources.has('assign-routes')).toBe(false)
    expect(created.maps[0]!.layers.filter((id) => id.startsWith('assign-'))).toEqual([])
  })

  it('leaving_assign_mode_restores_the_editor', () => {
    const { props, rerender } = renderMap({ assign })
    rerender(<MissionMap {...props} assign={null} />)
    expect(live('rg-wp')).toHaveLength(3)
    expect(live('as-map-label')).toHaveLength(0)
    expect(live('rg-mk')).toHaveLength(0)
    act(() => created.maps[0]!.fire('click', { lngLat: { lat: 36.5, lng: 139.5 }, originalEvent: {} }))
    expect(props.onAdd).toHaveBeenCalledWith(36.5, 139.5)
  })
})
