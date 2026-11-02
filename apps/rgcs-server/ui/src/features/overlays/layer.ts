// Plugin overlay raster layers: a band right above the base map (and its labels) and below the
// mission path, rally, tracks and vehicles, ordered by layer id inside the band. Every call is
// guarded by the caller (useOverlays).
import type { RasterSourceSpecification } from 'maplibre-gl'
import type { OverlayArea } from '../../shared/api/types'

/** Every overlay layer (and its source) is `ov/<plugin>/<overlay>`. */
export const OVERLAY_PREFIX = 'ov/'
/** The base map's own layers (features/map/basemaps.ts). */
const BASE_LAYERS = ['base', 'labels']

/** [west, south, east, north] */
export type Bounds = readonly [number, number, number, number]

export const layerId = (key: string): string => `${OVERLAY_PREFIX}${key}`

/** What one overlay layer needs (from the manifest, plus the areas for an `area` overlay). */
export interface LayerSpec {
  readonly id: string
  readonly tiles: string
  readonly tileSize: number
  readonly minzoom: number
  readonly maxzoom: number
  /** `area` overlays: the fetched areas; `direct`: null. */
  readonly bounds: Bounds | null
  readonly attribution: string
}

/** Tiles are on disk: a completed fetch with some tiles, or a refetch of one. */
const hasTiles = (a: OverlayArea): boolean => a.status === 'ready' || a.status === 'partial' || (a.status === 'fetching' && a.fetched_at !== null)

/** The union of the areas with fetched tiles; null when there is none. */
export function areaBounds(areas: readonly OverlayArea[]): Bounds | null {
  const shown = areas.filter(hasTiles)
  if (shown.length === 0) return null
  return [Math.min(...shown.map((a) => a.west)), Math.min(...shown.map((a) => a.south)), Math.max(...shown.map((a) => a.east)), Math.max(...shown.map((a) => a.north))]
}

/** Changes when a fetch completes, so the tile URLs (and the browser cache) are renewed. */
export function areaVersion(areas: readonly OverlayArea[]): string {
  return String(Math.max(0, ...areas.filter(hasTiles).map((a) => a.fetched_at ?? 0)))
}

/** `YYYY-MM-DD` in local time. */
export function ymd(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** The notice's dates: the newest fetch and the newest data date; null with no fetched area. */
export function noticeDates(areas: readonly OverlayArea[]): { readonly fetched: string; readonly data: string | null } | null {
  const shown = areas.filter(hasTiles)
  const fetched = Math.max(...shown.map((a) => a.fetched_at ?? 0))
  if (shown.length === 0 || fetched <= 0) return null
  const data = Math.max(0, ...shown.map((a) => a.data_modified ?? 0))
  return { fetched: ymd(fetched), data: data > 0 ? ymd(data) : null }
}

/** The parts of a MapLibre map the overlays use (a fake in tests). */
export interface OverlayHost {
  getStyle(): { layers?: readonly { id: string }[] } | undefined
  getLayer(id: string): unknown
  getSource(id: string): unknown
  addSource(id: string, source: RasterSourceSpecification): unknown
  addLayer(layer: { id: string; type: 'raster'; source: string; minzoom: number; paint: { 'raster-opacity': number } }, before?: string): unknown
  removeLayer(id: string): unknown
  removeSource(id: string): unknown
  setPaintProperty(layer: string, name: string, value: unknown): unknown
}

export function overlaySource(s: LayerSpec): RasterSourceSpecification {
  return {
    type: 'raster',
    tiles: [s.tiles],
    tileSize: s.tileSize,
    minzoom: s.minzoom,
    maxzoom: s.maxzoom,
    ...(s.bounds ? { bounds: [...s.bounds] } : {}),
    ...(s.attribution ? { attribution: s.attribution } : {}),
  }
}

/** The overlay layers on the map, bottom first. */
export function overlayLayers(map: Pick<OverlayHost, 'getStyle'>): string[] {
  return (map.getStyle()?.layers ?? []).map((l) => l.id).filter((id) => id.startsWith(OVERLAY_PREFIX))
}

/** Adds the source and the layer inside the overlay band, below the first app layer or the
 * first overlay whose id sorts after this one. */
export function addOverlay(map: OverlayHost, s: LayerSpec, opacity: number): void {
  const above = (id: string) => !BASE_LAYERS.includes(id) && id !== s.id && !(id.startsWith(OVERLAY_PREFIX) && id < s.id)
  const before = map.getStyle()?.layers?.find((l) => above(l.id))?.id
  map.addSource(s.id, overlaySource(s))
  map.addLayer({ id: s.id, type: 'raster', source: s.id, minzoom: s.minzoom, paint: { 'raster-opacity': opacity / 100 } }, before)
}

export function removeOverlay(map: OverlayHost, id: string): void {
  if (map.getLayer(id)) map.removeLayer(id)
  if (map.getSource(id)) map.removeSource(id)
}

export function setOverlayOpacity(map: OverlayHost, id: string, opacity: number): void {
  if (map.getLayer(id)) map.setPaintProperty(id, 'raster-opacity', opacity / 100)
}
