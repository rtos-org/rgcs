// 2D / 3D (prototype applyMapMode). The pick is per browser and shared by the operations and
// mission maps. MapLibre gotcha (memory): stop the camera and set the terrain BEFORE easing —
// enabling terrain mid-animation crashes the render loop and the map freezes silently.
import { useSyncExternalStore } from 'react'
import type { SkySpecification, TerrainSpecification } from 'maplibre-gl'

export type MapMode = '2d' | '3d'

const KEY = 'rgcs.mapMode'
export const DEM_SOURCE = 'dem'

/** The parts of a MapLibre map the switch uses (a fake in tests). */
export interface ModeHost {
  stop(): unknown
  setTerrain(t: TerrainSpecification | null): unknown
  setSky(s: SkySpecification | undefined): unknown
  easeTo(o: { pitch: number; bearing: number; duration: number; freezeElevation: boolean }): unknown
  getLayer(id: string): unknown
  getSource(id: string): unknown
  setLayoutProperty(id: string, name: 'visibility', value: 'visible' | 'none'): unknown
}

/**
 * Pass to every camera animation. MapLibre 5 freezes the centre elevation for any `easeTo` over
 * terrain but only thaws it at the end when this flag is set — otherwise it stays frozen (at 0 m
 * after the 3D switch) until the user drags, and in the mountains the camera sits inside the
 * terrain with every marker off screen.
 */
export const KEEP_ELEVATION = { freezeElevation: true } as const

/**
 * How far Ctrl+drag may tilt the 3D view (MapLibre's default is 60°): 85° looks along the
 * ground for terrain and low routes; beyond 90° the camera would look up at the sky.
 */
export const MAX_PITCH = 85

/**
 * The 3D sky: daylight blue fading into a pale haze at the horizon, and the same haze over far
 * terrain so the ridgelines meet the sky instead of the map's dark background.
 */
export const SKY: SkySpecification = {
  'sky-color': '#4f8fd6',
  'horizon-color': '#cfe2f3',
  'fog-color': '#dbe7f1',
  'sky-horizon-blend': 0.6,
  'horizon-fog-blend': 0.7,
  'fog-ground-blend': 0.85,
  'atmosphere-blend': 0,
}

export interface ModeLayers {
  readonly only3d: readonly string[]
  readonly only2d: readonly string[]
}

export function applyMapMode(map: ModeHost, mode: MapMode, layers: ModeLayers, animate = true): void {
  const is3d = mode === '3d' && map.getSource(DEM_SOURCE) !== undefined
  map.stop()
  map.setTerrain(is3d ? { source: DEM_SOURCE, exaggeration: 1 } : null)
  map.setSky(is3d ? SKY : undefined)
  const vis = (id: string, on: boolean) => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none')
  layers.only3d.forEach((id) => vis(id, is3d))
  layers.only2d.forEach((id) => vis(id, !is3d))
  if (animate) map.easeTo({ pitch: is3d ? 60 : 0, bearing: is3d ? -25 : 0, duration: 900, ...KEEP_ELEVATION })
}

const listeners = new Set<() => void>()
let memo: MapMode | undefined

export function readMapMode(): MapMode {
  try {
    return localStorage.getItem(KEY) === '3d' ? '3d' : '2d'
  } catch {
    return '2d'
  }
}

export function saveMapMode(mode: MapMode): void {
  try {
    localStorage.setItem(KEY, mode)
  } catch {
    // blocked storage: the pick lasts the session
  }
  memo = mode
  listeners.forEach((l) => l())
}

export function useMapMode(): MapMode {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => (memo ??= readMapMode()),
  )
}
