import { describe, expect, it, vi } from 'vitest'
import { decodeTerrarium, TerrainSampler, terrainSource, tileOf } from './terrain'

/** A 256² tile where every pixel encodes `h` metres (Terrarium: r*256 + g + b/256 - 32768). */
function tile(h: (i: number, j: number) => number): Float32Array {
  const rgba = new Uint8ClampedArray(256 * 256 * 4)
  for (let j = 0; j < 256; j++)
    for (let i = 0; i < 256; i++) {
      const v = h(i, j) + 32768
      const k = (j * 256 + i) * 4
      rgba[k] = Math.floor(v / 256)
      rgba[k + 1] = Math.floor(v) % 256
      rgba[k + 2] = Math.round((v - Math.floor(v)) * 256)
      rgba[k + 3] = 255
    }
  return decodeTerrarium(rgba)
}

describe('decodeTerrarium', () => {
  it('decodes metres', () => {
    expect(tile(() => 123.5)[0]).toBeCloseTo(123.5)
    expect(tile(() => -10)[5]).toBeCloseTo(-10)
  })
})

describe('TerrainSampler', () => {
  const at = { lon: 138.48029, lat: 35.481883 }
  it('is null until the tile arrives, loads it once, then interpolates', async () => {
    let resolve: (t: Float32Array) => void = () => {}
    const load = vi.fn(() => new Promise<Float32Array | null>((r) => (resolve = r)))
    const onTile = vi.fn()
    const s = new TerrainSampler('https://dem/{z}/{x}/{y}.png', onTile, load)
    expect(s.elevAt(at.lon, at.lat)).toBeNull()
    expect(s.elevAt(at.lon, at.lat)).toBeNull()
    expect(load).toHaveBeenCalledTimes(1)
    const { x, y } = tileOf(at.lon, at.lat, 13)
    expect(load).toHaveBeenCalledWith(`https://dem/13/${x}/${y}.png`)
    resolve(tile((i) => i))
    await vi.waitFor(() => expect(onTile).toHaveBeenCalled())
    const e = s.elevAt(at.lon, at.lat)
    expect(e).not.toBeNull()
    expect(e!).toBeGreaterThanOrEqual(0)
    expect(e!).toBeLessThanOrEqual(255)
  })
  it('waits 30 s before retrying a tile that failed (offline sites must not hammer the network)', async () => {
    let now = 0
    const load = vi.fn(async () => null)
    const s = new TerrainSampler('u/{z}/{x}/{y}', () => {}, load, () => now)
    s.elevAt(at.lon, at.lat)
    await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(1))
    await new Promise((r) => setTimeout(r, 0))
    now = 29_000
    s.elevAt(at.lon, at.lat)
    expect(load).toHaveBeenCalledTimes(1)
    now = 31_000
    s.elevAt(at.lon, at.lat)
    expect(load).toHaveBeenCalledTimes(2)
  })
})

describe('terrainSource', () => {
  it('is a Terrarium raster-dem source', () => {
    expect(terrainSource('u/{z}/{x}/{y}')).toEqual({ type: 'raster-dem', tiles: ['u/{z}/{x}/{y}'], tileSize: 256, encoding: 'terrarium', maxzoom: 15, attribution: 'Terrain: Mapzen / AWS Terrain Tiles' })
  })
})
