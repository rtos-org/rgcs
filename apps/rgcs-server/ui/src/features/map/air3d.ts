// Shared 3D plumbing for the operations and mission maps: the DEM source and sampler, one
// AirPathLayer, the 2D / 3D switch and the marker floating driven by the layer's frames.
import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { Map as MlMap } from 'maplibre-gl'
import { AirPathLayer } from './airLayer'
import { VehicleModelLayer } from './models/modelLayer'
import { floatMarkers, sameMatrix, type Floating } from './float'
import { applyMapMode, DEM_SOURCE, type MapMode, type ModeLayers } from './mapMode'
import { TerrainSampler, terrainSource } from './terrain'

interface Args {
  readonly map: RefObject<MlMap | null>
  readonly loaded: RefObject<boolean>
  readonly mode: MapMode
  readonly terrainTiles: string | null
  readonly layerId: string
  /** Adds the map's own 3D layers (called once, after the DEM source; the air layer comes last). */
  readonly setup: (m: MlMap) => void
  readonly modeLayers: ModeLayers
  /** Re-stacks the map's layers once the air layer exists. */
  readonly order?: (m: MlMap) => void
}

export interface Air3d {
  readonly sampler: TerrainSampler | null
  /** True once the layers exist. */
  readonly ready: boolean
  readonly is3d: boolean
  /** Bumps when a DEM tile arrives (recompute altitudes). */
  readonly tick: number
  readonly layer: AirPathLayer
  /** Low-poly vehicle models, drawn in 3D only (the DOM disc hides then). */
  readonly models: VehicleModelLayer
  /**
   * The markers to float; set by the caller (a new array) whenever its data changes. A frame with
   * the camera of the last one leaves them alone unless the array changed.
   */
  readonly floats: { current: readonly Floating[] }
  /** Markers that move on their own (vehicles): floated every frame. */
  readonly live: { current: readonly Floating[] }
  /** When the last 2D / 3D camera animation started (ms); camera moves should not cut it short. */
  readonly modeSwitchAt: { readonly current: number }
  /** The last 3D frame's matrix (`null` before the first one): screen maths for drags. */
  readonly matrix: { readonly current: ArrayLike<number> | null }
}

/** What the last frame floated: its matrix (copied: MapLibre may reuse the array) and the `floats` array. */
interface Floated {
  readonly mx: ArrayLike<number> | null
  readonly of: readonly Floating[] | null
}

type Refs = { readonly floats: { current: readonly Floating[] }; readonly live: { current: readonly Floating[] }; readonly floated: { current: Floated } }

/** One frame: the live markers always; the others only when the camera or their list changed. */
function floatFrame(m: MlMap, mx: ArrayLike<number>, { floats, live, floated }: Refs): void {
  if (floats.current !== floated.current.of || !sameMatrix(mx, floated.current.mx)) {
    floatMarkers(m, mx, floats.current)
    floated.current = { mx: Array.from(mx), of: floats.current }
  }
  floatMarkers(m, mx, live.current)
}

/** The 2D / 3D camera animation (applyMapMode) plus a margin. */
export const MODE_EASE_MS = 950

export function useAir3d({ map, loaded, mode, terrainTiles, layerId, setup, modeLayers, order }: Args): Air3d {
  const [tick, setTick] = useState(0)
  const [ready, setReady] = useState(false)
  const sampler = useMemo(() => (terrainTiles ? new TerrainSampler(terrainTiles, () => setTick((n) => n + 1)) : null), [terrainTiles])
  const layer = useRef(new AirPathLayer(layerId)).current
  const models = useRef(new VehicleModelLayer(`${layerId}-models`)).current
  const floats = useRef<readonly Floating[]>([])
  const live = useRef<readonly Floating[]>([])
  const floated = useRef<Floated>({ mx: null, of: null })
  const modeSwitchAt = useRef(0)
  const matrix = useRef<ArrayLike<number> | null>(null)
  const setupRef = useRef({ setup, order })
  setupRef.current = { setup, order }
  const modeRef = useRef(modeLayers)
  modeRef.current = modeLayers
  const is3d = mode === '3d' && sampler !== null

  useEffect(() => {
    const m = map.current
    if (!m || !terrainTiles) return
    const go = () => {
      m.addSource(DEM_SOURCE, terrainSource(terrainTiles))
      setupRef.current.setup(m)
      m.addLayer(layer)
      m.addLayer(models)
      setupRef.current.order?.(m)
      layer.onFrame = (mx) => {
        matrix.current = mx
        floatFrame(m, mx, { floats, live, floated })
      }
      setReady(true)
    }
    if (loaded.current) go()
    else m.once('load', go)
  }, [map, loaded, terrainTiles, layer, models])

  useEffect(() => {
    const m = map.current
    if (!m || !ready) return
    layer.visible = is3d
    models.visible = is3d
    modeSwitchAt.current = Date.now()
    applyMapMode(m, is3d ? '3d' : '2d', modeRef.current)
    floated.current = { mx: null, of: null }
    if (!is3d) floatMarkers(m, null, [...floats.current, ...live.current])
  }, [map, ready, is3d, layer, models])

  return { sampler, ready, is3d, tick, layer, models, floats, live, modeSwitchAt, matrix }
}
