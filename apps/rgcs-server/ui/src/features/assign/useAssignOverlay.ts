// Draws the assignment board's overlay on the planner map (spec 2026-10-31 §3.4): plan routes,
// their points and dashed vehicle links as GeoJSON layers; plan names and vehicles as DOM markers
// (the base styles carry no glyphs for symbol text). Absent input clears everything.
import maplibregl, { type ExpressionSpecification, type Map as MlMap, type Marker } from 'maplibre-gl'
import type { FeatureCollection, Point } from 'geojson'
import { useEffect, useRef, type RefObject } from 'react'
import type { VehicleState } from '../../shared/api/types'
import { markerEl, updateMarkerEl } from '../map/markers'
import { assignGeoJson, type AssignGeoJson, type AssignOverlayInput, type OverlayVehicle } from './assignOverlay'

const ROUTES = 'assign-routes'
const POINTS = 'assign-points'
const LINKS = 'assign-links'
const COLOR: ExpressionSpecification = ['get', 'color']
const OPACITY: ExpressionSpecification = ['get', 'opacity']
/** The `.vmk` disc centre on the position (as on the planner's own vehicle marker). */
const VEHICLE_OFFSET: [number, number] = [-17, 0]
const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] }

type Source = { setData: (d: unknown) => void }
interface Pin {
  readonly marker: Marker
  readonly el: HTMLDivElement
}
type Pins = Map<number, Pin>

function setup(m: MlMap): void {
  for (const id of [ROUTES, POINTS, LINKS]) m.addSource(id, { type: 'geojson', data: EMPTY })
  m.addLayer({ id: LINKS, type: 'line', source: LINKS, paint: { 'line-color': COLOR, 'line-width': 2, 'line-opacity': OPACITY, 'line-dasharray': [3.5, 2.5] } })
  m.addLayer({ id: ROUTES, type: 'line', source: ROUTES, layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': COLOR, 'line-width': 3, 'line-opacity': OPACITY } })
  m.addLayer({ id: POINTS, type: 'circle', source: POINTS, paint: { 'circle-color': COLOR, 'circle-radius': 4, 'circle-opacity': OPACITY, 'circle-stroke-color': '#0b1018', 'circle-stroke-width': 1.5, 'circle-stroke-opacity': OPACITY } })
}

function setSources(m: MlMap, g: AssignGeoJson | null): void {
  if (!m.getSource(ROUTES)) setup(m)
  ;(m.getSource(ROUTES) as Source | undefined)?.setData(g?.routes ?? EMPTY)
  ;(m.getSource(POINTS) as Source | undefined)?.setData(g?.points ?? EMPTY)
  ;(m.getSource(LINKS) as Source | undefined)?.setData(g?.links ?? EMPTY)
}

/** Removes the pins whose key is gone. */
function prune(pins: Pins, keep: ReadonlySet<number>): void {
  for (const [k, p] of pins) {
    if (keep.has(k)) continue
    p.marker.remove()
    pins.delete(k)
  }
}

function labelEl(): HTMLDivElement {
  const el = document.createElement('div')
  el.className = 'as-map-label'
  return el
}

function drawLabels(m: MlMap, pins: Pins, labels: FeatureCollection<Point>): void {
  const seen = new Set<number>()
  labels.features.forEach((f) => {
    const { plan, name, color, opacity } = f.properties as { plan: number; name: string; color: string; opacity: number }
    seen.add(plan)
    const old = pins.get(plan)
    const el = old?.el ?? labelEl()
    el.textContent = name
    el.style.color = color
    el.style.opacity = String(opacity)
    const [lon, lat] = f.geometry.coordinates as [number, number]
    if (old) return void old.marker.setLngLat([lon, lat])
    const marker = new maplibregl.Marker({ element: el, anchor: 'bottom-left', offset: [8, -6] }).setLngLat([lon, lat]).addTo(m)
    pins.set(plan, { marker, el })
  })
  prune(pins, seen)
}

function drawVehicles(m: MlMap, pins: Pins, shown: readonly OverlayVehicle[], states: readonly VehicleState[]): void {
  const byId = new Map(states.map((v) => [v.sysid, v]))
  const seen = new Set<number>()
  shown.forEach((o) => {
    const v = byId.get(o.sysid)
    if (!v) return
    seen.add(o.sysid)
    const old = pins.get(o.sysid)
    const el = old ? updateMarkerEl(old.el, v, false) : markerEl(v, false)
    el.style.opacity = String(o.opacity)
    el.classList.add('as-veh')
    if (o.color === null) el.style.removeProperty('--as-plan')
    else el.style.setProperty('--as-plan', o.color)
    if (old) return void old.marker.setLngLat([o.lon, o.lat])
    const marker = new maplibregl.Marker({ element: el, anchor: 'left', offset: VEHICLE_OFFSET }).setLngLat([o.lon, o.lat]).addTo(m)
    pins.set(o.sysid, { marker, el })
  })
  prune(pins, seen)
}

function draw(m: MlMap, input: AssignOverlayInput | null, labels: Pins, vehicles: Pins): void {
  const g = input ? assignGeoJson(input) : null
  setSources(m, g)
  drawLabels(m, labels, g?.labels ?? (EMPTY as FeatureCollection<Point>))
  drawVehicles(m, vehicles, g?.vehicles ?? [], input?.vehicles ?? [])
}

export interface AssignOverlayArgs {
  readonly map: RefObject<MlMap | null>
  readonly loaded: RefObject<boolean>
  /** null: the editor's map, nothing of the board drawn. */
  readonly assign: AssignOverlayInput | null
}

/** The layers are only added once the board opens: the editor's map stays as it was. */
export function useAssignOverlay({ map, loaded, assign }: AssignOverlayArgs): void {
  const labels = useRef<Pins>(new Map())
  const vehicles = useRef<Pins>(new Map())
  const latest = useRef(assign)
  useEffect(() => {
    const m = map.current
    latest.current = assign
    if (!m) return
    if (assign === null && !m.getSource(ROUTES) && labels.current.size === 0 && vehicles.current.size === 0) return
    if (loaded.current) draw(m, assign, labels.current, vehicles.current)
    else m.once('load', () => draw(m, latest.current, labels.current, vehicles.current))
  }, [map, loaded, assign])
  // the map is rebuilt with its markers gone
  useEffect(() => () => {
    labels.current = new Map()
    vehicles.current = new Map()
  }, [])
}
