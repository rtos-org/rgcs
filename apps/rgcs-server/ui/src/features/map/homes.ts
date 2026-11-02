import type { Mission, SysId, VehicleState } from '../../shared/api/types'
import type { LatLon } from './store'

/** Each vehicle's home from the mission it is known to carry (no HOME_POSITION feed yet). */
export function missionHomes(missions: ReadonlyMap<SysId, Mission>): ReadonlyMap<SysId, LatLon> {
  const homes = [...missions].flatMap(([sysid, m]) => (m.home && !(m.home.lat === 0 && m.home.lon === 0) ? [[sysid, { lat: m.home.lat, lon: m.home.lon }] as const] : []))
  return new Map(homes)
}

/** HOME_POSITION when the vehicle reported it, else its mission's home. */
export function vehicleHomes(vehicles: ReadonlyMap<SysId, VehicleState>, missions: ReadonlyMap<SysId, Mission>): ReadonlyMap<SysId, LatLon> {
  const fromMission = missionHomes(missions)
  const merged = new Map(fromMission)
  vehicles.forEach((v) => {
    if (v.home && !(v.home.lat === 0 && v.home.lon === 0)) merged.set(v.sysid, { lat: v.home.lat, lon: v.home.lon })
  })
  return merged
}
