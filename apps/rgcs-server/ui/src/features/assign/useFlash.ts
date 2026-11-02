// Short per-card messages on the assignment board (位置が分かりません, why a plan does not fit):
// one per vehicle, each cleared FLASH_MS after it was last shown.
import { useCallback, useEffect, useRef, useState } from 'react'

export const FLASH_MS = 1800

type Timer = ReturnType<typeof setTimeout>

const without = (m: ReadonlyMap<number, string>, sysid: number): ReadonlyMap<number, string> => {
  const copy = new Map(m)
  copy.delete(sysid)
  return copy
}

export function useFlash(): readonly [ReadonlyMap<number, string>, (sysid: number, text: string) => void] {
  const [flash, setFlash] = useState<ReadonlyMap<number, string>>(new Map())
  const timers = useRef(new Map<number, Timer>())

  useEffect(() => {
    const live = timers.current
    return () => live.forEach(clearTimeout)
  }, [])

  const show = useCallback((sysid: number, text: string) => {
    const live = timers.current
    clearTimeout(live.get(sysid))
    setFlash((m) => new Map(m).set(sysid, text))
    live.set(sysid, setTimeout(() => {
      live.delete(sysid)
      setFlash((m) => without(m, sysid))
    }, FLASH_MS))
  }, [])

  return [flash, show]
}
