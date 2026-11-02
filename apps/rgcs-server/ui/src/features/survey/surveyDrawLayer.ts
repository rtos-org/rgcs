// The survey area being drawn on the planner map: its outline and a draggable handle per vertex
// (the first one also closes the ring). The layers (`survey-draw-*`) are added only once a drawing starts.
import maplibregl, { type Map as MlMap } from 'maplibre-gl'
import type { Feature, FeatureCollection } from 'geojson'
import { useEffect, useRef, type RefObject } from 'react'
import type { LatLon } from '../mission/geo'

/** What the map needs while a survey area is drawn. */
export interface SurveyDrawMap {
  readonly ring: readonly LatLon[]
  /** A map click: the next vertex. */
  readonly onClick: (lat: number, lon: number) => void
  /** The first vertex was clicked: finish. */
  readonly onClose: () => void
  /** A vertex was dragged (live, every frame). */
  readonly onMove?: (index: number, lat: number, lon: number) => void
}

const SOURCE = 'survey-draw'
/** Surveys on the map (the area being drawn, then the survey layers). */
export const SURVEY_COLOR = '#ffd166'

export function drawGeoJson(ring: readonly LatLon[] | null): FeatureCollection {
  if (!ring || ring.length === 0) return { type: 'FeatureCollection', features: [] }
  const coords = ring.map((p) => [p.lon, p.lat])
  const outline: Feature[] = coords.length > 1 ? [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords.length > 2 ? [...coords, coords[0]!] : coords } }] : []
  const fill: Feature[] = coords.length > 2 ? [{ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[...coords, coords[0]!]] } }] : []
  return { type: 'FeatureCollection', features: [...fill, ...outline] }
}

function setup(m: MlMap): void {
  m.addSource(SOURCE, { type: 'geojson', data: drawGeoJson(null) })
  m.addLayer({ id: 'survey-draw-fill', type: 'fill', source: SOURCE, filter: ['==', ['geometry-type'], 'Polygon'], paint: { 'fill-color': SURVEY_COLOR, 'fill-opacity': 0.12 } })
  m.addLayer({ id: 'survey-draw-line', type: 'line', source: SOURCE, filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': SURVEY_COLOR, 'line-width': 2, 'line-dasharray': [2, 1.5] } })
}

interface Args {
  readonly map: RefObject<MlMap | null>
  readonly loaded: RefObject<boolean>
  readonly draw: SurveyDrawMap | null
}

export function useSurveyDrawLayer({ map, loaded, draw }: Args): void {
  const ring = draw?.ring ?? null
  useEffect(() => {
    const m = map.current
    if (!m || (!ring && !m.getSource(SOURCE))) return
    const paint = () => {
      if (!m.getSource(SOURCE)) setup(m)
      const src = m.getSource(SOURCE) as { setData: (d: unknown) => void } | undefined
      src?.setData(drawGeoJson(ring))
    }
    if (loaded.current) paint()
    else m.once('load', paint)
  }, [map, loaded, ring])

  useDrawHandles(map, draw)
}

interface Handle {
  readonly mk: maplibregl.Marker
  /** Set by a drag so the click that ends it does not close the ring. */
  moved: boolean
}

function makeHandle(m: MlMap, i: number, p: LatLon, draw: RefObject<SurveyDrawMap | null>): Handle {
  const el = document.createElement('div')
  el.className = i === 0 ? 'sv-vtx sv-draw-close' : 'sv-vtx'
  const mk = new maplibregl.Marker({ element: el, draggable: true, anchor: 'center' }).setLngLat([p.lon, p.lat]).addTo(m)
  const h: Handle = { mk, moved: false }
  mk.on('dragstart', () => {
    h.moved = true
  })
  mk.on('drag', () => {
    const ll = mk.getLngLat()
    draw.current?.onMove?.(i, ll.lat, ll.lng)
  })
  el.addEventListener('click', (e) => {
    e.stopPropagation()
    if (h.moved) {
      h.moved = false
      return
    }
    if (i === 0) draw.current?.onClose()
  })
  return h
}

/** One draggable handle per vertex of the area being drawn; the first one closes the ring. */
function useDrawHandles(map: RefObject<MlMap | null>, draw: SurveyDrawMap | null): void {
  const latest = useRef(draw)
  latest.current = draw
  const handles = useRef<Handle[]>([])
  const ring = draw?.ring ?? null
  useEffect(() => {
    const m = map.current
    if (!m) return
    const want = ring ?? []
    handles.current.slice(want.length).forEach((h) => h.mk.remove())
    handles.current = want.map((p, i) => {
      const h = handles.current[i]
      if (!h) return makeHandle(m, i, p, latest)
      h.mk.setLngLat([p.lon, p.lat])
      return h
    })
  }, [map, ring])
  useEffect(
    () => () => {
      handles.current.forEach((h) => h.mk.remove())
      handles.current = []
    },
    [],
  )
}
