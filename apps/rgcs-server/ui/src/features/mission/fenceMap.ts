// Fence zones and rally points on the planner map (user request 2026-10-19). Zones are filled
// areas: inclusion `--ok` green, exclusion `--danger` red. Rally points are "R" markers. They show
// in every tab; only the fence tab offers vertex / circle handles and only the rally tab lets the
// rally markers move.
import maplibregl, { type Map as MlMap, type Marker } from 'maplibre-gl'
import type { Feature, FeatureCollection, Geometry } from 'geojson'
import { useEffect, useRef, type RefObject } from 'react'
import type { FenceZone } from '../../shared/api/types'
import { haversineM } from './geo'
import { circleRing } from './geofenceModel'
import type { Draft } from './model'

export type PlanTab = 'mission' | 'fence' | 'rally'

export type FenceEdit =
  | { readonly kind: 'vertex'; readonly zone: number; readonly index: number; readonly lat: number; readonly lon: number }
  | { readonly kind: 'center'; readonly zone: number; readonly lat: number; readonly lon: number }
  | { readonly kind: 'radius'; readonly zone: number; readonly radius: number }

const SOURCE = 'plan-fence'
const OK = '#5fd39b'
const DANGER = '#ff6961'
const M_PER_DEG_LON = 111_320

type Props = { readonly inc: number; readonly zone: number }

function zoneFeature(z: FenceZone, zone: number): Feature<Geometry, Props> | null {
  const properties = { inc: z.inclusion ? 1 : 0, zone }
  if (z.kind === 'circle') return { type: 'Feature', properties, geometry: { type: 'Polygon', coordinates: [circleRing(z.center, z.radius).map((p) => [p.lon, p.lat])] } }
  const pts = z.vertices.map((p) => [p.lon, p.lat])
  if (pts.length >= 3) return { type: 'Feature', properties, geometry: { type: 'Polygon', coordinates: [[...pts, pts[0]!]] } }
  // a polygon being drawn: its first edge as a line
  return pts.length === 2 ? { type: 'Feature', properties, geometry: { type: 'LineString', coordinates: pts } } : null
}

export function fenceGeoJson(zones: readonly FenceZone[]): FeatureCollection<Geometry, Props> {
  return { type: 'FeatureCollection', features: zones.flatMap((z, i) => zoneFeature(z, i) ?? []) }
}

function setup(m: MlMap): void {
  m.addSource(SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  const color = ['case', ['==', ['get', 'inc'], 1], OK, DANGER] as unknown as string
  // under the mission path so the route stays readable
  const below = m.getLayer('mission-path-casing') ? 'mission-path-casing' : undefined
  m.addLayer({ id: 'plan-fence-fill', type: 'fill', source: SOURCE, filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': color, 'fill-opacity': 0.18 } }, below)
  m.addLayer({ id: 'plan-fence-line', type: 'line', source: SOURCE, paint: { 'line-color': color, 'line-width': 2.5, 'line-opacity': 0.95 } }, below)
}

function handle(m: MlMap, cls: string, text: string, lng: number, lat: number, draggable: boolean, onEnd: (mk: Marker) => void): Marker {
  const el = document.createElement('div')
  el.className = cls
  el.textContent = text
  const mk = new maplibregl.Marker({ element: el, draggable, anchor: 'center' }).setLngLat([lng, lat]).addTo(m)
  mk.on('dragend', () => onEnd(mk))
  el.addEventListener('click', (e) => e.stopPropagation())
  return mk
}

interface Args {
  readonly map: RefObject<MlMap | null>
  readonly loaded: RefObject<boolean>
  readonly draft: Draft
  readonly tab: PlanTab
  readonly onFenceEdit: RefObject<(e: FenceEdit) => void>
  readonly onRallyMove: RefObject<(index: number, lat: number, lon: number) => void>
}

function fenceHandles(m: MlMap, zones: readonly FenceZone[], edit: (e: FenceEdit) => void): Marker[] {
  return zones.flatMap((z, zone) => {
    if (z.kind === 'polygon') {
      return z.vertices.map((v, index) =>
        handle(m, 'rg-fence-pt', '', v.lon, v.lat, true, (mk) => {
          const p = mk.getLngLat()
          edit({ kind: 'vertex', zone, index, lat: p.lat, lon: p.lng })
        }),
      )
    }
    const east = z.center.lon + z.radius / (M_PER_DEG_LON * Math.cos((z.center.lat * Math.PI) / 180))
    return [
      handle(m, 'rg-fence-pt center', '', z.center.lon, z.center.lat, true, (mk) => {
        const p = mk.getLngLat()
        edit({ kind: 'center', zone, lat: p.lat, lon: p.lng })
      }),
      handle(m, 'rg-fence-pt radius', '', east, z.center.lat, true, (mk) => {
        const p = mk.getLngLat()
        edit({ kind: 'radius', zone, radius: haversineM(z.center.lat, z.center.lon, p.lat, p.lng) })
      }),
    ]
  })
}

/** Zones, rally points and (per tab) their handles; rebuilt on every change (a few dozen markers). */
export function useFenceRally({ map, loaded, draft, tab, onFenceEdit, onRallyMove }: Args): void {
  const markers = useRef<Marker[]>([])
  const { fence, rally } = draft.mission
  useEffect(() => {
    const m = map.current
    if (!m) return
    const draw = () => {
      if (!m.getSource(SOURCE)) setup(m)
      const src = m.getSource(SOURCE) as { setData: (d: unknown) => void } | undefined
      src?.setData(fenceGeoJson(fence))
    }
    if (loaded.current) draw()
    else m.once('load', draw)
  }, [map, loaded, fence])

  useEffect(() => {
    const m = map.current
    if (!m) return
    markers.current.forEach((mk) => mk.remove())
    const rallyMarkers = rally.map((r, i) =>
      handle(m, 'rg-rally', 'R', r.lon, r.lat, tab === 'rally', (mk) => {
        const p = mk.getLngLat()
        onRallyMove.current(i, p.lat, p.lng)
      }),
    )
    const edit = (e: FenceEdit) => onFenceEdit.current(e)
    markers.current = [...rallyMarkers, ...(tab === 'fence' ? fenceHandles(m, fence, edit) : [])]
  }, [map, fence, rally, tab, onFenceEdit, onRallyMove])

  // the map's teardown takes the markers with it: the next map starts with none
  useEffect(
    () => () => {
      markers.current.forEach((mk) => mk.remove())
      markers.current = []
    },
    [],
  )
}
