// Photogrammetry camera math: ground sample distance, footprint, spacing, blur, turn radius.
import type { SurveyCameraValues, SurveySpec } from './spec'

export interface Footprint {
  readonly alongM: number
  readonly acrossM: number
}

const G = 9.80665

export const gsdCm = (cam: SurveyCameraValues, altM: number): number => ((cam.sensorWmm * altM) / (cam.focalMm * cam.imageWpx)) * 100

export const altForGsd = (cam: SurveyCameraValues, gsd: number): number => ((gsd / 100) * cam.focalMm * cam.imageWpx) / cam.sensorWmm

/** Landscape: the long sensor side is across track. */
export function footprint(cam: SurveyCameraValues, altM: number, orientation: SurveySpec['orientation']): Footprint {
  const wide = (cam.sensorWmm * altM) / cam.focalMm
  const tall = (cam.sensorHmm * altM) / cam.focalMm
  return orientation === 'landscape' ? { alongM: tall, acrossM: wide } : { alongM: wide, acrossM: tall }
}

export const triggerDistM = (fp: Footprint, frontPct: number): number => fp.alongM * (1 - frontPct / 100)

export const laneSpacingM = (fp: Footprint, sidePct: number): number => fp.acrossM * (1 - sidePct / 100)

export function blur(cam: SurveyCameraValues, groundMs: number, gsd: number): { cm: number; px: number } {
  const cm = groundMs * cam.shutterS * 100
  return { cm, px: cm / gsd }
}

export const turnRadiusM = (groundMs: number, bankDeg: number): number => (groundMs * groundMs) / (G * Math.tan((bankDeg * Math.PI) / 180))
