// Plugin overlays on one map (operations or planner): one raster layer per overlay switched on.
// Any failure is swallowed: the overlay just does not show, the map keeps working (design: UI).
import { useEffect, useRef, useState, type RefObject } from 'react'
import type { OverlayArea } from '../../shared/api/types'
import { useLang } from '../../shared/i18n/lang'
import { tileTemplate } from './api'
import { areasHub, areasOf, useAreas, type AreasHub } from './areasHub'
import { addOverlay, areaBounds, areaVersion, layerId, overlayLayers, removeOverlay, setOverlayOpacity, type LayerSpec, type OverlayHost } from './layer'
import { registerMap, type BoundsLike, type MapKey } from './mapRegistry'
import { activeOverlays, pickText, pluginsStore, usePlugins, type ActiveOverlay, type PluginsStore } from './plugins'
import { overlayPrefsStore, prefsFor, useOverlayPrefs, type OverlayPrefsStore } from './prefs'

/** The parts of a MapLibre map the overlays use. */
export interface OverlayMap extends OverlayHost {
  once(ev: 'load', fn: () => void): unknown
  getBounds(): BoundsLike
}

export interface OverlayStores {
  readonly prefs: OverlayPrefsStore
  readonly areas: AreasHub
  readonly plugins: PluginsStore
}

function guard(fn: () => void): void {
  try {
    fn()
  } catch {
    // the overlay is optional: a style not ready or a removed map leaves it off
  }
}

/** The map once its style has loaded (null before). */
function useLoadedMap<M extends OverlayMap>(map: RefObject<M | null>, loaded: RefObject<boolean>): M | null {
  const [ready, setReady] = useState<M | null>(null)
  useEffect(() => {
    const m = map.current
    if (!m) return
    let live = true
    const mark = () => live && setReady(m)
    if (loaded.current) mark()
    else guard(() => m.once('load', mark))
    return () => {
      live = false
      setReady(null)
    }
  }, [map, loaded])
  return ready
}

/** The layer of one overlay; null while an `area` overlay has no fetched area. */
export function layerSpec(o: ActiveOverlay, areas: readonly OverlayArea[], lang: string): LayerSpec | null {
  const v = o.overlay
  const common = { id: layerId(o.key), tileSize: v.tile_size, minzoom: v.min_zoom, maxzoom: v.max_zoom, attribution: pickText(v.attribution, lang) }
  if (v.cache === 'direct') return v.tiles ? { ...common, tiles: v.tiles, bounds: null } : null
  const bounds = areaBounds(areas)
  return bounds ? { ...common, tiles: tileTemplate(o.ref, v.format, areaVersion(areas)), bounds } : null
}

/** The overlays switched on, for the maps and the notices (`key` null: none). */
export function useVisibleOverlays(on: boolean, stores?: Partial<OverlayStores>): ActiveOverlay[] {
  const { plugins } = usePlugins(on, stores?.plugins ?? pluginsStore())
  const prefs = useOverlayPrefs(stores?.prefs ?? overlayPrefsStore())
  return on ? activeOverlays(plugins).filter((o) => prefsFor(prefs, o.key, o.overlay.default_opacity).on) : []
}

/** `key` null: no overlay (the audience mini-map). The UI language picks the attribution text
 * (`lang` overrides it in tests). */
export function useOverlays<M extends OverlayMap>(map: RefObject<M | null>, loaded: RefObject<boolean>, key: MapKey | null, lang?: string, stores?: OverlayStores): void {
  const [uiLang] = useLang()
  const pick = lang ?? uiLang
  const visible = useVisibleOverlays(key !== null, stores)
  const prefs = useOverlayPrefs(stores?.prefs ?? overlayPrefsStore())
  const areas = useAreas(
    visible.filter((o) => o.overlay.cache === 'area').map((o) => o.ref),
    stores?.areas ?? areasHub(),
  )
  const m = useLoadedMap(map, loaded)
  const specs = visible.flatMap((o) => layerSpec(o, areasOf(areas, o.key).areas, pick) ?? [])
  // strings, so the layers are rebuilt only when a spec changes, and repainted when an opacity does
  const specKey = JSON.stringify(specs)
  const opacity = Object.fromEntries(visible.map((o) => [layerId(o.key), prefsFor(prefs, o.key, o.overlay.default_opacity).opacity]))
  const opacityKey = JSON.stringify(opacity)
  const opacities = useRef(opacity)
  opacities.current = opacity

  useEffect(() => {
    const mm = map.current
    if (!key || !mm) return
    return registerMap(key, () => mm.getBounds())
  }, [map, key])

  useEffect(() => {
    if (!m) return
    const now = JSON.parse(opacityKey) as Record<string, number>
    Object.entries(now).forEach(([id, v]) => guard(() => setOverlayOpacity(m, id, v)))
  }, [m, opacityKey])

  useEffect(() => {
    if (!m) return
    guard(() => overlayLayers(m).forEach((id) => removeOverlay(m, id)))
    const wanted = JSON.parse(specKey) as LayerSpec[]
    wanted.forEach((s) => guard(() => addOverlay(m, s, opacities.current[s.id] ?? 60)))
  }, [m, specKey])
}
