// Counts switches into the operations view so the map can move its camera to a vehicle on each one
// (not on the first render: the map's own first view handles that).
import { useRef } from 'react'
import type { View } from './view'

export function useOpsArrival(view: View): number {
  const last = useRef<{ view: View; n: number }>({ view, n: 0 })
  if (view !== last.current.view) last.current = { view, n: last.current.n + (view === 'ops' ? 1 : 0) }
  return last.current.n
}
