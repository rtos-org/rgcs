// Ground elevation for 「地図で指定」: one DEM sample, waiting for the tile.
import { TerrainSampler, loadTile, type DemEncoding, type TileLoader } from '../map/terrain'

const DEFAULT_TIMEOUT_MS = 3000

export function groundElevation(tilesUrl: string | null, lon: number, lat: number, opts: { timeoutMs?: number; load?: TileLoader; terrainEncoding?: DemEncoding } = {}): Promise<number | null> {
  if (tilesUrl === null) return Promise.resolve(null)
  return new Promise((resolve) => {
    let done = false
    const finish = (v: number | null) => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve(v)
    }
    const sampler = new TerrainSampler(tilesUrl, () => finish(sampler.elevAt(lon, lat)), opts.load ?? loadTile, undefined, opts.terrainEncoding)
    const timer = setTimeout(() => finish(null), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    const now = sampler.elevAt(lon, lat)
    if (now !== null) finish(now)
  })
}
