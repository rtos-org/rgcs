import { describe, expect, it } from 'vitest'
import { rasterStyle } from './style'

describe('rasterStyle', () => {
  it('builds a single raster source and layer from the tile url', () => {
    const s = rasterStyle('https://tiles.example/{z}/{x}/{y}.png', 'Example')
    expect(s.version).toBe(8)
    const src = s.sources['tiles'] as { type: string; tiles: string[]; tileSize: number; attribution: string }
    expect(src.type).toBe('raster')
    expect(src.tiles).toEqual(['https://tiles.example/{z}/{x}/{y}.png'])
    expect(src.tileSize).toBe(256)
    expect(src.attribution).toBe('Example')
    expect(s.layers).toEqual([{ id: 'base', type: 'raster', source: 'tiles' }])
  })
})
