import { useEffect, useMemo, useState } from 'react'
import { apiFetch } from '../../shared/api/client'
import { loadSaved, mergeValues, saveValues, type Values } from './saved'

interface Picked {
  readonly values: Values
  readonly missing: readonly string[]
}

export const pickParams = (sysid: number, names: readonly string[]): Promise<Picked> => apiFetch(`/api/vehicles/${sysid}/params/pick?names=${names.join(',')}`)

/** A vehicle that has not answered every name yet is asked again this often, a few times. */
const RETRY_MS = 5000
const RETRIES = 3

/**
 * The parameters behind the predicted path for `sysid` (`names`: the ones its flight model reads,
 * none = no prediction): saved values first, refreshed from the vehicle (connected or not, the
 * server answers from its cache and asks for the rest).
 */
export function usePathParams(sysid: number | null, names: readonly string[]): ReadonlyMap<string, number> {
  const wanted = names.length > 0
  const [values, setValues] = useState<{ sysid: number | null; values: Values }>({ sysid: null, values: {} })
  useEffect(() => {
    if (sysid === null || !wanted) return
    let alive = true
    let tries = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const ask = () => {
      pickParams(sysid, names)
        .then((got) => {
          if (!alive) return
          const merged = mergeValues(loadSaved(sysid), got.values)
          saveValues(sysid, merged)
          setValues({ sysid, values: merged })
          if (got.missing.length > 0 && ++tries < RETRIES) timer = setTimeout(ask, RETRY_MS)
        })
        .catch(() => {})
    }
    // saved values draw at once; the vehicle's answer replaces them
    timer = setTimeout(() => {
      if (alive) setValues({ sysid, values: loadSaved(sysid) })
      ask()
    }, 0)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [sysid, wanted, names])
  return useMemo(() => new Map(values.sysid === sysid ? Object.entries(values.values) : []), [values, sysid])
}
