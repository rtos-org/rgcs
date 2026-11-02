// REST calls for the shared survey camera list (served by /api/survey-cameras).
import { apiFetch } from '../../shared/api/client'
import type { SurveyCamera } from '../../shared/api/types'
import type { SurveyCameraValues } from './spec'

const BASE = '/api/survey-cameras'

export const listCameras = (): Promise<SurveyCamera[]> => apiFetch(BASE)
export const createCamera = (c: SurveyCamera): Promise<SurveyCamera> => apiFetch(BASE, { method: 'POST', body: c })
export const updateCamera = (id: number, c: SurveyCamera): Promise<SurveyCamera> => apiFetch(`${BASE}/${id}`, { method: 'PUT', body: c })
export const deleteCamera = (id: number): Promise<unknown> => apiFetch(`${BASE}/${id}`, { method: 'DELETE' })

export const toValues = (c: SurveyCamera): SurveyCameraValues => ({
  name: c.name,
  sensorWmm: c.sensor_w_mm,
  sensorHmm: c.sensor_h_mm,
  imageWpx: c.image_w_px,
  imageHpx: c.image_h_px,
  focalMm: c.focal_mm,
  shutterS: c.shutter_s,
  minIntervalS: c.min_interval_s,
})

/** A new user camera (no id, never built-in) from the values in the form. */
export const fromValues = (v: SurveyCameraValues): SurveyCamera => ({
  id: null,
  name: v.name,
  sensor_w_mm: v.sensorWmm,
  sensor_h_mm: v.sensorHmm,
  image_w_px: v.imageWpx,
  image_h_px: v.imageHpx,
  focal_mm: v.focalMm,
  shutter_s: v.shutterS,
  min_interval_s: v.minIntervalS,
  builtin: false,
})

const positive = (n: number) => Number.isFinite(n) && n > 0

/** Whether a camera can be sent to the server: finite positive numbers, whole pixel counts, shutter of 1 s or faster. */
export const validCameraValues = (v: SurveyCameraValues): boolean =>
  positive(v.sensorWmm) &&
  positive(v.sensorHmm) &&
  Number.isInteger(v.imageWpx) &&
  v.imageWpx > 0 &&
  Number.isInteger(v.imageHpx) &&
  v.imageHpx > 0 &&
  positive(v.focalMm) &&
  positive(v.shutterS) &&
  v.shutterS <= 1 &&
  positive(v.minIntervalS)
