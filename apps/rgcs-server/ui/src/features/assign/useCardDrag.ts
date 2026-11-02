import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'

// Pointer drag for assignment-board cards, one code path for mouse, touch and pen.
// - Mouse starts after 4 px of movement. Touch / pen start after a 250 ms hold; moving more
//   than 10 px before the hold ends is a scroll and abandons the press.
// - Targets are any element (or ancestor) with `data-drop="<id>"`. `canDrop` returns null when
//   the payload may land there, or a reason; only allowed targets become `over`.
// - The hook does not render the ghost: it returns the pointer position (`x`, `y`) while
//   dragging, and the caller draws a small fixed-position card there.
// - The click that the browser fires right after a drag is swallowed by a one-shot capture
//   listener, so card onClick handlers need no special casing (`wasDrag()` is there too).

export interface CardDragOptions<P> {
  canDrop: (payload: P, target: string) => string | null
  onDrop: (payload: P, target: string) => void
  // The list that auto-scrolls when the pointer is within EDGE_PX of its top or bottom.
  scrollRef?: RefObject<HTMLElement | null>
}

export interface CardDragState<P> {
  dragging: P | null
  // The allowed target under the pointer.
  over: string | null
  // The disallowed target under the pointer and why it cannot take the payload.
  blocked: string | null
  overReason: string | null
  x: number
  y: number
}

export interface CardDrag<P> extends CardDragState<P> {
  dragProps: (payload: P, enabled?: boolean) => { onPointerDown: (e: ReactPointerEvent) => void }
  wasDrag: () => boolean
}

export const MOUSE_START_PX = 4
export const HOLD_MS = 250
export const SCROLL_SLOP_PX = 10
export const EDGE_PX = 40
const SCROLL_STEP_PX = 14

interface Press<P> {
  readonly id: number
  readonly x: number
  readonly y: number
  readonly mouse: boolean
  readonly payload: P
  readonly timer: ReturnType<typeof setTimeout> | null
}

const IDLE: CardDragState<never> = { dragging: null, over: null, blocked: null, overReason: null, x: 0, y: 0 }

function targetAt(x: number, y: number): string | null {
  const hit = document.elementFromPoint(x, y)?.closest('[data-drop]')
  return hit?.getAttribute('data-drop') ?? null
}

function autoScroll(box: HTMLElement | null | undefined, y: number): void {
  if (!box) return
  const r = box.getBoundingClientRect()
  if (y < r.top + EDGE_PX && y > r.top - EDGE_PX) box.scrollTop -= SCROLL_STEP_PX
  else if (y > r.bottom - EDGE_PX && y < r.bottom + EDGE_PX) box.scrollTop += SCROLL_STEP_PX
}

function vibrate(): void {
  try { navigator.vibrate?.(12) } catch { /* not available */ }
}

// Swallow the click the browser fires right after a pointerup that ended a drag.
function suppressNextClick(flag: { current: boolean }): void {
  flag.current = true
  const swallow = (e: Event) => { e.stopPropagation(); e.preventDefault() }
  window.addEventListener('click', swallow, { capture: true, once: true })
  setTimeout(() => {
    flag.current = false
    window.removeEventListener('click', swallow, { capture: true })
  }, 0)
}

export function useCardDrag<P>(opts: CardDragOptions<P>): CardDrag<P> {
  const [state, setState] = useState<CardDragState<P>>(IDLE)
  const optsRef = useRef(opts)
  const pressRef = useRef<Press<P> | null>(null)
  const dragRef = useRef<CardDragState<P> | null>(null)
  const justDragged = useRef(false)
  const detachRef = useRef<() => void>(() => {})

  useEffect(() => { optsRef.current = opts })

  const commit = useCallback((next: CardDragState<P> | null) => {
    dragRef.current = next
    setState(next ?? IDLE)
  }, [])

  const moveTo = useCallback((x: number, y: number) => {
    const cur = dragRef.current
    if (!cur || cur.dragging === null) return
    const target = targetAt(x, y)
    const reason = target === null ? null : optsRef.current.canDrop(cur.dragging, target)
    commit({
      ...cur,
      x,
      y,
      over: target !== null && reason === null ? target : null,
      blocked: reason === null ? null : target,
      overReason: reason,
    })
    autoScroll(optsRef.current.scrollRef?.current, y)
  }, [commit])

  const begin = useCallback((x: number, y: number) => {
    const press = pressRef.current
    if (!press) return
    vibrate()
    commit({ ...IDLE, dragging: press.payload, x, y })
    moveTo(x, y)
  }, [commit, moveTo])

  const end = useCallback((drop: boolean) => {
    const press = pressRef.current
    if (press?.timer) clearTimeout(press.timer)
    pressRef.current = null
    detachRef.current()
    const cur = dragRef.current
    if (!cur) return
    commit(null)
    suppressNextClick(justDragged)
    if (drop && cur.dragging !== null && cur.over !== null) optsRef.current.onDrop(cur.dragging, cur.over)
  }, [commit])

  const onMove = useCallback((e: PointerEvent) => {
    const press = pressRef.current
    if (!press || e.pointerId !== press.id) return
    if (dragRef.current) { moveTo(e.clientX, e.clientY); return }
    const dist = Math.hypot(e.clientX - press.x, e.clientY - press.y)
    if (press.mouse && dist > MOUSE_START_PX) begin(e.clientX, e.clientY)
    else if (!press.mouse && dist > SCROLL_SLOP_PX) end(false) // a scroll, not a hold
  }, [begin, end, moveTo])

  const attach = useCallback(() => {
    const up = (e: PointerEvent) => {
      if (pressRef.current && e.pointerId === pressRef.current.id) end(true)
    }
    const cancel = () => end(false)
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') end(false) }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('keydown', key)
    detachRef.current = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('keydown', key)
      detachRef.current = () => {}
    }
  }, [end, onMove])

  const startPress = useCallback((payload: P, e: ReactPointerEvent) => {
    const mouse = e.pointerType === 'mouse'
    if (mouse && e.button !== 0) return
    if (pressRef.current) end(false)
    const { clientX: x, clientY: y } = e
    const timer = mouse ? null : setTimeout(() => begin(x, y), HOLD_MS)
    pressRef.current = { id: e.pointerId, x, y, mouse, payload, timer }
    attach()
  }, [attach, begin, end])

  // While dragging on touch, stop the page from scrolling under the finger.
  useEffect(() => {
    const block = (e: TouchEvent) => { if (dragRef.current) e.preventDefault() }
    document.addEventListener('touchmove', block, { passive: false })
    return () => {
      document.removeEventListener('touchmove', block)
      const press = pressRef.current
      if (press?.timer) clearTimeout(press.timer)
      pressRef.current = null
      detachRef.current()
    }
  }, [])

  const dragProps = useCallback((payload: P, enabled = true) => ({
    onPointerDown: (e: ReactPointerEvent) => { if (enabled) startPress(payload, e) },
  }), [startPress])

  const wasDrag = useCallback(() => justDragged.current, [])

  return { ...state, dragProps, wasDrag }
}
