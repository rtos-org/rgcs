// Surveys on the planner map: the `survey-*` layers (area, footprints, links, shooting sections,
// photo points) and, while editable, a draggable handle per polygon vertex plus the rotate handle.
// A drag previews (`done` false, once per move) and its release commits one undo step (`done` true).
import maplibregl, { type FilterSpecification, type Map as MlMap, type Marker } from 'maplibre-gl'
import { useEffect, useRef, useState, type RefObject } from 'react'
import type { LatLon } from '../mission/geo'
import type { Draft, DraftSurvey } from '../mission/model'
import type { SurveySpec } from './spec'
import { SURVEY_COLOR } from './surveyDrawLayer'
import { handleAngle, handlePoint, surveyFeatures, type SurveyCollection, type SurveyFeature, type SurveyFeatureKind, type SurveyShape } from './surveyGeo'

/** What MissionView hands the map for its surveys. */
export interface SurveyMapProps {
  readonly metrics: (id: string) => SurveyShape | null
  readonly onPolygon: (id: string, ring: readonly LatLon[], done: boolean) => void
  readonly onAngle: (id: string, deg: number, done: boolean) => void
  /** Ends a drag without a commit (its handle was removed mid-drag, so no release will come). */
  readonly onCancel: () => void
  readonly showFootprints: boolean
  /** A survey drag is being previewed: the map holds back per-frame work (mid-leg handles, the predicted line). */
  readonly previewing: boolean
}

interface Args extends SurveyMapProps {
  readonly map: RefObject<MlMap | null>
  readonly loaded: RefObject<boolean>
  /** The draft as shown (a drag preview applied). */
  readonly draft: Draft
  /** Vertex / rotate handles (mission tab, not drawing). */
  readonly editable: boolean
  /** In 3D the mission path is drawn at altitude: the flat flight lines hide, the area stays draped. */
  readonly is3d: boolean
}

const SOURCE = 'survey'
const FOOT = 'survey-foot'
/** Flat lines that 3D replaces (the air layer drapes the outline and draws the path at altitude). */
const FLAT = ['survey-area-line', 'survey-link', 'survey-shoot', 'survey-photo']
const PHOTO_MIN_ZOOM = 16
const EMPTY: SurveyCollection = { type: 'FeatureCollection', features: [] }

const only = (kind: SurveyFeatureKind): FilterSpecification => ['==', ['get', 'kind'], kind]

function setup(m: MlMap): void {
  m.addSource(SOURCE, { type: 'geojson', data: EMPTY })
  // the area and footprints under the mission path; the survey's own legs over it
  const under = m.getLayer('mission-path-casing') ? 'mission-path-casing' : undefined
  const over = m.getLayer('mission-predicted-line') ? 'mission-predicted-line' : undefined
  const c = SURVEY_COLOR
  m.addLayer({ id: 'survey-area-fill', type: 'fill', source: SOURCE, filter: only('area'), paint: { 'fill-color': c, 'fill-opacity': 0.08 } }, under)
  m.addLayer({ id: FOOT, type: 'line', source: SOURCE, filter: only('foot'), layout: { visibility: 'none' }, paint: { 'line-color': c, 'line-width': 1, 'line-opacity': 0.4 } }, under)
  m.addLayer({ id: 'survey-area-line', type: 'line', source: SOURCE, filter: only('area'), paint: { 'line-color': c, 'line-width': 2, 'line-opacity': 0.9 } }, under)
  m.addLayer({ id: 'survey-link', type: 'line', source: SOURCE, filter: only('link'), layout: { 'line-join': 'round' }, paint: { 'line-color': c, 'line-width': 1.5, 'line-dasharray': [3, 2] } }, over)
  m.addLayer({ id: 'survey-shoot', type: 'line', source: SOURCE, filter: only('shoot'), layout: { 'line-cap': 'round' }, paint: { 'line-color': c, 'line-width': 4 } }, over)
  m.addLayer({ id: 'survey-photo', type: 'circle', source: SOURCE, filter: only('photo'), minzoom: PHOTO_MIN_ZOOM, paint: { 'circle-radius': 2.5, 'circle-color': '#ffffff', 'circle-stroke-color': '#0b1b2e', 'circle-stroke-width': 1 } }, over)
}

function setVisibility(m: MlMap, is3d: boolean, showFootprints: boolean): void {
  const vis = (id: string, on: boolean) => m.getLayer(id) && m.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none')
  FLAT.forEach((id) => vis(id, !is3d))
  vis(FOOT, showFootprints)
}

/** Features per survey spec, rebuilt only when its spec or generated shape changes. */
const built = new WeakMap<SurveySpec, { shape: SurveyShape | null; features: SurveyFeature[] }>()

function featuresOf(s: DraftSurvey, shape: SurveyShape | null): SurveyFeature[] {
  const hit = built.get(s.spec)
  if (hit && hit.shape === shape) return hit.features
  const features = surveyFeatures(s.id, s.spec, shape)
  built.set(s.spec, { shape, features })
  return features
}

const samePieces = (a: readonly SurveyFeature[][], b: readonly SurveyFeature[][]) => a.length === b.length && a.every((p, i) => p === b[i])

interface Spot {
  readonly key: string
  readonly cls: 'sv-vtx' | 'sv-rot'
  readonly at: LatLon
  /** Sends the marker's position as a preview or a commit. */
  readonly send: (p: LatLon, done: boolean) => void
}

type Senders = Pick<SurveyMapProps, 'onPolygon' | 'onAngle' | 'onCancel'>

/** Where the handles go; `latest` gives the survey as shown when a drag reports. */
function spots(surveys: readonly DraftSurvey[], latest: () => readonly DraftSurvey[], cb: RefObject<Senders>): Spot[] {
  const ring = (id: string) => latest().find((s) => s.id === id)?.spec.polygon ?? []
  return surveys.flatMap((s) => {
    const vertices = s.spec.polygon.map((at, i) => ({
      key: `v:${s.id}:${i}`,
      cls: 'sv-vtx' as const,
      at,
      send: (p: LatLon, done: boolean) => cb.current.onPolygon(s.id, ring(s.id).map((q, j) => (j === i ? p : q)), done),
    }))
    const h = handlePoint(s.spec.polygon, s.spec.angleDeg)
    const rotate = h ? [{ key: `h:${s.id}`, cls: 'sv-rot' as const, at: h, send: (p: LatLon, done: boolean) => cb.current.onAngle(s.id, handleAngle(ring(s.id), p), done) }] : []
    return [...vertices, ...rotate]
  })
}

function makeMarker(m: MlMap, spot: Spot, dragging: { current: string | null }, sendRef: RefObject<Map<string, Spot['send']>>): Marker {
  const el = document.createElement('div')
  el.className = spot.cls
  el.addEventListener('click', (e) => e.stopPropagation())
  const mk = new maplibregl.Marker({ element: el, draggable: true, anchor: 'center' }).setLngLat([spot.at.lon, spot.at.lat]).addTo(m)
  const send = (done: boolean) => {
    const p = mk.getLngLat()
    sendRef.current.get(spot.key)?.({ lat: p.lat, lon: p.lng }, done)
  }
  mk.on('dragstart', () => (dragging.current = spot.key))
  mk.on('drag', () => send(false))
  mk.on('dragend', () => {
    // a marker removed mid-drag has had its drag ended already
    if (dragging.current !== spot.key) return
    dragging.current = null
    send(true)
  })
  return mk
}

/** Vertex and rotate handles, reconciled in place (a dragged one is left where the pointer has it). */
function useEditHandles(map: RefObject<MlMap | null>, surveys: readonly DraftSurvey[], editable: boolean, cb: Senders): void {
  const marks = useRef(new Map<string, Marker>())
  const dragging = useRef<string | null>(null)
  const latest = useRef(surveys)
  const senders = useRef(cb)
  // a drag reports against the survey as last shown, to the latest callbacks
  useEffect(() => {
    latest.current = surveys
    senders.current = cb
  })
  const sendRef = useRef(new Map<string, Spot['send']>())
  useEffect(() => {
    const m = map.current
    if (!m) return
    const want = editable ? spots(surveys, () => latest.current, senders) : []
    sendRef.current = new Map(want.map((s) => [s.key, s.send]))
    const keep = new Set(want.map((s) => s.key))
    for (const [key, mk] of marks.current) if (!keep.has(key)) drop(key, mk)
    marks.current = new Map(
      want.map((s) => {
        const mk = marks.current.get(s.key)
        if (mk && s.key !== dragging.current) mk.setLngLat([s.at.lon, s.at.lat])
        return [s.key, mk ?? makeMarker(m, s, dragging, sendRef)]
      }),
    )
  }, [map, surveys, editable])
  /** Removes a marker; one being dragged will never report its release, so its drag ends here. */
  function drop(key: string, mk: Marker): void {
    mk.remove()
    if (key !== dragging.current) return
    dragging.current = null
    senders.current.onCancel()
  }
  useEffect(
    () => () => {
      marks.current.forEach((mk, key) => drop(key, mk))
      marks.current = new Map()
    },
    [],
  )
}

export function useSurveyMap({ map, loaded, draft, metrics, onPolygon, onAngle, onCancel, showFootprints, editable, is3d }: Args): void {
  const pieces = draft.surveys.map((s) => featuresOf(s, metrics(s.id)))
  const sent = useRef<readonly SurveyFeature[][] | null>(null)
  const paint = useRef(() => {})
  useEffect(() => {
    const m = map.current
    if (!m) return
    paint.current = () => {
      if (pieces.length === 0 && !m.getSource(SOURCE)) return
      if (!m.getSource(SOURCE)) setup(m)
      if (!sent.current || !samePieces(pieces, sent.current)) {
        const fc: SurveyCollection = { type: 'FeatureCollection', features: pieces.flat() }
        ;(m.getSource(SOURCE) as { setData: (d: unknown) => void } | undefined)?.setData(fc)
        sent.current = pieces
      }
      setVisibility(m, is3d, showFootprints)
    }
    if (loaded.current) paint.current()
  })
  // a draft that exists before the style has loaded is drawn once it has
  useEffect(() => {
    const m = map.current
    if (m && !loaded.current) m.once('load', () => paint.current())
  }, [map, loaded])
  useEditHandles(map, draft.surveys, editable, { onPolygon, onAngle, onCancel })
}

/** `value`, except that while `hold` is set the value from before the hold is kept. */
export function useSettled<T>(value: T, hold: boolean): T {
  const [kept, setKept] = useState(value)
  if (!hold && kept !== value) setKept(value)
  return hold ? kept : value
}
