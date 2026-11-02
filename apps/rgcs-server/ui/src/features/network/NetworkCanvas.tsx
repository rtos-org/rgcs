// The network infinite canvas (10 §8, prototype `renderNet` / `netApply` / `netBind`): one SVG world
// under a pan / zoom transform (6–250 %), level of detail at 55 % / 28 %, fit, and select-and-dim.
// The view transform is client-only (10 §9); fit runs on mount and when the vehicle set changes.
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import type { Dict } from '../../shared/i18n'
import { IconMinus, IconPlus, IconScan } from '../../shared/ui/icons'
import type { NetGraph } from './graph'
import { layoutNetwork } from './layout'
import { NetworkWorld } from './NetworkWorld'
import { related } from './relations'
import { useCanvasGestures } from './useCanvasGestures'
import { fitView, lodFor, panBy, zoomAt, type View } from './viewport'

export interface NetworkCanvasProps {
  readonly graph: NetGraph
  readonly selected: string
  readonly onSelect: (id: string) => void
  readonly dict: Dict
}

const BUTTON_ZOOM_IN = 1.25, BUTTON_ZOOM_OUT = 0.8
const FALLBACK_W = 1000, FALLBACK_H = 600

const size = (el: HTMLElement | null): readonly [number, number] => [el?.clientWidth || FALLBACK_W, el?.clientHeight || FALLBACK_H]

/** The id a click selects: the element under the pointer, the server for the site card or empty canvas. */
function clickedId(target: EventTarget): string {
  const id = target instanceof Element ? target.closest('[data-id]')?.getAttribute('data-id') : null
  return id === null || id === undefined || id.startsWith('site:') ? 'server' : id
}

export function NetworkCanvas({ graph, selected, onSelect, dict }: NetworkCanvasProps) {
  const mapRef = useRef<HTMLDivElement>(null)
  const layout = useMemo(() => layoutNetwork(graph), [graph])
  const [view, setView] = useState<View>({ k: 1, tx: 0, ty: 0 })
  const fit = useCallback(() => {
    const [cw, ch] = size(mapRef.current)
    setView(fitView(cw, ch, layout.W, layout.H))
  }, [layout.W, layout.H])
  const fitRef = useRef(fit)
  useLayoutEffect(() => {
    fitRef.current = fit
  })
  const vehicleKey = graph.vehicles.map((v) => v.sysid).join(',')
  useLayoutEffect(() => fitRef.current(), [vehicleKey])

  const zoom = useCallback((f: number, px: number, py: number) => setView((v) => zoomAt(v, f, px, py)), [])
  const pan = useCallback((dx: number, dy: number) => setView((v) => panBy(v, dx, dy)), [])
  const gestures = useCanvasGestures(mapRef, { pan, zoom })
  const zoomCentre = (f: number) => {
    const [cw, ch] = size(mapRef.current)
    zoom(f, cw / 2, ch / 2)
  }

  const lod = lodFor(view.k)
  const kit = useMemo(() => ({ sel: selected, rel: related(selected, graph) }), [selected, graph])
  const world = useMemo(() => <NetworkWorld graph={graph} layout={layout} lod={lod} kit={kit} dict={dict} />, [graph, layout, lod, kit, dict])

  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    if (gestures.consumeDrag()) return
    if (e.target instanceof Element && e.target.closest('.netctl') !== null) return
    onSelect(clickedId(e.target))
  }

  return (
    <div ref={mapRef} className={`netmap g${gestures.dragging ? ' drag' : ''}`} onPointerDown={gestures.onPointerDown} onClick={onClick}>
      <svg className="netsvg" width="100%" height="100%">
        <g className="vp" transform={`translate(${view.tx},${view.ty}) scale(${view.k})`}>
          {world}
        </g>
      </svg>
      <div className="netctl g-ctl">
        <button type="button" className="btn-icon sm" title={dict.netZoomOut} aria-label={dict.netZoomOut} onClick={() => zoomCentre(BUTTON_ZOOM_OUT)}>
          <IconMinus />
        </button>
        <span className="z num">{`${Math.round(view.k * 100)}%`}</span>
        <button type="button" className="btn-icon sm" title={dict.netZoomIn} aria-label={dict.netZoomIn} onClick={() => zoomCentre(BUTTON_ZOOM_IN)}>
          <IconPlus />
        </button>
        <span className="sep" />
        <button type="button" className="btn-icon sm" title={dict.netFit} aria-label={dict.netFit} onClick={fit}>
          <IconScan />
        </button>
      </div>
      <div className="nethint">{dict.netHint}</div>
    </div>
  )
}
