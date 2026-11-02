// Which map the manage sheet's "Add the area in view" reads: each map registers its bounds
// under its key while it is mounted (the operations map and the planner map).
import type { Rect } from './api'

export type MapKey = 'ops' | 'plan'

/** MapLibre's `LngLatBounds` getters. */
export interface BoundsLike {
  getSouth(): number
  getWest(): number
  getNorth(): number
  getEast(): number
}

type Reader = () => BoundsLike
const readers = new Map<MapKey, Reader>()
/** The server refuses |lat| >= 85. */
const MAX_LAT = 84.9

const round6 = (v: number): number => Math.round(v * 1e6) / 1e6
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

/** The view as a rectangle the server accepts (Web Mercator latitudes, ±180 longitudes). */
export function rectOf(b: BoundsLike): Rect {
  return {
    south: round6(clamp(b.getSouth(), -MAX_LAT, MAX_LAT)),
    west: round6(clamp(b.getWest(), -180, 180)),
    north: round6(clamp(b.getNorth(), -MAX_LAT, MAX_LAT)),
    east: round6(clamp(b.getEast(), -180, 180)),
  }
}

/** Registers a map's bounds; the returned function unregisters it (only if still the current one). */
export function registerMap(key: MapKey, read: Reader): () => void {
  readers.set(key, read)
  return () => {
    if (readers.get(key) === read) readers.delete(key)
  }
}

/** The area the map shows now; null with no map (or a map that cannot tell). */
export function viewRectOf(key: MapKey): Rect | null {
  try {
    const read = readers.get(key)
    return read ? rectOf(read()) : null
  } catch {
    return null
  }
}
