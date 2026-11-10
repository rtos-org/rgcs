import maplibregl, { type ExpressionSpecification, type Map as MlMap, type Marker, type StyleSpecification } from 'maplibre-gl'
import type { DemEncoding } from '../map/terrain'
import type { FeatureCollection } from 'geojson'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { VehicleState } from '../../shared/api/types'
import { hasPosition as vehicleHasPosition, markerEl, updateMarkerEl } from '../map/markers'
import { hasPosition, pathGeoJson, placeTakeoffs, takeoffAnchor } from './geo'
import { badgeEl, dragDelta, handleEl, midHandles, updateBadgeEl, type ContextMenu } from './mapEdit'
import { cmdKey, emptyDraft, isTakeoff, moveItem, moveItems, setArc, shiftAlts, type Draft, type DraftItem } from './model'
import type { Tool } from './store'
import { useBasemapSwap } from '../map/basemaps'
import { useOverlays } from '../overlays/useOverlays'
import { addPredictedLayer, setPredicted } from '../map/predictedLayer'
import type { Basemap } from '../../shared/api/types'
import { KEEP_ELEVATION, MAX_PITCH, type MapMode } from '../map/mapMode'
import { altChip, useMissionAir, type MissionAir3d, type Predicted } from './missionAir'
import { attachAltDrag } from './altDrag'
import { useMissionFeet, type FeetCallbacks } from './missionFeet'
import { surveyBadges } from './surveyBadges'
import { useBoxSelect } from './boxSelect'
import { attachArcDrag } from './arcDrag'
import { useFenceRally, type FenceEdit, type PlanTab } from './fenceMap'
import type { OtherMission } from '../plans/overlay'
import { usePlanSetOverlay } from '../plans/usePlanSetOverlay'
import { useSurveyDrawLayer, type SurveyDrawMap } from '../survey/surveyDrawLayer'
import { useSettled, useSurveyMap, type SurveyMapProps } from '../survey/surveyMap'
import type { AssignOverlayInput } from '../assign/assignOverlay'
import { useAssignOverlay } from '../assign/useAssignOverlay'

interface Props {
  readonly draft: Draft
  readonly selected: ReadonlySet<number>
  readonly tool: Tool
  readonly style: StyleSpecification
  /** The picked base map; a change swaps the base tiles in place. */
  readonly basemap?: Basemap
  /** 2D / 3D; 3D needs `terrainTiles`. */
  readonly mode?: MapMode
  readonly terrainTiles?: string | null
  readonly terrainEncoding?: DemEncoding
  readonly vehicle: VehicleState | null
  /** Bump to fit the view to the mission (after loading / importing). */
  readonly fitRequest: number
  readonly onAdd: (lat: number, lon: number) => void
  readonly onInsertAfter: (uid: number, lat: number, lon: number) => void
  readonly onMove: (uid: number, lat: number, lon: number) => void
  readonly onMoveSelected: (dLat: number, dLon: number) => void
  /** 3D altitude drag: add `dAlt` metres to these items. */
  readonly onShiftAlt: (uids: ReadonlySet<number>, dAlt: number) => void
  /** Shift-drag box on the map: these items join the selection. */
  readonly onBoxSelect: (uids: number[]) => void
  /** Long press + drag on a "+": the leg into `uid` becomes an arc of `angle`° (0 = straight). */
  readonly onArc: (uid: number, angle: number) => void
  /** Mission / Fence / Rally: only the mission tab edits waypoints. */
  readonly tab?: PlanTab
  /** A map click in the fence or rally tab. */
  readonly onPlanClick: (tab: Exclude<PlanTab, 'mission'>, lat: number, lon: number) => void
  readonly onFenceEdit: (e: FenceEdit) => void
  readonly onRallyMove: (index: number, lat: number, lon: number) => void
  /** FENCE_ALT_MAX (m above home): the 3D fence walls reach it; null = no walls. */
  readonly ceiling?: number | null
  /** Frame these points (a fence / rally file just loaded); a new `seq` repeats it. */
  readonly fitTo?: { readonly seq: number; readonly points: readonly { readonly lat: number; readonly lon: number }[] } | null
  /** Move the view here (place search, 機体の位置へ); a new `seq` repeats the move. */
  readonly focus?: { readonly lat: number; readonly lon: number; readonly seq: number } | null
  /** The path the target vehicle is expected to fly for a draft (null = not predicted for it). */
  readonly predict?: ((d: Draft) => Predicted | null) | undefined
  readonly onSelect: (uid: number, additive: boolean, range: boolean) => void
  readonly onBackgroundClick: () => void
  readonly onContext: (menu: ContextMenu | null) => void
  /** The other open plans: drawn dimmed in their colours, not interactive. */
  readonly others?: readonly OtherMission[]
  /** The mission's row colour: its 2D and 3D path lines (absent: the altitude gradient). */
  readonly pathColor?: string
  /** The right panel is folded to its rail: fits use the space it freed. */
  readonly panelCollapsed?: boolean
  /** A survey area is being drawn: map clicks add its vertices instead of waypoints. */
  readonly surveyDraw?: SurveyDrawMap | null
  /** The surveys' layers and their vertex / rotate drags. */
  readonly survey?: SurveyMapProps | null
  /** The assignment board: its overlay replaces the active plan, nothing is edited. */
  readonly assign?: AssignOverlayInput | null
}

const HOME: [number, number] = [138.48029, 35.481883]
const FOCUS_ZOOM = 16
/** Fits keep clear of the floating panels (left list, right editor, top bar, bottom summary). */
const FIT_PADDING = { top: 100, bottom: 110, left: 380, right: 400 }
/** The same with the right panel folded to its 44 px rail. */
const FIT_PADDING_RAIL = { ...FIT_PADDING, right: 84 }
/** The `.vmk` disc centre on the position (34 px disc at the element's left edge). */
const VEHICLE_OFFSET = [-17, 0] as const
const PATH = 'mission-path'
const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] }
const NO_OTHERS: readonly OtherMission[] = []
/** What the editing layers draw while the board is open: nothing. */
const BLANK = emptyDraft()
const NO_SURVEY: SurveyMapProps = { metrics: () => null, onPolygon: () => {}, onAngle: () => {}, onCancel: () => {}, showFootprints: false, previewing: false }
/** `--accent` → `--alt-hi` (the path is coloured by altitude). */
const ALT_COLOR: ExpressionSpecification = ['interpolate', ['linear'], ['get', 'alt_t'], 0, '#9cc9ff', 1, '#d8a8ff']

interface Badge {
  readonly marker: Marker
  readonly el: HTMLDivElement
}

type Callbacks = Omit<Props, 'draft' | 'selected' | 'tool' | 'style' | 'basemap' | 'vehicle' | 'fitRequest' | 'mode' | 'terrainTiles' | 'terrainEncoding' | 'tab' | 'ceiling' | 'predict' | 'focus' | 'fitTo' | 'others' | 'pathColor' | 'panelCollapsed' | 'survey'>

/** Mission editing map (2D, and 3D with altitude / position drags): path, draggable badges, mid-leg inserts. */
export function MissionMap(props: Props) {
  const { selected, tool, style, fitRequest } = props
  const assign = props.assign ?? null
  const [draft, vehicle, others] = assign ? [BLANK, null, NO_OTHERS] : [props.draft, props.vehicle, props.others ?? NO_OTHERS]
  const tab = props.tab ?? 'mission'
  const tabRef = useRef(tab)
  tabRef.current = tab
  // while a survey area is drawn the waypoints stay put: no drags, mid-leg inserts or box select
  const drawing = (props.surveyDraw ?? null) !== null
  // a survey drag previews every frame: mid-leg handles and the predicted line wait for its release
  const previewing = props.survey?.previewing ?? false
  const container = useRef<HTMLDivElement>(null)
  const map = useRef<MlMap | null>(null)
  const loaded = useRef(false)
  useBasemapSwap(map, loaded, props.basemap)
  const badges = useRef(new Map<number, Badge>())
  const handles = useRef<{ marker: Marker; toUid: number }[]>([])
  const vehicleMarker = useRef<Badge | null>(null)
  /** The vehicle the view last opened over (null: none yet / the map was rebuilt). */
  const centredOn = useRef<number | null>(null)
  const cb = useRef<Callbacks>(props)
  cb.current = props
  const toolRef = useRef(tool)
  toolRef.current = tool
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  const draftRef = useRef(draft)
  draftRef.current = draft
  // A drag in progress shows its result before it is committed to the draft (and the undo history).
  const [preview, setPreview] = useState<((d: Draft) => Draft) | null>(null)
  // the takeoff has no coordinates: it is drawn above the home (the plan's, else the vehicle's)
  const anchor = takeoffAnchor(draft.mission.home, vehicle)
  const [aLat, aLon] = [anchor?.lat, anchor?.lon]
  const shown = useMemo(() => {
    const d = preview ? preview(draft) : draft
    return aLat === undefined || aLon === undefined ? d : { ...d, items: placeTakeoffs(d.items, { lat: aLat, lon: aLon }) }
  }, [draft, preview, aLat, aLon])
  const air = useRef<MissionAir3d>({ is3d: false, pxPerMetre: () => null, floatVehicle: () => {} })

  useEffect(() => {
    if (!container.current) return
    const m = new maplibregl.Map({ container: container.current, style, center: HOME, zoom: 14, maxPitch: MAX_PITCH, attributionControl: { compact: true }, boxZoom: false })
    m.addControl(new maplibregl.NavigationControl({ showZoom: false, visualizePitch: false }), 'top-right')
    m.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-right')
    m.on('load', () => {
      m.addSource(PATH, { type: 'geojson', data: EMPTY })
      m.addLayer({ id: 'mission-path-casing', type: 'line', source: PATH, paint: { 'line-color': '#0b1b2e', 'line-width': 6, 'line-opacity': 0.6 } })
      m.addLayer({ id: 'mission-path-line', type: 'line', source: PATH, paint: { 'line-color': pathColorRef.current ?? ALT_COLOR, 'line-width': 3 } })
      // the expected flight (loiter circles, cut corners): thin, dashed and translucent over the plan
      addPredictedLayer(m, predictedRef.current)
      loaded.current = true
      // The draft may already exist (store is global): draw it as soon as the style is ready.
      const src = m.getSource(PATH) as { setData: (d: unknown) => void } | undefined
      src?.setData(pathGeoJson(draftRef.current.items, draftRef.current.mission.home))
    })
    m.on('click', (e) => {
      const t = tabRef.current
      if (cb.current.assign) return
      if (t !== 'mission') return cb.current.onPlanClick(t, e.lngLat.lat, e.lngLat.lng)
      if (cb.current.surveyDraw) return cb.current.surveyDraw.onClick(e.lngLat.lat, e.lngLat.lng)
      if (toolRef.current === 'add') cb.current.onAdd(e.lngLat.lat, e.lngLat.lng)
      else cb.current.onBackgroundClick()
      cb.current.onContext(null)
    })
    map.current = m
    // Live checks read the camera from the dev build only (like `__rgcsMap` on the operations map).
    if (import.meta.env.DEV) (window as unknown as { __rgcsMissionMap?: MlMap }).__rgcsMissionMap = m
    return () => {
      m.remove()
      map.current = null
      loaded.current = false
      badges.current = new Map()
      handles.current = []
      vehicleMarker.current = null
      centredOn.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // after the map exists (effects run in declaration order)
  useOverlays(map, loaded, 'plan')
  const is3d = props.mode === '3d' && (props.terrainTiles ?? null) !== null
  const pathColor = props.pathColor
  const pathColorRef = useRef(pathColor)
  pathColorRef.current = pathColor
  useEffect(() => {
    if (loaded.current) map.current?.setPaintProperty('mission-path-line', 'line-color', pathColor ?? ALT_COLOR)
  }, [pathColor])
  const fitPadding = props.panelCollapsed ? FIT_PADDING_RAIL : FIT_PADDING

  // Path
  useEffect(() => {
    if (!loaded.current) return
    const src = map.current?.getSource(PATH) as { setData: (d: unknown) => void } | undefined
    src?.setData(pathGeoJson(shown.items, shown.mission.home))
  }, [shown])

  const predict = assign ? undefined : props.predict
  const settled = useSettled(shown, previewing)
  const predicted = useMemo(() => (predict ? predict(settled) : null), [predict, settled])
  const predictedRef = useRef(predicted)
  predictedRef.current = predicted
  useEffect(() => {
    if (!loaded.current) return
    setPredicted(map.current, predicted)
  }, [predicted])

  // Badges (one per positioned item), reconciled in place
  useEffect(() => {
    const m = map.current
    if (!m) return
    const seen = new Set<number>()
    // 3D moves position with the ground foot; the TAKEOFF never moves (ArduCopter climbs in place); survey items only through the survey
    const sv = surveyBadges(shown, selected)
    const movable = (it: DraftItem) => tab === 'mission' && !is3d && !drawing && !isTakeoff(it) && !sv.locked.has(it.uid)
    shown.items.forEach((it, i) => {
      if (!hasPosition(it) || sv.hidden.has(it.uid)) return
      seen.add(it.uid)
      const seq = i + 1
      const existing = badges.current.get(it.uid)
      if (existing) {
        existing.marker.setLngLat([it.lon, it.lat]).setDraggable(movable(it))
        updateBadgeEl(existing.el, seq, selected.has(it.uid), cmdKey(it), is3d ? altChip(it) : null)
        return
      }
      const el = updateBadgeEl(badgeEl(seq, selected.has(it.uid), cmdKey(it)), seq, selected.has(it.uid), cmdKey(it), is3d ? altChip(it) : null)
      const marker = new maplibregl.Marker({ element: el, draggable: movable(it), anchor: 'center' }).setLngLat([it.lon, it.lat]).addTo(m)
      attachBadge(marker, el, it.uid, cb, selectedRef, draftRef)
      attachAltDrag(el, altDeps(it.uid))
      badges.current.set(it.uid, { marker, el })
    })
    for (const [uid, b] of badges.current) {
      if (!seen.has(uid)) {
        b.marker.remove()
        badges.current.delete(uid)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, selected, is3d, tab, drawing])

  // Mid-leg handles are rebuilt on every draft change (cheap: ≤ 700)
  useEffect(() => {
    const m = map.current
    if (!m) return
    handles.current.forEach((h) => h.marker.remove())
    handles.current = (drawing || previewing ? [] : midHandles(draft)).map((h) => {
      const el = handleEl()
      el.addEventListener('click', (e) => {
        e.stopPropagation()
        cb.current.onInsertAfter(h.afterUid, h.lat, h.lon)
      })
      attachArcDrag(el, h, arcDeps)
      return { marker: new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([h.lon, h.lat]).addTo(m), toUid: h.toUid }
    })
    // arcDeps only reads refs and setPreview: the handles need rebuilding for a new draft only
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, drawing, previewing])

  // After the map, the badges and the handles exist: effects run in declaration order.
  air.current = useMissionAir({ map, loaded, mode: props.mode ?? '2d', terrainTiles: props.terrainTiles ?? null, terrainEncoding: props.terrainEncoding, draft: shown, selected, badges, handles, ceiling: props.ceiling ?? null, vehicleHome: vehicleHomeOf(vehicle), predicted, others, color: pathColor ?? null })
  const feetCb = useRef<FeetCallbacks>(null!)
  feetCb.current = {
    onPreview: (uid, multi, from, to) => setPreview(() => (d: Draft) => (multi ? moveItems(d, selectedRef.current, to.lat - from.lat, to.lon - from.lon) : moveItem(d, uid, to.lat, to.lon))),
    onEnd: () => setPreview(null),
    onMove: (uid, lat, lon) => cb.current.onMove(uid, lat, lon),
    onMoveSelected: (dLat, dLon) => cb.current.onMoveSelected(dLat, dLon),
    onSelect: (uid, additive, range) => cb.current.onSelect(uid, additive, range),
    origin: (uid) => itemPos(draftRef.current, uid),
  }
  // a drag cut short by the 2D / 3D switch never reports its end
  useEffect(() => setPreview(null), [is3d])
  useMissionFeet({ map, is3d: is3d && !drawing, draft: shown, selected: selectedRef, cb: feetCb })
  const onFenceEdit = useRef((e: FenceEdit) => cb.current.onFenceEdit(e))
  const onRallyMove = useRef((i: number, lat: number, lon: number) => cb.current.onRallyMove(i, lat, lon))
  useFenceRally({ map, loaded, draft: shown, tab, onFenceEdit, onRallyMove })
  const onBox = useRef((uids: number[]) => cb.current.onBoxSelect(uids))
  const boxActive = useRef(tab === 'mission')
  boxActive.current = tab === 'mission' && !drawing && !assign
  useBoxSelect(container, badges, onBox, boxActive)
  usePlanSetOverlay({ map, loaded, others: others, is3d })
  useAssignOverlay({ map, loaded, assign })
  useSurveyDrawLayer({ map, loaded, draw: props.surveyDraw ?? null })
  useSurveyMap({ map, loaded, draft: shown, is3d, editable: tab === 'mission' && !drawing, ...(props.survey ?? NO_SURVEY) })

  // The selected vehicle, for context
  useEffect(() => {
    const m = map.current
    if (!m) return
    if (!vehicle || !vehicleHasPosition(vehicle)) {
      vehicleMarker.current?.marker.remove()
      vehicleMarker.current = null
      air.current.floatVehicle(null, null, VEHICLE_OFFSET)
      return
    }
    // The planner opens over the target vehicle, and moves over another one when the target changes
    // (2026-10-20); the vehicle flying about afterwards leaves the view alone.
    if (centredOn.current !== vehicle.sysid) {
      centredOn.current = vehicle.sysid
      m.jumpTo({ center: [vehicle.lon, vehicle.lat] })
    }
    if (vehicleMarker.current) {
      vehicleMarker.current.marker.setLngLat([vehicle.lon, vehicle.lat])
      updateMarkerEl(vehicleMarker.current.el, vehicle, false)
    } else {
      const el = markerEl(vehicle, false)
      const marker = new maplibregl.Marker({ element: el, anchor: 'left', offset: [...VEHICLE_OFFSET] }).setLngLat([vehicle.lon, vehicle.lat]).addTo(m)
      vehicleMarker.current = { marker, el }
    }
    air.current.floatVehicle(vehicleMarker.current.marker, vehicle, VEHICLE_OFFSET)
  }, [vehicle])

  // Place search / 機体の位置へ
  const focusSeq = props.focus?.seq ?? 0
  useEffect(() => {
    const f = props.focus
    if (!map.current || !f) return
    map.current.jumpTo({ center: [f.lon, f.lat], zoom: FOCUS_ZOOM })
    // only a new request moves the view
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusSeq])

  const fitSeq = props.fitTo?.seq ?? 0
  useEffect(() => {
    const m = map.current
    const pts = props.fitTo?.points ?? []
    if (!m || pts.length === 0) return
    if (pts.length === 1) {
      m.jumpTo({ center: [pts[0]!.lon, pts[0]!.lat], zoom: FOCUS_ZOOM })
      return
    }
    const bounds = pts.reduce((b, p) => b.extend([p.lon, p.lat]), new maplibregl.LngLatBounds([pts[0]!.lon, pts[0]!.lat], [pts[0]!.lon, pts[0]!.lat]))
    m.fitBounds(bounds, { padding: fitPadding, maxZoom: 17, duration: 300, ...KEEP_ELEVATION })
    // only a new request moves the view
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitSeq])

  useEffect(() => {
    const m = map.current
    if (!m || fitRequest === 0) return
    const pts = draft.items.filter(hasPosition)
    if (pts.length === 0) return
    const bounds = pts.reduce((b, it) => b.extend([it.lon, it.lat]), new maplibregl.LngLatBounds([pts[0]!.lon, pts[0]!.lat], [pts[0]!.lon, pts[0]!.lat]))
    m.fitBounds(bounds, { padding: fitPadding, maxZoom: 17, duration: 300, ...KEEP_ELEVATION })
    // Only the request counter triggers a fit; the draft is read at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitRequest])

  const arcDeps = {
    toLatLon: (x: number, y: number) => {
      const m = map.current
      const box = container.current?.getBoundingClientRect()
      if (!m || !box) return null
      const p = m.unproject([x - box.left, y - box.top])
      return { lat: p.lat, lon: p.lng }
    },
    end: (uid: number) => {
      const it = draftRef.current.items.find((x) => x.uid === uid)
      return it ? { lat: it.lat, lon: it.lon } : null
    },
    onPreview: (uid: number, angle: number) => setPreview(() => (d: Draft) => setArc(d, uid, angle)),
    onCommit: (uid: number, angle: number) => {
      setPreview(null)
      cb.current.onArc(uid, angle)
    },
    onCancel: () => setPreview(null),
  }

  function altDeps(uid: number) {
    return {
      active: () => air.current.is3d && !cb.current.surveyDraw,
      targets: () => (selectedRef.current.has(uid) && selectedRef.current.size > 1 ? selectedRef.current : new Set([uid])),
      alt: () => draftRef.current.items.find((x) => x.uid === uid)?.alt ?? 0,
      pxPerMetre: () => air.current.pxPerMetre(uid),
      onPreview: (uids: ReadonlySet<number>, dAlt: number) => setPreview(() => (d: Draft) => shiftAlts(d, uids, dAlt)),
      onCommit: (uids: ReadonlySet<number>, dAlt: number) => {
        setPreview(null)
        if (dAlt !== 0) cb.current.onShiftAlt(uids, dAlt)
      },
    }
  }

  return <div ref={container} className={`map mission-map tool-${tool} tab-${tab}${is3d ? ' is-3d' : ''}`} data-testid="mission-map" />
}

/** The vehicle's home (else its position): where FENCE_ALT_MAX is measured from. */
function vehicleHomeOf(v: VehicleState | null): { lat: number; lon: number } | null {
  if (!v) return null
  if (v.home && !(v.home.lat === 0 && v.home.lon === 0)) return { lat: v.home.lat, lon: v.home.lon }
  return v.lat === 0 && v.lon === 0 ? null : { lat: v.lat, lon: v.lon }
}

function itemPos(d: Draft, uid: number): { lat: number; lon: number } | null {
  const it = d.items.find((x) => x.uid === uid)
  return it ? { lat: it.lat, lon: it.lon } : null
}

function attachBadge(marker: Marker, el: HTMLDivElement, uid: number, cb: React.RefObject<Callbacks>, selected: React.RefObject<ReadonlySet<number>>, draft: React.RefObject<Draft>): void {
  let start: { lat: number; lon: number } | null = null
  let multi = false
  marker.on('dragstart', () => {
    // MapLibre has already moved the marker by the first step: count from the item itself
    const p = marker.getLngLat()
    start = itemPos(draft.current, uid) ?? { lat: p.lat, lon: p.lng }
    multi = selected.current.has(uid) && selected.current.size > 1
  })
  marker.on('dragend', () => {
    const p = marker.getLngLat()
    if (multi && start) {
      const d = dragDelta(start, { lat: p.lat, lon: p.lng })
      cb.current.onMoveSelected(d.dLat, d.dLon)
    } else {
      cb.current.onMove(uid, p.lat, p.lng)
    }
    start = null
  })
  el.addEventListener('click', (e) => {
    e.stopPropagation()
    const p = itemPos(draft.current, uid)
    // drawing a survey area: a waypoint is a vertex there
    if (cb.current.surveyDraw) return p && cb.current.surveyDraw.onClick(p.lat, p.lon)
    cb.current.onSelect(uid, e.metaKey || e.ctrlKey, e.shiftKey)
  })
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault()
    e.stopPropagation()
    if (!cb.current.surveyDraw) cb.current.onContext({ uid, x: e.clientX, y: e.clientY })
  })
}
