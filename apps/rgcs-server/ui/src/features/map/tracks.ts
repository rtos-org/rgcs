import type { Feature, FeatureCollection, LineString } from 'geojson'

/** [lon, lat, alt_rel (m), time (ms)]: the altitude draws the 3D track, the time trims it. */
export type Point = readonly [number, number, number, number]
export type Track = readonly Point[]
export type Tracks = ReadonlyMap<number, Track>

/** Memory guard per vehicle (about 2 h at 10 m/s with 1 m steps is ~70 k: ample for 120 min of typical flight). */
export const MAX_TRACK_POINTS = 20_000
const MIN_STEP_M = 1

export interface Fix {
  readonly lon: number
  readonly lat: number
  readonly alt: number
  readonly t: number
}

function metres(a: Point, b: Fix): number {
  const dx = (b.lon - a[0]) * 111_320 * Math.cos((a[1] * Math.PI) / 180)
  const dy = (b.lat - a[1]) * 110_540
  return Math.hypot(dx, dy, b.alt - a[2])
}

/** New map with the fix appended to `sysid`'s track; identity-stable when the move is jitter. */
export function appendPoint(tracks: Tracks, sysid: number, fix: Fix): Tracks {
  const prev = tracks.get(sysid) ?? []
  const last = prev.at(-1)
  if (last && metres(last, fix) < MIN_STEP_M) return tracks
  const out = new Map(tracks)
  out.set(sysid, [...prev, [fix.lon, fix.lat, fix.alt, fix.t] as const].slice(-MAX_TRACK_POINTS))
  return out
}

/** Drops points older than `keepMs` before `now` (empty tracks vanish); the same map when nothing expired. */
export function trimTracks(tracks: Tracks, now: number, keepMs: number): Tracks {
  const cutoff = now - keepMs
  const stale = [...tracks.values()].some((tr) => keepMs <= 0 || (tr[0] !== undefined && tr[0][3] < cutoff))
  if (!stale) return tracks
  const out = new Map<number, Track>()
  for (const [sysid, tr] of tracks) {
    const kept = keepMs <= 0 ? [] : tr.filter((p) => p[3] >= cutoff)
    if (kept.length > 0) out.set(sysid, kept)
  }
  return out
}

export function tracksGeoJson(tracks: Tracks, selected: number | null): FeatureCollection<LineString, { sysid: number; selected: boolean }> {
  const features: Feature<LineString, { sysid: number; selected: boolean }>[] = []
  for (const [sysid, track] of tracks) {
    if (track.length < 2) continue
    features.push({
      type: 'Feature',
      properties: { sysid, selected: sysid === selected },
      geometry: { type: 'LineString', coordinates: track.map((p) => [p[0], p[1]]) },
    })
  }
  return { type: 'FeatureCollection', features }
}
