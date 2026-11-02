// Base map choice (user request 2026-10-19): the list comes from `/api/settings/app`
// (config `[[basemaps]]` or the server defaults); the pick is per browser.
import { useEffect, useRef, useSyncExternalStore, type RefObject } from 'react'
import type { RasterSourceSpecification, StyleSpecification } from 'maplibre-gl'
import type { Basemap } from '../../shared/api/types'

const KEY = 'rgcs.basemap'
const BASE_LAYERS = ['base', 'labels']

export function chooseBasemap(list: readonly Basemap[], id: string | null): Basemap {
  return list.find((b) => b.id === id) ?? list[0]!
}

function raster(tiles: readonly string[], attribution: string, maxzoom: number): RasterSourceSpecification {
  return { type: 'raster', tiles: [...tiles], tileSize: 256, attribution, maxzoom }
}

export function basemapStyle(b: Basemap): StyleSpecification {
  const sources: StyleSpecification['sources'] = { tiles: raster(b.tiles, b.attribution, b.max_zoom) }
  const layers: StyleSpecification['layers'] = [{ id: 'base', type: 'raster', source: 'tiles' }]
  if (b.overlay) {
    sources.labels = raster(b.overlay, '', b.max_zoom)
    layers.push({ id: 'labels', type: 'raster', source: 'labels' })
  }
  return { version: 8, sources, layers }
}

/** The parts of a MapLibre map the swap uses (a fake in tests). */
export interface BaseLayerHost {
  getStyle(): { layers?: readonly { id: string }[] } | undefined
  getLayer(id: string): unknown
  getSource(id: string): unknown
  removeLayer(id: string): unknown
  removeSource(id: string): unknown
  addSource(id: string, source: RasterSourceSpecification): unknown
  addLayer(layer: { id: string; type: 'raster'; source: string }, before?: string): unknown
}

/** Replaces the base tiles (and label overlay) under the app's own layers, keeping those. */
export function applyBasemap(map: BaseLayerHost, b: Basemap): void {
  BASE_LAYERS.forEach((id) => map.getLayer(id) && map.removeLayer(id))
  ;['tiles', 'labels'].forEach((id) => map.getSource(id) && map.removeSource(id))
  const before = map.getStyle()?.layers?.find((l) => !BASE_LAYERS.includes(l.id))?.id
  const style = basemapStyle(b)
  Object.entries(style.sources).forEach(([id, src]) => map.addSource(id, src as RasterSourceSpecification))
  style.layers.forEach((l) => map.addLayer(l as { id: string; type: 'raster'; source: string }, before))
}

/** Swaps the base when `basemap` changes. `ready` is the map's own "load has fired" flag:
 * MapLibre's `isStyleLoaded()` is false whenever tiles are loading, so it cannot gate the swap. */
export function useBasemapSwap(map: RefObject<(BaseLayerHost & { once(ev: 'load', fn: () => void): unknown }) | null>, ready: RefObject<boolean>, basemap: Basemap | undefined): void {
  const applied = useRef(basemap?.id)
  useEffect(() => {
    const m = map.current
    if (!m || !basemap || applied.current === basemap.id) return
    applied.current = basemap.id
    if (ready.current) applyBasemap(m, basemap)
    else m.once('load', () => applyBasemap(m, basemap))
  }, [map, ready, basemap])
}

const listeners = new Set<() => void>()

function readChoice(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

/** Remembers the pick in this browser (storage may be unavailable: the pick then lasts the session). */
export function saveBasemapChoice(id: string): void {
  try {
    localStorage.setItem(KEY, id)
  } catch {
    // private window / blocked storage
  }
  memo = id
  listeners.forEach((l) => l())
}

let memo: string | null | undefined

export function useBasemapChoice(): string | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => (memo === undefined ? (memo = readChoice()) : memo),
  )
}
