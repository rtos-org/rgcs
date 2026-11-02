// Survey (photogrammetry grid) specification: what the user configures, stored with the mission.
import { z } from 'zod'
import type { LatLon } from '../mission/geo'

const latLon = z.object({ lat: z.number().min(-90).max(90), lon: z.number().min(-180).max(180) })
/** As many vertices as a KML ring may bring (kml.ts MAX_RING_VERTICES). */
export const MAX_POLYGON_VERTICES = 10_000

const cameraSchema = z.object({
  name: z.string(),
  sensorWmm: z.number().positive(),
  sensorHmm: z.number().positive(),
  imageWpx: z.number().int().positive(),
  imageHpx: z.number().int().positive(),
  focalMm: z.number().positive(),
  shutterS: z.number().positive(),
  minIntervalS: z.number().min(0),
})

export const surveySpecSchema = z.object({
  version: z.literal(1),
  name: z.string(),
  polygon: z.array(latLon).max(MAX_POLYGON_VERTICES),
  camera: cameraSchema,
  orientation: z.enum(['landscape', 'portrait']),
  altM: z.number().min(5).max(1000),
  frontPct: z.number().min(0).max(95),
  sidePct: z.number().min(0).max(95),
  angleDeg: z.number(),
  start: z.enum(['nw', 'ne', 'sw', 'se', 'home']),
  speedMs: z.number().positive(),
  windMs: z.number().min(0),
  skip: z.number().int().min(0).max(10),
  turn: z.enum(['split', 'arc']),
  bankDeg: z.number().min(5).max(60),
  leadInM: z.number().min(0).nullable(),
  overshootM: z.number().min(0).nullable(),
  marginM: z.number().min(0).nullable(),
  airframe: z.enum(['plane', 'copter']),
  wpRadiusM: z.number().positive(),
})

export type SurveySpec = z.infer<typeof surveySpecSchema>
export type SurveyCameraValues = z.infer<typeof cameraSchema>

export const ALPHA7R4: SurveyCameraValues = {
  name: 'Sony α7R IV 35mm',
  sensorWmm: 35.7,
  sensorHmm: 23.8,
  imageWpx: 9504,
  imageHpx: 6336,
  focalMm: 35,
  shutterS: 0.001,
  minIntervalS: 1.0,
}

/** Compass bearing (0 = north, clockwise) of the longest edge, folded into [0, 180). */
function longestEdgeBearing(polygon: readonly LatLon[]): number {
  const cosLat = polygon.length ? Math.cos((polygon[0].lat * Math.PI) / 180) : 1
  let best = { len: -1, bearing: 0 }
  polygon.forEach((a, i) => {
    const b = polygon[(i + 1) % polygon.length]
    const east = (b.lon - a.lon) * cosLat
    const north = b.lat - a.lat
    const len = Math.hypot(east, north)
    if (len > best.len) best = { len, bearing: (Math.atan2(east, north) * 180) / Math.PI }
  })
  return (((best.bearing % 180) + 180) % 180)
}

export function defaultSpec(
  polygon: readonly LatLon[],
  camera: SurveyCameraValues,
  airframe: SurveySpec['airframe'],
  opts: { bankDeg?: number; wpRadiusM?: number; speedMs?: number } = {},
): SurveySpec {
  return {
    version: 1,
    name: '',
    polygon: polygon.map((p) => ({ lat: p.lat, lon: p.lon })),
    camera,
    orientation: 'landscape',
    altM: 100,
    frontPct: 80,
    sidePct: 70,
    angleDeg: polygon.length > 1 ? longestEdgeBearing(polygon) : 0,
    start: 'home',
    speedMs: opts.speedMs ?? (airframe === 'plane' ? 18 : 8),
    windMs: 0,
    skip: 0,
    turn: 'split',
    bankDeg: opts.bankDeg ?? 30,
    leadInM: null,
    overshootM: null,
    marginM: null,
    airframe,
    wpRadiusM: opts.wpRadiusM ?? 90,
  }
}
