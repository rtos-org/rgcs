import { describe, expect, it } from 'vitest'
import type { Basemap } from '../../shared/api/types'
import { applyBasemap, basemapStyle, chooseBasemap } from './basemaps'

const map: Basemap = { id: 'map', label: '地図', tiles: ['https://osm/{z}/{x}/{y}.png'], attribution: 'OSM', max_zoom: 19, overlay: null }
const sat: Basemap = { id: 'satellite', label: '衛星写真', tiles: ['https://esri/{z}/{y}/{x}'], attribution: 'Esri', max_zoom: 19, overlay: ['https://labels/{z}/{x}/{y}.png'] }

/** Fake style stack: addLayer(layer, before) inserts before `before`, else on top. */
function fakeMap(layers: string[]) {
  const stack = [...layers]
  const sources = new Set(['tiles'])
  return {
    stack,
    sources,
    getStyle: () => ({ layers: stack.map((id) => ({ id })) }),
    getLayer: (id: string) => (stack.includes(id) ? { id } : undefined),
    getSource: (id: string) => (sources.has(id) ? {} : undefined),
    removeLayer: (id: string) => void stack.splice(stack.indexOf(id), 1),
    removeSource: (id: string) => void sources.delete(id),
    addSource: (id: string) => void sources.add(id),
    addLayer: (l: { id: string }, before?: string) => void (before ? stack.splice(stack.indexOf(before), 0, l.id) : stack.push(l.id)),
  }
}

describe('base maps', () => {
  it('unknown_saved_choice_falls_back_to_the_first', () => {
    expect(chooseBasemap([map, sat], 'satellite')).toBe(sat)
    expect(chooseBasemap([map, sat], 'gone')).toBe(map)
    expect(chooseBasemap([map, sat], null)).toBe(map)
  })

  it('a_style_has_the_base_and_the_label_overlay', () => {
    expect(basemapStyle(map).layers.map((l) => l.id)).toEqual(['base'])
    const s = basemapStyle(sat)
    expect(s.layers.map((l) => l.id)).toEqual(['base', 'labels'])
    expect(s.sources.tiles).toMatchObject({ type: 'raster', tiles: sat.tiles, maxzoom: 19, attribution: 'Esri' })
  })

  it('apply_basemap_replaces_the_base_layers_below_the_app_layers', () => {
    const m = fakeMap(['base', 'mission-path-line', 'course-vector'])
    applyBasemap(m, sat)
    expect(m.stack).toEqual(['base', 'labels', 'mission-path-line', 'course-vector'])
    expect([...m.sources].sort()).toEqual(['labels', 'tiles'])
    applyBasemap(m, map)
    expect(m.stack).toEqual(['base', 'mission-path-line', 'course-vector'])
    expect([...m.sources]).toEqual(['tiles'])
  })
})
