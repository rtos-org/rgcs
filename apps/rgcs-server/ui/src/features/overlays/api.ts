// REST calls for plugins and their area overlays (API table).
import { apiFetch } from '../../shared/api/client'
import type { OverlayArea, PluginInfo, TileEstimate, TileFormat } from '../../shared/api/types'

/** A rectangle in degrees (south < north, west < east). */
export interface Rect {
  readonly south: number
  readonly west: number
  readonly north: number
  readonly east: number
}

/** One overlay of one plugin. */
export interface OverlayRef {
  readonly plugin: string
  readonly overlay: string
}

const base = (r: OverlayRef): string => `/api/plugins/${encodeURIComponent(r.plugin)}/overlays/${encodeURIComponent(r.overlay)}`

export const listPlugins = (): Promise<PluginInfo[]> => apiFetch('/api/plugins')
/** Admin only (403 otherwise). */
export const setPluginEnabled = (id: string, enabled: boolean): Promise<PluginInfo> => apiFetch(`/api/plugins/${encodeURIComponent(id)}`, { method: 'PUT', body: { enabled } })
export const listAreas = (r: OverlayRef): Promise<OverlayArea[]> => apiFetch(`${base(r)}/areas`)

/** The cached tiles of an `area` overlay; `version` renews the URLs when a fetch completes. */
export const tileTemplate = (r: OverlayRef, format: TileFormat, version: string): string => `${base(r)}/tiles/{z}/{x}/{y}.${format}?v=${version}`

export interface AreasApi {
  /** The tiles a fetch of `rect` would take over the overlay's zooms. */
  readonly estimate: (rect: Rect) => Promise<number>
  /** Saves the area and starts its fetch (400 `bad_rect` / `too_many_tiles`). */
  readonly create: (area: Rect & { readonly name: string }) => Promise<unknown>
  /** Fetches the area again (409 `busy` while it is fetching). */
  readonly refresh: (id: number) => Promise<unknown>
  readonly remove: (id: number) => Promise<unknown>
}

export function areasApi(r: OverlayRef): AreasApi {
  return {
    estimate: async (rect) => (await apiFetch<TileEstimate>(`${base(r)}/areas/estimate`, { method: 'POST', body: rect })).tiles,
    create: (area) => apiFetch(`${base(r)}/areas`, { method: 'POST', body: area }),
    refresh: (id) => apiFetch(`${base(r)}/areas/${id}/refresh`, { method: 'POST' }),
    remove: (id) => apiFetch(`${base(r)}/areas/${id}`, { method: 'DELETE' }),
  }
}
