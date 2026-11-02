// A value previewed at most once per animation frame while a drag is in progress, then taken
// back (and the preview cleared) on release.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

const frame = (cb: () => void): number => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(cb) : window.setTimeout(cb, 16))
const cancelFrame = (h: number) => (typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame(h) : window.clearTimeout(h))

export interface FramePreview<T> {
  /** What the last frame showed; null when not dragging. */
  readonly preview: T | null
  /** The latest value, ahead of the frame. */
  readonly pending: () => T | null
  /** Records a drag value; the preview follows on the next frame. */
  readonly live: (value: T) => void
  /** Ends the drag: returns the latest value and clears the preview. */
  readonly take: () => T | null
}

export function useFramePreview<T>(): FramePreview<T> {
  const [preview, setPreview] = useState<T | null>(null)
  const latest = useRef<T | null>(null)
  const scheduled = useRef<number | null>(null)
  useEffect(() => () => void (scheduled.current !== null && cancelFrame(scheduled.current)), [])

  const live = useCallback((value: T) => {
    latest.current = value
    if (scheduled.current !== null) return
    scheduled.current = frame(() => {
      scheduled.current = null
      setPreview(latest.current)
    })
  }, [])

  const take = useCallback((): T | null => {
    if (scheduled.current !== null) cancelFrame(scheduled.current)
    scheduled.current = null
    const value = latest.current
    latest.current = null
    setPreview(null)
    return value
  }, [])

  const pending = useCallback(() => latest.current, [])
  return useMemo(() => ({ preview, pending, live, take }), [preview, pending, live, take])
}
