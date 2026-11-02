// 飛行可能時間 (minutes) of the assigned vehicles from their registry, for the battery estimate.
import { useEffect, useState } from 'react'
import { getRegistry } from '../logbook/api'

/** Endurance per sysid; null = not set or could not be read. Read again whenever the set changes. */
export function useEndurance(sysids: readonly number[]): ReadonlyMap<number, number | null> {
  const [known, setKnown] = useState<ReadonlyMap<number, number | null>>(new Map())
  const key = [...new Set(sysids)].sort((a, b) => a - b).join(',')
  useEffect(() => {
    let alive = true
    const ids = key === '' ? [] : key.split(',').map(Number)
    for (const id of ids) {
      getRegistry(id)
        .then((r) => r.endurance_minutes, () => null)
        .then((v) => alive && setKnown((m) => new Map([...m, [id, v]])))
    }
    return () => {
      alive = false
    }
  }, [key])
  return known
}
