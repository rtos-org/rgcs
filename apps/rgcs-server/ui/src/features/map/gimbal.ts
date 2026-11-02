// Gimbal view on the 2D map (prototype poseMarkers, camRays): a direction fan on
// the vehicle marker, or — with the app setting — the image footprint on a flat ground plane.

const RAD = Math.PI / 180
/** Projected rays that do not reach the ground within this distance give no footprint (prototype CAM_RANGE). */
export const FOOTPRINT_RANGE_M = 1500
/** The fan is drawn no narrower than this, so 165× zoom stays visible. */
const MIN_FAN_DEG = 4
const M_PER_DEG_LAT = 111_320

/** Camera bearing over the ground: the sight line follows heading − gimbal yaw. */
export function bearingOf(headingDeg: number, gimbalYawDeg: number): number {
  return (((headingDeg - gimbalYawDeg) % 360) + 360) % 360
}

/** Horizontal field of view at `zoom` (degrees) from the 1× value. */
export function hfovAt(hfov1Deg: number, zoom: number): number {
  return (2 * Math.atan(Math.tan((hfov1Deg / 2) * RAD) / Math.max(zoom, 1))) / RAD
}

/** The fan shortens as the gimbal tilts down. */
export function fanLengthPx(pitchDeg: number): number {
  return Math.round(48 + 64 * Math.cos(pitchDeg * RAD))
}

/** Near nadir the fan becomes a dashed footprint ring. */
export function isNadir(pitchDeg: number): boolean {
  return pitchDeg <= -80
}

/** The `.cone` wedge in the 240 × 240 `.fov` svg, pointing up (the svg is rotated to the bearing). */
export function fanPath(hfovDeg: number, pitchDeg: number): string {
  const h = Math.max(MIN_FAN_DEG, hfovDeg)
  const r = fanLengthPx(pitchDeg)
  const x = r * Math.sin((h / 2) * RAD)
  const y = r * Math.cos((h / 2) * RAD)
  return `M120,120 L${(120 - x).toFixed(1)},${(120 - y).toFixed(1)} A${r},${r} 0 0 1 ${(120 + x).toFixed(1)},${(120 - y).toFixed(1)} Z`
}

type Vec = readonly [number, number, number]

/** Unit rays (east, north, up) through the image corners: top-left, top-right, bottom-right, bottom-left. */
function cornerRays(bearingDeg: number, pitchDeg: number, hfovDeg: number, aspect: number): Vec[] {
  const b = bearingDeg * RAD
  const p = pitchDeg * RAD
  const th = Math.tan((hfovDeg / 2) * RAD)
  const tv = th / aspect
  const f: Vec = [Math.cos(p) * Math.sin(b), Math.cos(p) * Math.cos(b), Math.sin(p)]
  const r: Vec = [Math.cos(b), -Math.sin(b), 0]
  const u: Vec = [-Math.sin(p) * Math.sin(b), -Math.sin(p) * Math.cos(b), Math.cos(p)]
  return [
    [-1, 1],
    [1, 1],
    [1, -1],
    [-1, -1],
  ].map(([sx, sy]) => {
    const d = [0, 1, 2].map((i) => f[i]! + sx! * th * r[i]! + sy! * tv * u[i]!)
    const n = Math.hypot(...d)
    return [d[0]! / n, d[1]! / n, d[2]! / n] as const
  })
}

/**
 * The image footprint on a flat ground plane `altAboveGroundM` below the camera, as [lng, lat]
 * corners; `null` when any corner ray misses the ground within `FOOTPRINT_RANGE_M`.
 */
export function footprint(
  lat: number,
  lon: number,
  altAboveGroundM: number,
  headingDeg: number,
  yawDeg: number,
  pitchDeg: number,
  hfovDeg: number,
  aspect = 16 / 9,
): [number, number][] | null {
  if (altAboveGroundM <= 0) return null
  const rays = cornerRays(bearingOf(headingDeg, yawDeg), pitchDeg, hfovDeg, aspect)
  const kLat = 1 / M_PER_DEG_LAT
  const kLng = 1 / (M_PER_DEG_LAT * Math.cos(lat * RAD))
  const hits = rays.map(([e, n, up]) => {
    if (up >= 0) return null
    const t = altAboveGroundM / -up
    return t > FOOTPRINT_RANGE_M ? null : ([lon + e * t * kLng, lat + n * t * kLat] as [number, number])
  })
  return hits.every((h) => h !== null) ? (hits as [number, number][]) : null
}
