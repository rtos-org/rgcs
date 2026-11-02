// ROI on the operations map (prototype buildRoiMarkers, updateSight): preset
// markers and the camera's sight line. Pure builders; `useRoiLayer` puts them on the map.
import type { FeatureCollection } from 'geojson'
import type { CameraSnapshot, RoiTarget, VehicleState } from '../../shared/api/types'
import { haversineM } from '../mission/geo'
import { bearingOf } from '../map/gimbal'
import { hasPosition } from '../map/markers'

const R = 6_371_000
const RAD = Math.PI / 180
/** Without an active target the sight line is drawn this long (prototype). */
export const SIGHT_LENGTH_M = 450
const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] }

/** `.rg-roi[data-id] > .sq + .lbl`; `.on` while it is the active target. */
export function roiMarkerEl(t: RoiTarget, active: boolean): HTMLDivElement {
  const el = document.createElement('div')
  el.className = active ? 'rg-roi on' : 'rg-roi'
  el.dataset.id = t.id
  const sq = document.createElement('span')
  sq.className = 'sq'
  const lbl = document.createElement('span')
  lbl.className = 'lbl'
  lbl.textContent = t.name
  el.append(sq, lbl)
  return el
}

/** The point `distM` from (lat, lon) along `bearingDeg` on a sphere, as [lng, lat]. */
export function destination(lat: number, lon: number, bearingDeg: number, distM: number): [number, number] {
  const d = distM / R
  const b = bearingDeg * RAD
  const p1 = lat * RAD
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b))
  const l2 = lon * RAD + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2))
  return [((((l2 / RAD + 540) % 360) + 360) % 360) - 180, p2 / RAD]
}

/**
 * The camera's sight line from the vehicle along heading − gimbal yaw: as long as the distance to
 * the active target, else `SIGHT_LENGTH_M`. Empty without a position, a heading (hdg 65535 → null),
 * a gimbal attitude or a rate-capable gimbal.
 */
export function sightGeoJson(v: VehicleState | undefined, cam: CameraSnapshot | undefined, target: RoiTarget | null): FeatureCollection {
  const att = cam?.state.gimbal
  if (!v || !hasPosition(v) || v.hdg === null || !cam?.caps.gimbal?.rate || !att) return EMPTY
  const dist = target ? haversineM(v.lat, v.lon, target.lat, target.lon) : SIGHT_LENGTH_M
  const end = destination(v.lat, v.lon, bearingOf(v.hdg, att.yaw), dist)
  return { type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[v.lon, v.lat], end] } }] }
}
