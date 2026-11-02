// What a double-click on an open plan's row frames (spec 2026-10-20 §9): the mission's positioned
// items, its fence (polygon vertices, circle outlines) and its rally points.
import { hasPosition, type LatLon } from '../mission/geo'
import { circleRing } from '../mission/geofenceModel'
import type { Draft } from '../mission/model'

export function framePoints(d: Draft): LatLon[] {
  const items = d.items.filter(hasPosition).map((it) => ({ lat: it.lat, lon: it.lon }))
  const fence = d.mission.fence.flatMap((z) => (z.kind === 'circle' ? circleRing(z.center, z.radius, 16) : z.vertices))
  const rally = d.mission.rally.map((r) => ({ lat: r.lat, lon: r.lon }))
  return [...items, ...fence, ...rally]
}
