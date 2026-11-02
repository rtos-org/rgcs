import { describe, expect, it } from 'vitest'
import { LAYER_ORDER, orderLayers } from './layers'

/** A stand-in for MapLibre's style stack: `moveLayer(id)` without `beforeId` moves it to the top. */
function fakeMap(ids: string[]) {
  const stack = [...ids]
  return {
    stack,
    getLayer: (id: string) => (stack.includes(id) ? { id } : undefined),
    moveLayer: (id: string) => {
      stack.splice(stack.indexOf(id), 1)
      stack.push(id)
    },
  }
}

describe('map layer order', () => {
  it('layer_order_puts_mission_below_tracks_below_sight', () => {
    const m = fakeMap(['guided-line', 'tracks-selected', 'osm', 'mission-path-line', 'tracks-others'])
    orderLayers(m)
    expect(m.stack).toEqual(['osm', 'mission-path-line', 'tracks-others', 'tracks-selected', 'guided-line'])
    expect(LAYER_ORDER.indexOf('mission-path-line')).toBeLessThan(LAYER_ORDER.indexOf('tracks-others'))
  })

  it('puts the ROI sight line right above the guided line', () => {
    const at = (id: string) => LAYER_ORDER.indexOf(id as (typeof LAYER_ORDER)[number])
    expect(at('sight-casing')).toBe(at('guided-line') + 1)
    expect(at('sight')).toBe(at('sight-casing') + 1)
    expect(at('course-nav')).toBe(at('sight') + 1)
  })

  it('skips layers the map does not have', () => {
    const m = fakeMap(['osm', 'tracks-others'])
    orderLayers(m)
    expect(m.stack).toEqual(['osm', 'tracks-others'])
  })

  it('never_restacks_a_plugin_overlay_above_the_app_layers', () => {
    expect(LAYER_ORDER as readonly string[]).not.toContain('ov/carrier/lte')
    const m = fakeMap(['osm', 'ov/carrier/lte', 'tracks-others', 'mission-path-line'])
    orderLayers(m)
    expect(m.stack.indexOf('ov/carrier/lte')).toBe(1)
  })
})
