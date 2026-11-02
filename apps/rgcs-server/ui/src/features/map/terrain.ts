// Terrarium DEM for the 3D map (prototype TerrainSampler): MapLibre draws the terrain from the
// `raster-dem` source; this sampler decodes the same tiles itself so altitudes (vehicle posts,
// mission path) are known without asking the renderer. A DSM only has to provide `elevAt`.
import type { RasterDEMSourceSpecification } from 'maplibre-gl'
import type { ElevAt } from './air'

const Z = 13
const SIZE = 256

export function terrainSource(url: string): RasterDEMSourceSpecification {
  return { type: 'raster-dem', tiles: [url], tileSize: SIZE, encoding: 'terrarium', maxzoom: 15, attribution: 'Terrain: Mapzen / AWS Terrain Tiles' }
}

/** Tile index and the fractional pixel position inside it. */
export function tileOf(lon: number, lat: number, z: number): { x: number; y: number; px: number; py: number } {
  const n = 2 ** z
  const xf = ((lon + 180) / 360) * n
  const r = (lat * Math.PI) / 180
  const yf = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n
  const x = Math.floor(xf)
  const y = Math.floor(yf)
  return { x, y, px: (xf - x) * SIZE, py: (yf - y) * SIZE }
}

export function decodeTerrarium(rgba: ArrayLike<number>): Float32Array {
  const out = new Float32Array(SIZE * SIZE)
  for (let i = 0; i < out.length; i++) out[i] = rgba[i * 4]! * 256 + rgba[i * 4 + 1]! + rgba[i * 4 + 2]! / 256 - 32768
  return out
}

export type TileLoader = (url: string) => Promise<Float32Array | null>

export async function loadTile(url: string): Promise<Float32Array | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const bmp = await createImageBitmap(await res.blob())
    const canvas = document.createElement('canvas')
    canvas.width = SIZE
    canvas.height = SIZE
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return null
    ctx.drawImage(bmp, 0, 0)
    return decodeTerrarium(ctx.getImageData(0, 0, SIZE, SIZE).data)
  } catch {
    return null
  }
}

function bilinear(t: Float32Array, px: number, py: number): number {
  const cx = Math.min(SIZE - 1, Math.max(0, px - 0.5))
  const cy = Math.min(SIZE - 1, Math.max(0, py - 0.5))
  const x0 = Math.floor(cx)
  const y0 = Math.floor(cy)
  const x1 = Math.min(SIZE - 1, x0 + 1)
  const y1 = Math.min(SIZE - 1, y0 + 1)
  const fx = cx - x0
  const fy = cy - y0
  const e = (i: number, j: number) => t[j * SIZE + i]!
  return e(x0, y0) * (1 - fx) * (1 - fy) + e(x1, y0) * fx * (1 - fy) + e(x0, y1) * (1 - fx) * fy + e(x1, y1) * fx * fy
}

/** Ground elevation from z13 Terrarium tiles; `onTile` fires when a tile arrives (redraw). */
const RETRY_MS = 30_000

/** A tile that failed: retried no sooner than `RETRY_MS` later (offline sites, LTE). */
interface Failed {
  readonly failedAt: number
}

export class TerrainSampler {
  private readonly tiles = new Map<string, Float32Array | 'loading' | Failed>()
  private readonly url: string
  private readonly onTile: () => void
  private readonly load: TileLoader
  private readonly now: () => number
  constructor(url: string, onTile: () => void, load: TileLoader = loadTile, now: () => number = Date.now) {
    this.url = url
    this.onTile = onTile
    this.load = load
    this.now = now
  }

  readonly elevAt: ElevAt = (lon, lat) => {
    const { x, y, px, py } = tileOf(lon, lat, Z)
    const key = `${x}/${y}`
    const t = this.tiles.get(key)
    if (t instanceof Float32Array) return bilinear(t, px, py)
    if (t === undefined || (t !== 'loading' && this.now() - t.failedAt >= RETRY_MS)) this.fetch(key, x, y)
    return null
  }

  private fetch(key: string, x: number, y: number): void {
    this.tiles.set(key, 'loading')
    const url = this.url.replace('{z}', String(Z)).replace('{x}', String(x)).replace('{y}', String(y))
    void this.load(url).then((t) => {
      if (!t) {
        this.tiles.set(key, { failedAt: this.now() })
        return
      }
      this.tiles.set(key, t)
      this.onTile()
    })
  }
}
