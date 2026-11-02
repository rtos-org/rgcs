import { useEffect, useRef } from 'react'

/** Enter runs and Escape cancels while the dialog is open — never from a field elsewhere on the page. */
export function useConfirmKeys(box: React.RefObject<HTMLDivElement | null>, onEnter: (() => void) | null, onEscape: () => void): void {
  const handlers = useRef({ onEnter, onEscape })
  handlers.current = { onEnter, onEscape }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target instanceof HTMLElement ? e.target : null
      const inside = el !== null && box.current?.contains(el) === true
      if (e.key === 'Escape') {
        e.preventDefault()
        handlers.current.onEscape()
        return
      }
      // A held key auto-repeats: the Enter that opened the dialog must not also run it.
      if (e.key !== 'Enter' || e.repeat || !handlers.current.onEnter) return
      if (el && !inside && ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)) return
      if (inside && el?.tagName === 'BUTTON') return // the focused button's own activation
      e.preventDefault()
      handlers.current.onEnter()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [box])
}
