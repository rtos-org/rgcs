// Test helpers: plugin and area rows (the Nachikatsuura check rectangle, fetched 2026-10-31) and a style stack.
import type { OverlayArea, OverlayInfo, PluginInfo } from '../../shared/api/types'

export const area = (p: Partial<OverlayArea> = {}): OverlayArea => ({ id: 1, plugin_id: 'carrier', overlay_id: 'lte', name: 'Nachi', south: 33.6, west: 135.85, north: 33.7, east: 135.95, status: 'ready', tiles_total: 10, tiles_ok: 10, tiles_failed: 0, fetched_at: Date.UTC(2026, 9, 31, 3), data_modified: Date.UTC(2026, 9, 1, 3), last_error: null, created_at: 0, ...p })

export const overlay = (p: Partial<OverlayInfo> = {}): OverlayInfo => ({ id: 'lte', name: { en: 'LTE area', ja: 'LTE エリア' }, cache: 'area', format: 'gif', tile_size: 256, min_zoom: 8, max_zoom: 14, default_opacity: 60, attribution: null, notice: { en: 'No guarantee in the air', ja: '上空通信の保証なし' }, legend: [], tiles: null, ...p })

export const plugin = (p: Partial<PluginInfo> = {}): PluginInfo => ({ id: 'carrier', status: 'ok', error: null, enabled: true, version: '1.0', name: { en: 'Carrier', ja: 'キャリア' }, description: null, author: null, homepage: null, overlays: [overlay()], links: [], ...p })

/** A `direct` overlay (the browser loads the tiles itself). */
export const seaMarks = (): PluginInfo =>
  plugin({ id: 'sea', name: { en: 'Sea marks' }, overlays: [overlay({ id: 'marks', name: { en: 'Sea marks', ja: '海図標識' }, cache: 'direct', format: 'png', min_zoom: 9, max_zoom: 18, notice: null, tiles: 'https://tiles.example.org/{z}/{x}/{y}.png', attribution: { en: '© OpenSeaMap' } })], links: [{ label: { en: 'Chart', ja: '海図' }, url: 'https://chart.example.org/' }] })

/** A style stack like MapLibre's: `addLayer(l, before)` inserts below `before`, `moveLayer(id)` moves to the top. */
export function stack(ids: string[]) {
  const s = {
    layers: [...ids],
    sources: new Map<string, unknown>(),
    layerObjs: new Map<string, unknown>(),
    paint: new Map<string, unknown>(),
    getStyle: () => ({ layers: s.layers.map((id) => ({ id })) }),
    getLayer: (id: string) => (s.layers.includes(id) ? { id } : undefined),
    getSource: (id: string) => s.sources.get(id),
    addSource: (id: string, src: unknown) => void s.sources.set(id, src),
    removeSource: (id: string) => void s.sources.delete(id),
    addLayer: (l: { id: string }, before?: string) => {
      s.layerObjs.set(l.id, l)
      if (before && s.layers.includes(before)) s.layers.splice(s.layers.indexOf(before), 0, l.id)
      else s.layers.push(l.id)
    },
    removeLayer: (id: string) => void (s.layers = s.layers.filter((x) => x !== id)),
    moveLayer: (id: string) => void (s.layers = [...s.layers.filter((x) => x !== id), id]),
    setPaintProperty: (id: string, k: string, v: unknown) => void s.paint.set(`${id}.${k}`, v),
  }
  return s
}

/** A `fetch` stub for the maps: the plugin list holds `plugin()`, every area list `area()`. */
export function overlayFetch(): typeof fetch {
  return async (input) => {
    const data = String(input).endsWith('/api/plugins') ? [plugin()] : [area()]
    return new Response(JSON.stringify({ success: true, data }))
  }
}
