// The planner's place search (2026-10-20): "lat, lon" moves the map straight there; any other
// text is looked up in OpenStreetMap Nominatim from the browser (needs internet, like the tiles).
import type { LatLon } from './geo'

export interface PlaceHit extends LatLon {
  readonly name: string
  /** The full address line, to tell same-named places apart. */
  readonly detail: string
}

const NOMINATIM = 'https://nominatim.openstreetmap.org/search'
const LIMIT = 5
const NUM = String.raw`[-+]?\d+(?:\.\d+)?`
const LAT_LON = new RegExp(String.raw`^\s*(${NUM})\s*(?:[,，、]\s*|\s+)(${NUM})\s*$`)

/** Decimal "lat, lon" (comma, Japanese comma or space between); null when the text is not one. */
export function parseLatLon(text: string): LatLon | null {
  const m = LAT_LON.exec(text)
  if (!m) return null
  const lat = Number(m[1])
  const lon = Number(m[2])
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null
}

interface NominatimRow {
  readonly lat: string
  readonly lon: string
  readonly name?: string
  readonly display_name: string
}

export async function searchPlaces(query: string, signal?: AbortSignal): Promise<PlaceHit[]> {
  const url = new URL(NOMINATIM)
  url.search = new URLSearchParams({ q: query, format: 'jsonv2', limit: String(LIMIT), 'accept-language': 'ja' }).toString()
  const res = await fetch(url.toString(), { signal, headers: { accept: 'application/json' } })
  if (!res.ok) throw new Error(`place search failed (${res.status})`)
  const rows = (await res.json()) as NominatimRow[]
  return rows.slice(0, LIMIT).map((r) => ({ name: r.name || r.display_name.split(',')[0]!, detail: r.display_name, lat: Number(r.lat), lon: Number(r.lon) }))
}
