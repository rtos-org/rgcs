import { useEffect } from 'react'
import type { LinkState } from '../vehicles/reducer'
import { vehicleStore } from '../vehicles/store'
import { fetchLog } from './api'

/** Loads the persisted log whenever the socket (re)opens, so nothing missed while offline is lost. */
export function useLogHistory(link: LinkState): void {
  useEffect(() => {
    if (link !== 'open') return
    let alive = true
    fetchLog()
      .then((entries) => alive && vehicleStore.logAction({ k: 'loaded', entries }))
      .catch(() => {
        // The pill keeps showing live entries; the history appears on the next reconnect.
      })
    return () => {
      alive = false
    }
  }, [link])
}
