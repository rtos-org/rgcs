// GPS ROI on the operations map: the selected vehicle's preset markers (`.rg-roi`,
// the active one `.on`) and the camera sight line (2D only, prototype line 1712 / 1821–1823).
import maplibregl, { type Map as MlMap, type Marker } from 'maplibre-gl'
import { useEffect, useRef, useState, type RefObject } from 'react'
import type { CameraSnapshot, RoiStatus, RoiTarget, VehicleState } from '../../shared/api/types'
import { orderLayers } from '../map/layers'
import { roiMarkerEl, sightGeoJson } from './roiMap'
import { isSet } from './schema'
import { useRoiTargets } from './targetsStore'

const SIGHT = 'sight'
const SIGHT_LAYERS = ['sight-casing', 'sight'] as const
/** The `.sq` is 16 px at the element's left edge: pull it back so its centre sits on the point. */
const ROI_OFFSET: [number, number] = [-7, 0]

interface Args {
  readonly map: RefObject<MlMap | null>
  readonly loaded: RefObject<boolean>
  readonly vehicles: ReadonlyMap<number, VehicleState>
  readonly cameras: ReadonlyMap<number, CameraSnapshot>
  readonly roi: ReadonlyMap<number, RoiStatus>
  readonly selected: number | null
  readonly is3d: boolean
}

function addSightLayers(m: MlMap): void {
  if (m.getSource(SIGHT)) return
  m.addSource(SIGHT, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
  m.addLayer({ id: 'sight-casing', type: 'line', source: SIGHT, paint: { 'line-color': '#0f1824', 'line-width': 5, 'line-opacity': 0.55 } })
  m.addLayer({ id: 'sight', type: 'line', source: SIGHT, paint: { 'line-color': '#5fd39b', 'line-width': 2.5, 'line-dasharray': [1.5, 1.5] } })
  orderLayers(m)
}

/** Adds the sight source and layers once the map has loaded; the map once they exist, else null. */
function useSightLayers(map: RefObject<MlMap | null>, loaded: RefObject<boolean>): MlMap | null {
  const [ready, setReady] = useState<MlMap | null>(null)
  useEffect(() => {
    const m = map.current
    if (!m) return
    const add = () => {
      addSightLayers(m)
      setReady(m)
    }
    if (loaded.current) add()
    else m.once('load', add)
    return () => setReady(null)
  }, [map, loaded])
  return ready
}

/** One marker per set preset of the selected vehicle, rebuilt when the presets change. */
function useRoiMarkers(m: MlMap | null, targets: readonly RoiTarget[], activeId: string | null): void {
  const markers = useRef<Marker[]>([])
  const activeRef = useRef(activeId)
  activeRef.current = activeId
  useEffect(() => {
    if (!m) return
    const built = targets.filter(isSet).map((t) => new maplibregl.Marker({ element: roiMarkerEl(t, t.id === activeRef.current), anchor: 'left', offset: ROI_OFFSET }).setLngLat([t.lon, t.lat]).addTo(m))
    markers.current = built
    return () => built.forEach((mk) => mk.remove())
  }, [m, targets])
  useEffect(() => {
    markers.current.forEach((mk) => {
      const el = mk.getElement()
      el.classList.toggle('on', el.dataset.id === activeId)
    })
  }, [activeId])
}

export function useRoiLayer({ map, loaded, vehicles, cameras, roi, selected, is3d }: Args): void {
  const targets = useRoiTargets(selected)
  const m = useSightLayers(map, loaded)
  const activeId = selected === null ? null : (roi.get(selected)?.active_target ?? null)
  useRoiMarkers(m, targets, activeId)

  useEffect(() => {
    if (!m) return
    SIGHT_LAYERS.forEach((id) => m.getLayer(id) && m.setLayoutProperty(id, 'visibility', is3d ? 'none' : 'visible'))
  }, [m, is3d])

  // Telemetry re-renders at ~10 Hz per vehicle: send the line only when it changed.
  const sent = useRef<{ m: MlMap | null; text: string }>({ m: null, text: '' })
  const active = activeId === null ? null : (targets.find((t) => t.id === activeId) ?? null)
  const data = sightGeoJson(selected === null ? undefined : vehicles.get(selected), selected === null ? undefined : cameras.get(selected), active)
  const text = JSON.stringify(data)
  useEffect(() => {
    if (!m || (sent.current.m === m && sent.current.text === text)) return
    sent.current = { m, text }
    const src = m.getSource(SIGHT) as { setData: (d: unknown) => void } | undefined
    src?.setData(JSON.parse(text))
  }, [m, text])
}
