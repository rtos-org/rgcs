import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ALPHA7R4 } from './spec'
import { validCameraValues, createCamera, deleteCamera, fromValues, listCameras, toValues, updateCamera } from './cameraApi'

const fetchMock = vi.fn()
vi.mock('../../shared/api/client', () => ({ apiFetch: (...a: unknown[]) => fetchMock(...a) }))

const row = { id: 3, name: 'X', sensor_w_mm: 1, sensor_h_mm: 2, image_w_px: 3, image_h_px: 4, focal_mm: 5, shutter_s: 0.002, min_interval_s: 0.5, builtin: false }

describe('cameraApi', () => {
  beforeEach(() => fetchMock.mockReset().mockResolvedValue(row))

  it('maps_snake_case_rows_to_camel_values', () => {
    expect(toValues(row)).toEqual({ name: 'X', sensorWmm: 1, sensorHmm: 2, imageWpx: 3, imageHpx: 4, focalMm: 5, shutterS: 0.002, minIntervalS: 0.5 })
  })

  it('fromValues_makes_a_user_row_without_id', () => {
    expect(fromValues(ALPHA7R4)).toMatchObject({ id: null, builtin: false, sensor_w_mm: 35.7, shutter_s: 0.001 })
  })

  it('calls_the_survey_camera_routes', async () => {
    await listCameras()
    expect(fetchMock).toHaveBeenLastCalledWith('/api/survey-cameras')
    await createCamera(row)
    expect(fetchMock).toHaveBeenLastCalledWith('/api/survey-cameras', { method: 'POST', body: row })
    await updateCamera(3, row)
    expect(fetchMock).toHaveBeenLastCalledWith('/api/survey-cameras/3', { method: 'PUT', body: row })
    await deleteCamera(3)
    expect(fetchMock).toHaveBeenLastCalledWith('/api/survey-cameras/3', { method: 'DELETE' })
  })

  it('validCameraValues_rejects_non_finite_non_positive_fractional_pixels_and_slow_shutter', () => {
    expect(validCameraValues(ALPHA7R4)).toBe(true)
    for (const bad of [{ focalMm: 0 }, { sensorWmm: -1 }, { sensorHmm: NaN }, { imageWpx: 1.5 }, { imageHpx: Infinity }, { shutterS: 2 }, { shutterS: 0 }, { minIntervalS: -1 }, { minIntervalS: 0 }]) {
      expect(validCameraValues({ ...ALPHA7R4, ...bad })).toBe(false)
    }
  })
})
