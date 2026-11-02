import { describe, expect, it } from 'vitest'
import { applyBasemap } from '../map/basemaps'
import { orderLayers } from '../map/layers'
import { addOverlay, areaBounds, areaVersion, layerId, noticeDates, overlayLayers, removeOverlay, setOverlayOpacity, type LayerSpec } from './layer'
import { area, stack } from './testData'

const spec = (p: Partial<LayerSpec> = {}): LayerSpec => ({ id: layerId('carrier/lte'), tiles: '/t/{z}/{x}/{y}.gif', tileSize: 256, minzoom: 8, maxzoom: 14, bounds: [135.85, 33.6, 135.95, 33.7], attribution: '', ...p })

describe('area bounds and dates', () => {
  it('bounds_are_the_union_of_the_areas_with_fetched_tiles', () => {
    const areas = [area(), area({ id: 2, south: 33.5, west: 136, north: 33.65, east: 136.1, status: 'partial' }), area({ id: 3, south: 10, west: 10, north: 11, east: 11, status: 'failed' }), area({ id: 4, south: 0, west: 0, north: 1, east: 1, status: 'fetching', fetched_at: null })]
    expect(areaBounds(areas)).toEqual([135.85, 33.5, 136.1, 33.7])
  })

  it('a_refetch_keeps_the_tiles_already_fetched_on_the_map', () => {
    expect(areaBounds([area({ status: 'fetching' })])).toEqual([135.85, 33.6, 135.95, 33.7])
  })

  it('no_fetched_area_means_no_bounds', () => {
    expect(areaBounds([])).toBeNull()
    expect(areaBounds([area({ status: 'idle', fetched_at: null }), area({ status: 'failed' })])).toBeNull()
  })

  it('the_version_changes_when_a_fetch_completes', () => {
    const a = areaVersion([area()])
    expect(areaVersion([area()])).toBe(a)
    expect(areaVersion([area({ fetched_at: Date.UTC(2026, 9, 31, 4) })])).not.toBe(a)
  })

  it('notice_dates_are_the_newest_fetch_and_the_newest_data_date', () => {
    const areas = [area(), area({ id: 2, fetched_at: Date.UTC(2026, 9, 20, 3), data_modified: Date.UTC(2026, 9, 5, 3) })]
    expect(noticeDates(areas)).toEqual({ fetched: '2026-10-31', data: '2026-10-05' })
    expect(noticeDates([area({ data_modified: null })])).toEqual({ fetched: '2026-10-31', data: null })
    expect(noticeDates([area({ status: 'failed' })])).toBeNull()
  })
})

describe('overlay layers', () => {
  it('layer_ids_are_unique_per_plugin_and_overlay', () => {
    expect(layerId('carrier/lte')).toBe('ov/carrier/lte')
    expect(layerId('a-b/c')).not.toBe(layerId('a/b-c'))
  })

  it('goes_above_the_base_map_and_its_labels_and_below_every_app_layer', () => {
    const m = stack(['base', 'labels', 'mission-path-casing', 'mission-path-line', 'tracks-others'])
    addOverlay(m, spec(), 60)
    const id = layerId('carrier/lte')
    expect(m.layers).toEqual(['base', 'labels', id, 'mission-path-casing', 'mission-path-line', 'tracks-others'])
    expect(m.sources.get(id)).toEqual({ type: 'raster', tiles: ['/t/{z}/{x}/{y}.gif'], tileSize: 256, minzoom: 8, maxzoom: 14, bounds: [135.85, 33.6, 135.95, 33.7] })
    // below min_zoom the tiles would only show as a coarse blur: hidden there
    expect(m.layerObjs.get(id)).toMatchObject({ type: 'raster', source: id, minzoom: 8, paint: { 'raster-opacity': 0.6 } })
  })

  it('overlays_keep_their_id_order_inside_the_band_whatever_order_they_come_in', () => {
    const m = stack(['base', 'mission-path-line'])
    addOverlay(m, spec({ id: layerId('sea/marks') }), 60)
    addOverlay(m, spec({ id: layerId('carrier/lte') }), 60)
    expect(m.layers).toEqual(['base', 'ov/carrier/lte', 'ov/sea/marks', 'mission-path-line'])
    expect(overlayLayers(m)).toEqual(['ov/carrier/lte', 'ov/sea/marks'])
  })

  it('a_direct_overlay_has_no_bounds_and_carries_its_attribution', () => {
    const m = stack(['base'])
    addOverlay(m, spec({ tiles: 'https://x.example/{z}/{x}/{y}.png', bounds: null, attribution: '© OpenSeaMap' }), 100)
    expect(m.sources.get(layerId('carrier/lte'))).toEqual({ type: 'raster', tiles: ['https://x.example/{z}/{x}/{y}.png'], tileSize: 256, minzoom: 8, maxzoom: 14, attribution: '© OpenSeaMap' })
  })

  it('stays_below_the_app_layers_after_a_restack_and_a_base_map_swap', () => {
    const m = stack(['base', 'mission-path-line', 'tracks-others', 'sight'])
    addOverlay(m, spec(), 60)
    orderLayers(m)
    applyBasemap(m, { id: 'sat', label: 'sat', tiles: ['x'], attribution: '', max_zoom: 18, overlay: ['y'] })
    expect(m.layers.slice(0, 3)).toEqual(['base', 'labels', layerId('carrier/lte')])
  })

  it('removes_cleanly_and_twice', () => {
    const m = stack(['base', 'mission-path-line'])
    addOverlay(m, spec(), 60)
    removeOverlay(m, layerId('carrier/lte'))
    removeOverlay(m, layerId('carrier/lte'))
    expect(m.layers).toEqual(['base', 'mission-path-line'])
    expect(m.sources.size).toBe(0)
  })

  it('opacity_goes_to_the_raster_paint_only_when_the_layer_exists', () => {
    const m = stack(['base'])
    const id = layerId('carrier/lte')
    setOverlayOpacity(m, id, 30)
    expect(m.paint.size).toBe(0)
    addOverlay(m, spec(), 60)
    setOverlayOpacity(m, id, 30)
    expect(m.paint.get(`${id}.raster-opacity`)).toBe(0.3)
  })
})
