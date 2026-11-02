// Shift + drag on the mission map: a selection box; the badges whose on-screen centre falls inside
// it join the selection. Badges are measured where they are drawn, so 3D (floated) works too. The
// press is taken in the capture phase so MapLibre never starts a pan, and the click that ends the
// drag is swallowed (it would add a waypoint in the add tool).
import { useEffect, type RefObject } from 'react'
import { swallowNextClick } from './altDrag'
import { uidsInBox } from './mapEdit'

/** Pixels the pointer must travel before the box counts (a Shift-click stays a click). */
const MIN_BOX_PX = 4

interface Badge {
  readonly el: HTMLElement
}

function centres(badges: ReadonlyMap<number, Badge>): { uid: number; x: number; y: number }[] {
  return [...badges].map(([uid, b]) => {
    const r = (b.el.querySelector('.dot') ?? b.el).getBoundingClientRect()
    return { uid, x: r.left + r.width / 2, y: r.top + r.height / 2 }
  })
}

function boxEl(host: HTMLElement): HTMLDivElement {
  const el = document.createElement('div')
  el.className = 'box-select'
  host.append(el)
  return el
}

/** `active`: only in the mission tab (elsewhere the waypoints are inert). */
export function useBoxSelect(container: RefObject<HTMLDivElement | null>, badges: RefObject<ReadonlyMap<number, Badge>>, onBox: RefObject<(uids: number[]) => void>, active: RefObject<boolean>): void {
  useEffect(() => {
    const host = container.current
    if (!host) return
    const down = (e: MouseEvent) => {
      if (!active.current || !e.shiftKey || e.button !== 0 || (e.target as HTMLElement).closest('.maplibregl-marker')) return
      e.preventDefault()
      e.stopPropagation()
      const origin = host.getBoundingClientRect()
      const x0 = e.clientX
      const y0 = e.clientY
      let box: HTMLDivElement | null = null
      const move = (ev: MouseEvent) => {
        if (!box && Math.hypot(ev.clientX - x0, ev.clientY - y0) < MIN_BOX_PX) return
        box ??= boxEl(host)
        Object.assign(box.style, {
          left: `${Math.min(x0, ev.clientX) - origin.left}px`,
          top: `${Math.min(y0, ev.clientY) - origin.top}px`,
          width: `${Math.abs(ev.clientX - x0)}px`,
          height: `${Math.abs(ev.clientY - y0)}px`,
        })
      }
      const up = (ev: MouseEvent) => {
        window.removeEventListener('mousemove', move)
        window.removeEventListener('mouseup', up)
        if (!box) return
        box.remove()
        swallowNextClick()
        onBox.current(uidsInBox(centres(badges.current), { x0, y0, x1: ev.clientX, y1: ev.clientY }))
      }
      window.addEventListener('mousemove', move)
      window.addEventListener('mouseup', up)
    }
    host.addEventListener('mousedown', down, true)
    return () => host.removeEventListener('mousedown', down, true)
  }, [container, badges, onBox, active])
}
