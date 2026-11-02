import type { StyleSpecification } from 'maplibre-gl'

/** One raster source + one layer; the tile template comes from `/api/settings/app`. */
export function rasterStyle(tileUrl: string, attribution: string): StyleSpecification {
  return {
    version: 8,
    sources: { tiles: { type: 'raster', tiles: [tileUrl], tileSize: 256, attribution } },
    layers: [{ id: 'base', type: 'raster', source: 'tiles' }],
  }
}
