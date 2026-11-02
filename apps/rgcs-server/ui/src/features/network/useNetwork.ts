import { useEffect, useState } from 'react'
import type { NetworkTopology } from '../../shared/api/types'
import { fetchNetwork } from './api'

export interface NetworkData {
  readonly topology: NetworkTopology | null
  /** An i18n key (`netLoadFailed`) when the first GET failed; the caller maps it to text. */
  readonly error: string | null
}

function newer(a: NetworkTopology | null, b: NetworkTopology | null): NetworkTopology | null {
  if (a === null) return b
  if (b === null) return a
  return b.at_unix_ms > a.at_unix_ms ? b : a
}

/** GET the topology once on mount; afterwards whichever of it and the WS value is newer wins. */
export function useNetwork(ws: NetworkTopology | null): NetworkData {
  const [shown, setShown] = useState<NetworkTopology | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void fetchNetwork().then(
      (t) => {
        if (live) setShown((prev) => newer(prev, t))
      },
      () => {
        if (live) setError('netLoadFailed')
      },
    )
    return () => {
      live = false
    }
  }, [])

  // Keep the newest value seen so a stale WS frame (or a late GET) never steps time backwards.
  const topology = newer(shown, ws)
  if (topology !== shown) setShown(topology)

  return { topology, error: topology === null ? error : null }
}
