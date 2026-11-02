// The operations map's fleet framing: it opens on the vehicles the first time any has a
// position, 「全機を表示」 frames them again on request, and a newly selected vehicle that is off
// screen is brought into view.
import type { Map as MlMap } from 'maplibre-gl'
import { useEffect, useRef, type RefObject } from 'react'
import type { VehicleState } from '../../shared/api/types'
import { firstView, type Padding } from './follow'
import { hasPosition } from './markers'
import { KEEP_ELEVATION } from './mapMode'

const SHOW_ALL_MS = 600

function frame(m: MlMap, vehicles: ReadonlyMap<number, VehicleState>, padding: Padding, duration: number): boolean {
  const view = firstView(vehicles)
  if (!view) return false
  if ('center' in view) {
    if (duration === 0) m.jumpTo({ center: view.center })
    else m.easeTo({ center: view.center, duration, ...KEEP_ELEVATION })
  } else m.fitBounds(view.bounds, { padding, maxZoom: 16, duration })
  return true
}

/**
 * `showAll`: a counter; each new value frames every vehicle with a position. The first view is
 * kept per map instance, so the live map is framed even when StrictMode threw the first one away.
 */
export function useFleetView(map: RefObject<MlMap | null>, vehicles: ReadonlyMap<number, VehicleState>, follow: number | null, padding: Padding, showAll: number): void {
  const opened = useRef<MlMap | null>(null)
  useEffect(() => {
    const m = map.current
    if (!m || opened.current === m || follow !== null) return
    if (frame(m, vehicles, padding, 0)) opened.current = m
    // padding is read when the view is first set; later changes are applied by their own effect
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicles, follow])
  const shown = useRef(showAll)
  useEffect(() => {
    const m = map.current
    if (!m || showAll === shown.current) return
    shown.current = showAll
    frame(m, vehicles, padding, SHOW_ALL_MS)
    // only a new request frames: telemetry updates must not move the camera
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showAll])
}

/** A newly selected vehicle off screen: ease to it (not on the first selection, not while following). */
export function useRevealSelected(map: RefObject<MlMap | null>, vehicles: ReadonlyMap<number, VehicleState>, selected: number | null, follow: number | null): void {
  const prev = useRef(selected)
  useEffect(() => {
    const m = map.current
    const was = prev.current
    prev.current = selected
    if (!m || selected === null || was === null || was === selected || follow !== null) return
    const v = vehicles.get(selected)
    if (!v || !hasPosition(v) || m.getBounds().contains([v.lon, v.lat])) return
    m.easeTo({ center: [v.lon, v.lat], duration: SHOW_ALL_MS, ...KEEP_ELEVATION })
    // only a change of selection moves the camera, not telemetry
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected])
}
