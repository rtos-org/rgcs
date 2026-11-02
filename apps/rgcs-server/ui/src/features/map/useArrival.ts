// Entering the operations view (a menu switch): the camera goes to the selected connected vehicle,
// else the connected one nearest the map centre (user request 2026-10-22).
import type { Map as MlMap } from 'maplibre-gl'
import { useEffect, useRef, type RefObject } from 'react'
import type { VehicleState } from '../../shared/api/types'
import { arrivalTarget } from './follow'
import { KEEP_ELEVATION } from './mapMode'

/** Entering the operations view: centre on the selected (or nearest) connected vehicle, once per entry. */
export function useArrival(map: RefObject<MlMap | null>, arrival: number, vehicles: ReadonlyMap<number, VehicleState>, selected: number | null, follow: number | null): void {
  const done = useRef(0)
  useEffect(() => {
    const m = map.current
    if (!m || arrival === done.current) return
    if (follow !== null) {
      done.current = arrival
      return
    }
    const c = m.getCenter()
    const sysid = arrivalTarget(vehicles, selected, [c.lng, c.lat])
    const v = sysid === null ? undefined : vehicles.get(sysid)
    if (!v) return
    done.current = arrival
    m.resize?.()
    m.easeTo({ center: [v.lon, v.lat], duration: 600, ...KEEP_ELEVATION })
  }, [map, arrival, vehicles, selected, follow])
}
