/** Bottom → top above the base map (prototype orderLayers): mission path, tracks, guided line / sight, gimbal footprint. DOM markers sit above the canvas. */
export const LAYER_ORDER = ['mission-path-line', 'mission-predicted-line', 'tracks-others', 'tracks-selected', 'guided-line', 'sight-casing', 'sight', 'course-nav', 'course-vector-casing', 'course-vector', 'course-target', 'gimbal-footprint', 'gimbal-footprint-line', 'veh-ground', 'veh-air3d', 'veh-air3d-models'] as const

interface LayerStack {
  getLayer(id: string): unknown
  moveLayer(id: string): void
}

/** Re-stacks our layers in `LAYER_ORDER`; call after any layer is added. */
export function orderLayers(map: LayerStack): void {
  LAYER_ORDER.forEach((id) => {
    if (map.getLayer(id)) map.moveLayer(id)
  })
}
