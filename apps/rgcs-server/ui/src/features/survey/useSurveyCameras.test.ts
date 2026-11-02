import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ALPHA7R4 } from './spec'
import * as api from './cameraApi'
import { useSurveyCameras } from './useSurveyCameras'

vi.mock('./cameraApi', async (orig) => ({ ...(await orig<typeof api>()), listCameras: vi.fn(), createCamera: vi.fn(), updateCamera: vi.fn(), deleteCamera: vi.fn() }))

const built = { ...api.fromValues(ALPHA7R4), id: 1, builtin: true }

describe('useSurveyCameras', () => {
  beforeEach(() => {
    vi.mocked(api.listCameras).mockReset().mockResolvedValue([built])
    vi.mocked(api.createCamera).mockReset()
  })

  it('loads_the_list', async () => {
    const { result } = renderHook(() => useSurveyCameras())
    await waitFor(() => expect(result.current.cameras).toEqual([built]))
    expect(result.current.error).toBeNull()
  })

  it('saveAs_creates_a_non_builtin_camera_with_the_name_and_reloads', async () => {
    vi.mocked(api.createCamera).mockResolvedValue({ ...api.fromValues(ALPHA7R4), id: 2, name: 'Mine' })
    const { result } = renderHook(() => useSurveyCameras())
    await waitFor(() => expect(result.current.cameras).toHaveLength(1))
    await act(async () => {
      await result.current.saveAs(ALPHA7R4, 'Mine')
    })
    expect(api.createCamera).toHaveBeenCalledWith(expect.objectContaining({ name: 'Mine', builtin: false, id: null, sensor_w_mm: 35.7 }))
    expect(api.listCameras).toHaveBeenCalledTimes(2)
  })

  it('reports_a_failed_load', async () => {
    vi.mocked(api.listCameras).mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useSurveyCameras())
    await waitFor(() => expect(result.current.error).toEqual({ code: 'load_failed', detail: 'boom' }))
  })

  const ready = async () => {
    const h = renderHook(() => useSurveyCameras())
    await waitFor(() => expect(h.result.current.cameras).toHaveLength(1))
    return h
  }

  it('update_and_remove_call_the_api_and_reload', async () => {
    vi.mocked(api.updateCamera).mockResolvedValue(built)
    vi.mocked(api.deleteCamera).mockResolvedValue({})
    const { result } = await ready()
    await act(async () => {
      expect(await result.current.update(5, ALPHA7R4)).toEqual(built)
      expect(await result.current.remove(5)).toBe(true)
    })
    expect(api.updateCamera).toHaveBeenCalledWith(5, expect.objectContaining({ id: 5, builtin: false }))
    expect(api.deleteCamera).toHaveBeenCalledWith(5)
    expect(api.listCameras).toHaveBeenCalledTimes(3)
  })

  it('create_update_remove_failures_set_error_and_return_null', async () => {
    vi.mocked(api.createCamera).mockRejectedValue(new Error('c'))
    vi.mocked(api.updateCamera).mockRejectedValue(new Error('u'))
    vi.mocked(api.deleteCamera).mockRejectedValue(new Error('d'))
    const { result } = await ready()
    for (const [run, msg] of [
      [() => result.current.saveAs(ALPHA7R4, 'n'), 'c'],
      [() => result.current.update(5, ALPHA7R4), 'u'],
      [() => result.current.remove(5), 'd'],
    ] as const) {
      let out: unknown = 'x'
      await act(async () => {
        out = await run()
      })
      expect(out).toBeNull()
      expect(result.current.error).toEqual({ code: 'save_failed', detail: msg })
    }
  })

  it('refuses_invalid_values_without_calling_the_api', async () => {
    const { result } = await ready()
    await act(async () => {
      expect(await result.current.saveAs({ ...ALPHA7R4, focalMm: 0 }, 'n')).toBeNull()
      expect(await result.current.update(5, { ...ALPHA7R4, imageWpx: 1.5 })).toBeNull()
    })
    expect(api.createCamera).not.toHaveBeenCalled()
    expect(api.updateCamera).not.toHaveBeenCalled()
    expect(result.current.error).toEqual({ code: 'invalid', detail: null })
  })
})
