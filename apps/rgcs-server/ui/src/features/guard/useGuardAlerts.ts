// Feeds the banner: `GET /api/guard/alerts` on mount and after every (re)connect snapshot, then
// the `guard_alert` WS frames. Only that read-only GET runs from an effect; cancel is a click.
import { useEffect, useMemo, useRef, useState } from 'react'
import type { GuardAlert } from '../../shared/api/types'
import { vehicleStore, type FrameSource } from '../vehicles/store'
import { activeSysids, applyGuardAlert, pruneAlerts, replaceAlerts, type AlertMap } from './alerts'
import { listGuardAlerts } from './api'

/** Re-render cadence while alerts are shown, so the countdown flips within a quarter second. */
const TICK_MS = 250

export interface GuardAlertsState {
  readonly alerts: AlertMap
  readonly active: ReadonlySet<number>
  readonly now: number
}

const EMPTY: AlertMap = new Map()

export function useGuardAlerts(frames: FrameSource = vehicleStore, load: () => Promise<GuardAlert[]> = listGuardAlerts, clock: () => number = Date.now): GuardAlertsState {
  const [alerts, setAlerts] = useState<AlertMap>(EMPTY)
  const [now, setNow] = useState(clock)
  const loadRef = useRef(load)
  const clockRef = useRef(clock)
  loadRef.current = load
  clockRef.current = clock

  useEffect(() => {
    let alive = true
    const reload = () => {
      loadRef
        .current()
        .then((list) => alive && setAlerts(replaceAlerts(list, clockRef.current())))
        .catch(() => {}) // offline or guard API missing: the WS frames still arrive
    }
    reload()
    const off = frames.onFrame((msg) => {
      if (msg.t === 'guard_alert') setAlerts((m) => applyGuardAlert(m, msg.alert, clockRef.current()))
      else if (msg.t === 'snapshot') reload()
    })
    return () => {
      alive = false
      off()
    }
  }, [frames])

  const showing = alerts.size > 0
  useEffect(() => {
    if (!showing) return
    const timer = setInterval(() => {
      const t = clockRef.current()
      setNow(t)
      setAlerts((m) => pruneAlerts(m, t))
    }, TICK_MS)
    return () => clearInterval(timer)
  }, [showing])

  const active = useMemo(() => activeSysids(alerts), [alerts])
  return { alerts, active, now: showing ? Math.max(now, lastTs(alerts)) : now }
}

function lastTs(m: AlertMap): number {
  return [...m.values()].reduce((acc, a) => Math.max(acc, a.ts), 0)
}
