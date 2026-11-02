// 3D with a long plan and a moving vehicle: a telemetry update floats only the
// vehicle, a frame with an unchanged camera re-floats nothing of the plan, and no float asks MapLibre
// to project (a terrain lookup per marker) — the ground comes from the DEM sampler instead.
import { act, render } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { FakeMap, FakeMarker, created } from '../../test/fakeMaplibre'

vi.mock('maplibre-gl', async () => (await import('../../test/fakeMaplibre')).maplibreModule)
vi.mock('../map/terrain', async (orig) => ({
  ...(await orig<typeof import('../map/terrain')>()),
  TerrainSampler: class {
    readonly elevAt = () => 100
  },
}))

const { MissionMap } = await import('./MissionMap')
const { appendWaypoint, emptyDraft } = await import('./model')
const { rasterStyle } = await import('../map/style')

const DEM = 'https://dem/{z}/{x}/{y}.png'
const MATRIX = [1, 0, 0, 0, 0, 1, 0, 0, 0, 3, 1, 0, 0, 0, 0, 1]
/** A flying vehicle (it has a home) moving north. */
const uav = (k: number) =>
  ({ sysid: 1, name: 'UAV-01', kind: 'plane', mode: 'AUTO', armed: true, lat: 36.2 + k * 1e-4, lon: 139.2, alt_rel: 80, alt_msl: 180, hdg: 0, ground_speed: 18, climb: 0, battery: { pct: 90, volt: 16, current: null }, link: 'ok', last_rx_ms: 0, gps: { fix: 3, sats: 10, hdop: 1 }, warn: false, unread: 0, home: { lat: 36.1, lon: 139.1, alt: 100 } }) as never

function longPlan(n: number) {
  let d = emptyDraft()
  for (let i = 0; i < n; i++) d = appendWaypoint(d, 36.1 + (i % 20) * 1e-3, 139.1 + Math.floor(i / 20) * 1e-3)
  return d
}

describe('MissionMap 3D with ~300 items and a vehicle at 10 Hz', () => {
  beforeEach(() => {
    created.maps = []
    created.markers = []
    created.deferLoad = false
  })

  it('per telemetry tick: no MapLibre project calls, only the vehicle marker moves', () => {
    const noop = vi.fn()
    const props = {
      draft: longPlan(300), selected: new Set<number>(), tool: 'add' as const, style: rasterStyle('https://t/{z}/{x}/{y}.png', 'x'), fitRequest: 0, terrainTiles: DEM, mode: '3d' as const,
      onAdd: noop, onInsertAfter: noop, onMove: noop, onMoveSelected: noop, onShiftAlt: noop, onBoxSelect: noop, onArc: noop,
      onPlanClick: noop, onFenceEdit: noop, onRallyMove: noop, onSelect: noop, onBackgroundClick: noop, onContext: noop,
    }
    const { rerender } = render(<MissionMap {...props} vehicle={uav(0)} />)
    const layer = created.maps[0]!.layerObjs.get('mission-air3d') as { onFrame: (m: number[]) => void }
    act(() => layer.onFrame([...MATRIX]))
    const project = vi.spyOn(FakeMap.prototype, 'project')
    const setOffset = vi.spyOn(FakeMarker.prototype, 'setOffset')
    for (let k = 1; k <= 10; k++) {
      rerender(<MissionMap {...props} vehicle={uav(k)} />)
      act(() => layer.onFrame([...MATRIX]))
    }
    expect(project).not.toHaveBeenCalled()
    const moved = new Set(setOffset.mock.contexts.map((m) => (m as FakeMarker).el.className))
    expect([...moved].every((c) => !c.includes('rg-wp') && !c.includes('rg-mid'))).toBe(true)
    expect(setOffset.mock.calls.length).toBeLessThanOrEqual(20)
  })
})
