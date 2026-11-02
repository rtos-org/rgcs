// Whether 実験機能 › AI 緊急介入 is on (read-only GET). Off means off: the ops map shows
// no 外的要因 chip then. `refreshKey` re-reads it, e.g. when the settings sheet closes.
import { useEffect, useRef, useState } from 'react'
import type { GuardSettings } from '../../shared/api/types'
import { getGuardSettings } from './api'

export function useGuardEnabled(refreshKey: string, load: () => Promise<GuardSettings> = getGuardSettings): boolean {
  const [enabled, setEnabled] = useState(false)
  const loadRef = useRef(load)
  loadRef.current = load
  useEffect(() => {
    let alive = true
    loadRef
      .current()
      .then((s) => alive && setEnabled(s.enabled))
      .catch(() => alive && setEnabled(false))
    return () => {
      alive = false
    }
  }, [refreshKey])
  return enabled
}
