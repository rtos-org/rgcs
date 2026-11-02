// Draws the other open plans under the active one (dimmed, no click handlers; spec
// 2026-10-20 §5.3 without the crossing labels, §9).
import type { ExpressionSpecification, Map as MlMap } from 'maplibre-gl'
import { useEffect, useRef, type RefObject } from 'react'
import { othersGeoJson, type OtherMission, type OthersGeoJson } from './overlay'

const PATHS = 'plans-paths'
const FENCE = 'plans-fence'
const RALLY = 'plans-rally'
const COLOR: ExpressionSpecification = ['get', 'color']
/** The active mission's first layers: everything here goes beneath them. */
const ACTIVE_BOTTOM = ['plan-fence-fill', 'mission-path-casing']

type Source = { setData: (d: unknown) => void }

function setup(m: MlMap): void {
  const before = ACTIVE_BOTTOM.find((id) => m.getLayer(id))
  for (const id of [PATHS, FENCE, RALLY]) m.addSource(id, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  m.addLayer({ id: 'plans-fence', type: 'fill', source: FENCE, filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': COLOR, 'fill-opacity': 0.08 } }, before)
  m.addLayer({ id: 'plans-fence-line', type: 'line', source: FENCE, paint: { 'line-color': COLOR, 'line-width': 1.5, 'line-opacity': 0.5 } }, before)
  m.addLayer({ id: 'plans-paths', type: 'line', source: PATHS, filter: ['==', ['get', 'predicted'], 0], layout: { 'line-join': 'round' }, paint: { 'line-color': COLOR, 'line-width': 2, 'line-opacity': 0.55 } }, before)
  m.addLayer({ id: 'plans-predicted', type: 'line', source: PATHS, filter: ['==', ['get', 'predicted'], 1], layout: { 'line-join': 'round' }, paint: { 'line-color': COLOR, 'line-width': 1.5, 'line-opacity': 0.5, 'line-dasharray': [2, 1.5] } }, before)
  m.addLayer({ id: 'plans-rally', type: 'circle', source: RALLY, paint: { 'circle-color': COLOR, 'circle-radius': 5, 'circle-opacity': 0.55, 'circle-stroke-color': '#0b1b2e', 'circle-stroke-width': 1 } }, before)
}

/** The routes drawn flat in 2D only: in 3D the air lines (othersAirLines) replace them. */
const ONLY_2D = [PATHS, 'plans-predicted']

type VisHost = Pick<MlMap, 'getLayer' | 'setLayoutProperty'>

/** Fence and rally stay draped in both modes, like the active plan's fence. */
export function applyOthersMode(m: VisHost, is3d: boolean): void {
  ONLY_2D.forEach((id) => m.getLayer(id) && m.setLayoutProperty(id, 'visibility', is3d ? 'none' : 'visible'))
}

function draw(m: MlMap, g: OthersGeoJson, is3d: boolean): void {
  if (!m.getSource(PATHS)) setup(m)
  ;(m.getSource(PATHS) as Source | undefined)?.setData(g.paths)
  ;(m.getSource(FENCE) as Source | undefined)?.setData(g.fences)
  ;(m.getSource(RALLY) as Source | undefined)?.setData(g.rally)
  applyOthersMode(m, is3d)
}

export interface PlanSetOverlayArgs {
  readonly map: RefObject<MlMap | null>
  readonly loaded: RefObject<boolean>
  readonly others: readonly OtherMission[]
  /** 3D hides the flat routes (the air lines replace them). */
  readonly is3d: boolean
}

/** The layers are only added once there is something to draw: a single-mission session stays as it was. */
function useOthersLayers(map: RefObject<MlMap | null>, loaded: RefObject<boolean>, others: readonly OtherMission[], is3d: boolean): void {
  const latest = useRef<{ g: OthersGeoJson; is3d: boolean } | null>(null)
  useEffect(() => {
    const m = map.current
    if (!m) return
    const g = othersGeoJson(others)
    latest.current = { g, is3d }
    if (others.length === 0 && !m.getSource(PATHS)) return
    if (loaded.current) draw(m, g, is3d)
    else m.once('load', () => latest.current && draw(m, latest.current.g, latest.current.is3d))
  }, [map, loaded, others, is3d])
}

export function usePlanSetOverlay({ map, loaded, others, is3d }: PlanSetOverlayArgs): void {
  useOthersLayers(map, loaded, others, is3d)
}
