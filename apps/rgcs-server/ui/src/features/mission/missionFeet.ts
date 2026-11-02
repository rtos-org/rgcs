// 3D position editing: a draggable foot on the ground under each positioned item (over the
// `mission-ground` disc). Dragging it changes only latitude / longitude; the altitude stays.
import maplibregl, { type Map as MlMap, type Marker } from 'maplibre-gl'
import { useEffect, useRef, type RefObject } from 'react'
import { dragDelta } from './mapEdit'
import { hasPosition, type LatLon } from './geo'
import { isTakeoff, surveyLocked, type Draft } from './model'

export interface FeetCallbacks {
  /** Live position while dragging; `onEnd` follows the drop. */
  readonly onPreview: (uid: number, multi: boolean, from: LatLon, to: LatLon) => void
  readonly onEnd: () => void
  readonly onMove: (uid: number, lat: number, lon: number) => void
  readonly onMoveSelected: (dLat: number, dLon: number) => void
  readonly onSelect: (uid: number, additive: boolean, range: boolean) => void
  /** The item's committed position: MapLibre has already moved the marker when `dragstart` fires. */
  readonly origin: (uid: number) => LatLon | null
}

interface Args {
  readonly map: RefObject<MlMap | null>
  readonly is3d: boolean
  readonly draft: Draft
  readonly selected: RefObject<ReadonlySet<number>>
  readonly cb: RefObject<FeetCallbacks>
}

export function footEl(): HTMLDivElement {
  const el = document.createElement('div')
  el.className = 'rg-foot'
  return el
}

function attachFoot(marker: Marker, el: HTMLElement, uid: number, { selected, cb }: Pick<Args, 'selected' | 'cb'>, dragging: Set<number>): void {
  let start: LatLon | null = null
  let multi = false
  const at = (): LatLon => {
    const p = marker.getLngLat()
    return { lat: p.lat, lon: p.lng }
  }
  marker.on('dragstart', () => {
    dragging.add(uid)
    start = cb.current.origin(uid) ?? at()
    multi = selected.current.has(uid) && selected.current.size > 1
  })
  marker.on('drag', () => {
    if (start) cb.current.onPreview(uid, multi, start, at())
  })
  marker.on('dragend', () => {
    const p = at()
    if (multi && start) {
      const d = dragDelta(start, p)
      cb.current.onMoveSelected(d.dLat, d.dLon)
    } else {
      cb.current.onMove(uid, p.lat, p.lon)
    }
    start = null
    dragging.delete(uid)
    cb.current.onEnd()
  })
  el.addEventListener('click', (e) => {
    e.stopPropagation()
    cb.current.onSelect(uid, e.metaKey || e.ctrlKey, e.shiftKey)
  })
}

/** One draggable foot per positioned item outside the surveys in 3D, none in 2D; reconciled in place. */
export function useMissionFeet({ map, is3d, draft, selected, cb }: Args): void {
  const feet = useRef(new Map<number, Marker>())
  const dragging = useRef(new Set<number>())
  useEffect(() => {
    const m = map.current
    if (!m) return
    // survey items move only with their survey
    const locked = surveyLocked(draft)
    const want = is3d ? draft.items.filter((it) => hasPosition(it) && !isTakeoff(it) && !locked.has(it.uid)) : []
    const seen = new Set(want.map((it) => it.uid))
    for (const [uid, f] of feet.current) {
      if (!seen.has(uid)) {
        // a removed marker never fires dragend: end its preview here
        if (dragging.current.delete(uid)) cb.current.onEnd()
        f.remove()
        feet.current.delete(uid)
      }
    }
    for (const it of want) {
      const f = feet.current.get(it.uid)
      if (f) {
        f.setLngLat([it.lon, it.lat])
        continue
      }
      const el = footEl()
      const marker = new maplibregl.Marker({ element: el, draggable: true, anchor: 'center' }).setLngLat([it.lon, it.lat]).addTo(m)
      attachFoot(marker, el, it.uid, { selected, cb }, dragging.current)
      feet.current.set(it.uid, marker)
    }
  }, [map, is3d, draft, selected, cb])
  // Unmount (and StrictMode's rehearsal): the next mount starts from no feet.
  useEffect(
    () => () => {
      feet.current.forEach((f) => f.remove())
      feet.current = new Map()
    },
    [],
  )
}
