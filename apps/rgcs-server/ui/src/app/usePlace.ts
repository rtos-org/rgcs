// The Shell's view plus its right panel: nav presses go through `navigate`.
import { useCallback, useState } from 'react'
import { navigate, navViewOf, type Place, type RightPanel } from './rightPanel'
import type { View } from './view'

export interface PlaceState {
  readonly view: View
  readonly right: RightPanel
  /** What the nav lens marks. */
  readonly navView: View
  /** The AI panel shows on the ops map in place of the detail panel. */
  readonly aiOpen: boolean
  /** A nav press (`ai` toggles the AI panel, `ops` returns to the detail panel). */
  readonly nav: (target: View) => void
  /** Any other view change (e.g. 整備 from the detail panel): the right panel is kept. */
  readonly setView: (view: View) => void
  readonly closeAi: () => void
}

export function usePlace(): PlaceState {
  const [place, setPlace] = useState<Place>({ view: 'ops', right: 'detail' })
  const nav = useCallback((target: View) => setPlace((p) => navigate(p, target)), [])
  const setView = useCallback((view: View) => setPlace((p) => ({ ...p, view })), [])
  const closeAi = useCallback(() => setPlace((p) => ({ ...p, right: 'detail' })), [])
  return { ...place, navView: navViewOf(place), aiOpen: place.view === 'ops' && place.right === 'ai', nav, setView, closeAi }
}
