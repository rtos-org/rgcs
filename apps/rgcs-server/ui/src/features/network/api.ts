import { apiFetch } from '../../shared/api/client'
import type { NetworkTopology } from '../../shared/api/types'

/** `GET /api/network`: the whole topology, once, when the view opens (WS frames follow at 1 Hz). */
export function fetchNetwork(): Promise<NetworkTopology> {
  return apiFetch('/api/network')
}
