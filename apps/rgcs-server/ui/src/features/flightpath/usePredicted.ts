import { useMemo } from 'react'
import type { Mission, VehicleState } from '../../shared/api/types'
import type { Predicted } from '../mission/missionAir'
import { pathModel, pathParamNames, predictFor } from './predict'
import { usePathParams } from './usePathParams'

/** The expected flight of a plane / QuadPlane / copter for its mission (operations map); null otherwise. */
export function usePredicted(mission: Mission | null, vehicle: VehicleState | null): Predicted | null {
  const kind = vehicle?.kind ?? null
  const names = pathParamNames(kind)
  const values = usePathParams(vehicle?.sysid ?? null, names)
  // telemetry replaces the vehicle every update: depend on the home's values only
  const [hLat, hLon, hAlt] = [vehicle?.home?.lat, vehicle?.home?.lon, vehicle?.home?.alt]
  return useMemo(() => {
    const model = pathModel(kind, values)
    if (!model || !mission) return null
    const home = hLat !== undefined && hLon !== undefined && hAlt !== undefined ? { lat: hLat, lon: hLon, alt: hAlt } : null
    return predictFor({ items: mission.items, mission }, model, home)
  }, [kind, mission, values, hLat, hLon, hAlt])
}
