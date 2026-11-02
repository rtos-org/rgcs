// Long press on a mid-leg "+" then drag: the leg bends into a circular arc through the pointer and
// its end item becomes a NAV_ARC_WAYPOINT (Copter 4.7+). A short press stays a click (insert a
// waypoint). The press takes the compatibility mouse events away from MapLibre so the map does not
// pan, and the click that ends a bend is swallowed.
import { swallowNextClick } from './altDrag'
import { arcAngleThrough } from './arc'
import type { LatLon } from './geo'
import type { MidHandle } from './mapEdit'

/** How long the "+" must be held before dragging bends the leg. */
export const ARC_HOLD_MS = 500
/** Moving this far before the hold completes cancels it (a slip, not a bend). */
const SLIP_PX = 6

export interface ArcDragDeps {
  /** Screen → map position (the ground under the pointer). */
  readonly toLatLon: (clientX: number, clientY: number) => LatLon | null
  readonly end: (uid: number) => LatLon | null
  readonly onPreview: (uid: number, angle: number) => void
  readonly onCommit: (uid: number, angle: number) => void
  readonly onCancel: () => void
}

export function attachArcDrag(el: HTMLElement, h: MidHandle, deps: ArcDragDeps): void {
  // preventDefault on pointerdown does not stop touchstart: MapLibre would pan during the hold
  el.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false })
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const id = e.pointerId
    const x0 = e.clientX
    const y0 = e.clientY
    let armed = false
    let bent = false
    let angle = 0
    const timer = setTimeout(() => {
      armed = true
      el.classList.add('arc-armed')
    }, ARC_HOLD_MS)
    const mine = (ev: Event) => (ev as PointerEvent).pointerId === id
    const move = (ev: MouseEvent) => {
      if (!mine(ev)) return
      if (!armed) {
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > SLIP_PX) clearTimeout(timer)
        return
      }
      const p = deps.toLatLon(ev.clientX, ev.clientY)
      const end = deps.end(h.toUid)
      if (!p || !end) return
      angle = arcAngleThrough({ lat: h.fromLat, lon: h.fromLon }, p, end)
      bent = true
      deps.onPreview(h.toUid, angle)
    }
    const finish = (ev: Event) => {
      if (!mine(ev)) return
      clearTimeout(timer)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      el.classList.remove('arc-armed')
      if (!armed) return
      swallowNextClick()
      // a hold released without bending (or cancelled) leaves the leg as it was
      if (ev.type === 'pointercancel' || !bent) deps.onCancel()
      else deps.onCommit(h.toUid, angle)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
  })
}
