// 3D altitude editing: a badge floats at its altitude, so dragging it up or down changes only the
// altitude (the ground foot changes only the position, see missionFeet). Window listeners, not
// pointer capture, so the drag survives the pointer leaving the badge; preventDefault on
// pointerdown keeps MapLibre from panning (it listens to the compatibility mouse events).
import { altFromDrag } from './mapEdit'

/** Pixels the pointer must travel before a press becomes a drag (below it, a click). */
const DRAG_PX = 3

export interface AltDragDeps {
  /** True in 3D. */
  readonly active: () => boolean
  /** The items the drag moves: the selection when the badge is part of a multi-selection. */
  readonly targets: () => ReadonlySet<number>
  readonly alt: () => number
  readonly pxPerMetre: () => number | null
  readonly onPreview: (targets: ReadonlySet<number>, dAlt: number) => void
  readonly onCommit: (targets: ReadonlySet<number>, dAlt: number) => void
}

/**
 * The click that ends a drag lands wherever the pointer was released — off the badge it reaches
 * the map, which adds a waypoint in the add tool. Swallow that one click anywhere (window capture),
 * and stop swallowing after this task in case the release produced no click.
 */
export function swallowNextClick(): void {
  const stop = (e: Event) => {
    e.stopImmediatePropagation()
    e.preventDefault()
    window.removeEventListener('click', stop, true)
  }
  window.addEventListener('click', stop, true)
  setTimeout(() => window.removeEventListener('click', stop, true), 0)
}

export function attachAltDrag(el: HTMLElement, deps: AltDragDeps): void {
  // preventDefault on pointerdown does not stop touchstart: MapLibre would pan under the finger
  el.addEventListener(
    'touchstart',
    (e) => {
      if (deps.active()) e.preventDefault()
    },
    { passive: false },
  )
  el.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !deps.active()) return
    e.preventDefault()
    e.stopPropagation()
    const id = e.pointerId
    const mine = (ev: Event) => (ev as PointerEvent).pointerId === id
    const y0 = e.clientY
    const alt0 = deps.alt()
    const scale = deps.pxPerMetre()
    const targets = deps.targets()
    let dragging = false
    let dAlt = 0
    const move = (ev: MouseEvent) => {
      if (!mine(ev)) return
      const dy = ev.clientY - y0
      if (!dragging && Math.abs(dy) < DRAG_PX) return
      dragging = true
      dAlt = altFromDrag(alt0, dy, scale) - alt0
      deps.onPreview(targets, dAlt)
    }
    const finish = (ev: Event) => {
      if (!mine(ev)) return
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      if (!dragging) return
      swallowNextClick()
      // a cancelled gesture (e.g. the browser took the touch) reverts instead of committing
      deps.onCommit(targets, ev.type === 'pointercancel' ? 0 : dAlt)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
  })
}
