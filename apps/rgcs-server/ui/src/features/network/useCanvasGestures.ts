// Pointer, wheel and double-click gestures for the network canvas (prototype `netBind`): drag pans
// after a 4 px threshold and is never a click; a trackpad wheel pans, a mouse or Ctrl+wheel zooms.
import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'

export const DRAG_THRESHOLD_PX = 4

export interface GestureHandlers {
  /** Pan by a screen delta. */
  readonly pan: (dx: number, dy: number) => void
  /** Zoom by a factor about a point relative to the container. */
  readonly zoom: (f: number, px: number, py: number) => void
}

export interface Gestures {
  readonly dragging: boolean
  readonly onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void
  /** True once after a drag ended, so the click that follows it is ignored. */
  readonly consumeDrag: () => boolean
}

const isControl = (t: EventTarget | null): boolean => t instanceof Element && t.closest('.netctl') !== null

/** A wheel from a mouse (lines, or whole notches with no horizontal part) rather than a trackpad. */
const isMouseWheel = (e: WheelEvent): boolean => e.deltaMode === 1 || (e.deltaX === 0 && Math.abs(e.deltaY) >= 50 && Number.isInteger(e.deltaY))

function useWheelAndDblClick(ref: RefObject<HTMLElement | null>, h: RefObject<GestureHandlers>) {
  useEffect(() => {
    const el = ref.current
    if (el === null) return undefined
    const local = (e: MouseEvent): readonly [number, number] => {
      const r = el.getBoundingClientRect()
      return [e.clientX - r.left, e.clientY - r.top]
    }
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      const [px, py] = local(e)
      if (e.ctrlKey || isMouseWheel(e)) h.current.zoom(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), px, py)
      else h.current.pan(-e.deltaX, -e.deltaY)
    }
    const dbl = (e: MouseEvent) => {
      if (isControl(e.target)) return
      const [px, py] = local(e)
      h.current.zoom(2, px, py)
    }
    el.addEventListener('wheel', wheel, { passive: false })
    el.addEventListener('dblclick', dbl)
    return () => {
      el.removeEventListener('wheel', wheel)
      el.removeEventListener('dblclick', dbl)
    }
  }, [ref, h])
}

export function useCanvasGestures(ref: RefObject<HTMLElement | null>, handlers: GestureHandlers): Gestures {
  const h = useRef(handlers)
  useEffect(() => {
    h.current = handlers
  })
  const dragged = useRef(false)
  const stop = useRef<(() => void) | null>(null)
  const [dragging, setDragging] = useState(false)
  useWheelAndDblClick(ref, h)
  useEffect(() => () => stop.current?.(), [])

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0 || isControl(e.target)) return
    stop.current?.()
    let lastX = e.clientX, lastY = e.clientY, moved = false
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - lastX, dy = ev.clientY - lastY
      if (!moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return
      if (!moved) setDragging(true)
      moved = true
      lastX = ev.clientX
      lastY = ev.clientY
      h.current.pan(dx, dy)
    }
    const up = () => {
      if (moved) dragged.current = true
      stop.current?.()
    }
    stop.current = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      stop.current = null
      setDragging(false)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }, [])

  const consumeDrag = useCallback(() => {
    const was = dragged.current
    dragged.current = false
    return was
  }, [])

  return { dragging, onPointerDown, consumeDrag }
}
