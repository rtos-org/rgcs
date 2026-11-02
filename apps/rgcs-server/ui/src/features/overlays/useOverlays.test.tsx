import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { PluginInfo } from '../../shared/api/types'
import { AreasHub } from './areasHub'
import { layerId } from './layer'
import { viewRectOf } from './mapRegistry'
import { PluginsStore } from './plugins'
import { OverlayPrefsStore } from './prefs'
import { area, plugin, seaMarks, stack } from './testData'
import { useOverlays } from './useOverlays'

const memory = () => {
  const items: Record<string, string> = {}
  return { getItem: (k: string) => items[k] ?? null, setItem: (k: string, v: string) => void (items[k] = v) }
}
const LTE = layerId('carrier/lte')
const SEA = layerId('sea/marks')

function setup(load: () => Promise<ReturnType<typeof area>[]>, plugins: PluginInfo[] = [plugin(), seaMarks()], lang = 'ja') {
  const m = Object.assign(stack(['base', 'mission-path-line']), { once: vi.fn(), getBounds: () => ({ getSouth: () => 33.6, getWest: () => 135.8, getNorth: () => 33.7, getEast: () => 135.9 }) })
  const prefs = new OverlayPrefsStore(memory())
  const areas = new AreasHub(load)
  const list = new PluginsStore(async () => plugins)
  const hook = renderHook(() => useOverlays({ current: m }, { current: true }, 'ops', lang, { prefs, areas, plugins: list }))
  return { m, prefs, areas, list, hook }
}

describe('useOverlays', () => {
  it('adds_nothing_and_reads_no_areas_while_every_overlay_is_off', async () => {
    const load = vi.fn(async () => [area()])
    const { m, list } = setup(load)
    await waitFor(() => expect(list.getState().loaded).toBe(true))
    expect(load).not.toHaveBeenCalled()
    expect(m.layers).toEqual(['base', 'mission-path-line'])
  })

  it('switching_an_area_overlay_on_adds_its_layer_under_the_mission_path', async () => {
    const { m, prefs, list } = setup(async () => [area()])
    await waitFor(() => expect(list.getState().loaded).toBe(true))
    act(() => prefs.toggle('carrier/lte', 60))
    await waitFor(() => expect(m.layers).toEqual(['base', LTE, 'mission-path-line']))
    expect(m.sources.get(LTE)).toMatchObject({ tiles: [`/api/plugins/carrier/overlays/lte/tiles/{z}/{x}/{y}.gif?v=${Date.UTC(2026, 9, 31, 3)}`], bounds: [135.85, 33.6, 135.95, 33.7] })
    act(() => prefs.setOpacity('carrier/lte', 30, 60))
    expect(m.paint.get(`${LTE}.raster-opacity`)).toBe(0.3)
    act(() => prefs.toggle('carrier/lte', 60))
    expect(m.layers).toEqual(['base', 'mission-path-line'])
    expect(m.sources.has(LTE)).toBe(false)
  })

  it('a_direct_overlay_loads_from_its_source_with_the_attribution_and_no_area_read', async () => {
    const load = vi.fn(async () => [area()])
    const { m, prefs, list } = setup(load)
    await waitFor(() => expect(list.getState().loaded).toBe(true))
    act(() => prefs.toggle('sea/marks', 60))
    await waitFor(() => expect(m.layers).toEqual(['base', SEA, 'mission-path-line']))
    expect(m.sources.get(SEA)).toEqual({ type: 'raster', tiles: ['https://tiles.example.org/{z}/{x}/{y}.png'], tileSize: 256, minzoom: 9, maxzoom: 18, attribution: '© OpenSeaMap' })
    expect(load).not.toHaveBeenCalled()
    act(() => prefs.toggle('carrier/lte', 60))
    await waitFor(() => expect(m.layers).toEqual(['base', LTE, SEA, 'mission-path-line']))
  })

  it('a_disabled_or_broken_plugin_draws_nothing', async () => {
    const off = [plugin({ enabled: false }), seaMarks()].map((p) => (p.id === 'sea' ? { ...p, status: 'error' as const } : p))
    const { m, prefs, list } = setup(async () => [area()], off)
    await waitFor(() => expect(list.getState().loaded).toBe(true))
    act(() => {
      prefs.toggle('carrier/lte', 60)
      prefs.toggle('sea/marks', 60)
    })
    await act(async () => {})
    expect(m.layers).toEqual(['base', 'mission-path-line'])
  })

  it('no_fetched_area_adds_no_source', async () => {
    const { m, prefs, areas, list } = setup(async () => [area({ status: 'fetching', fetched_at: null })])
    await waitFor(() => expect(list.getState().loaded).toBe(true))
    act(() => prefs.toggle('carrier/lte', 60))
    await waitFor(() => expect(areas.getState()['carrier/lte']?.loaded).toBe(true))
    expect(m.sources.has(LTE)).toBe(false)
  })

  it('a_completed_fetch_renews_the_source_so_the_new_tiles_show', async () => {
    let reply = [area({ status: 'fetching', fetched_at: null })]
    const { m, prefs, areas, list } = setup(async () => reply)
    await waitFor(() => expect(list.getState().loaded).toBe(true))
    act(() => prefs.toggle('carrier/lte', 60))
    await waitFor(() => expect(areas.getState()['carrier/lte']?.loaded).toBe(true))
    const ref = { plugin: 'carrier', overlay: 'lte' }
    reply = [area({ fetched_at: 5000 })]
    await act(() => areas.reload(ref))
    expect(m.sources.get(LTE)).toMatchObject({ tiles: ['/api/plugins/carrier/overlays/lte/tiles/{z}/{x}/{y}.gif?v=5000'] })
    reply = [area({ fetched_at: 9000 })]
    await act(() => areas.reload(ref))
    expect(m.sources.get(LTE)).toMatchObject({ tiles: ['/api/plugins/carrier/overlays/lte/tiles/{z}/{x}/{y}.gif?v=9000'] })
    expect(m.layers.filter((l) => l === LTE)).toHaveLength(1)
  })

  it('a_map_error_never_escapes', async () => {
    const { m, prefs, list } = setup(async () => [area()])
    m.addLayer = () => {
      throw new Error('style not ready')
    }
    await waitFor(() => expect(list.getState().loaded).toBe(true))
    act(() => prefs.toggle('carrier/lte', 60))
    await act(async () => {})
    expect(m.layers).toEqual(['base', 'mission-path-line'])
  })

  it('registers_the_map_for_the_area_in_view', () => {
    const { hook } = setup(async () => [])
    expect(viewRectOf('ops')).toEqual({ south: 33.6, west: 135.8, north: 33.7, east: 135.9 })
    hook.unmount()
    expect(viewRectOf('ops')).toBeNull()
  })
})
