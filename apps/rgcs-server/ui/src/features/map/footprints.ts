import type { Feature, FeatureCollection } from 'geojson'
import type { CameraSnapshot, SysId, VehicleState } from '../../shared/api/types'
import { footprint } from './gimbal'
import { gimbalPose, hasPosition } from './markers'

/** Below this the vehicle is on the ground and has no footprint (prototype: alt < 1). */
const MIN_ALT_M = 1

/** The gimbal image footprints (app setting 地上への投影), on a flat plane at home level. */
export function footprintsGeoJson(vehicles: ReadonlyMap<SysId, VehicleState>, cameras: ReadonlyMap<SysId, CameraSnapshot>, selected: SysId | null): FeatureCollection {
  const features = [...vehicles.values()].flatMap((v): Feature[] => {
    const pose = gimbalPose(v, cameras.get(v.sysid))
    const att = cameras.get(v.sysid)?.state.gimbal
    if (!pose || !att || v.hdg === null || !hasPosition(v) || v.alt_rel < MIN_ALT_M) return []
    const corners = footprint(v.lat, v.lon, v.alt_rel, v.hdg, att.yaw, att.pitch, pose.hfov)
    if (!corners) return []
    return [{ type: 'Feature', properties: { sysid: v.sysid, sel: v.sysid === selected ? 1 : 0 }, geometry: { type: 'Polygon', coordinates: [[...corners, corners[0]!]] } }]
  })
  return { type: 'FeatureCollection', features }
}

/** Vehicles whose footprint is drawn (their marker fan is hidden). */
export function projectedIds(fc: FeatureCollection): ReadonlySet<SysId> {
  return new Set(fc.features.map((f) => (f.properties as { sysid: SysId }).sysid))
}
