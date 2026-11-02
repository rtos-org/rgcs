import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CameraProfile } from '../../shared/api/types'

const getCameraProfile = vi.fn<(sysid: number) => Promise<CameraProfile>>()
vi.mock('./api', () => ({ getCameraProfile: (sysid: number) => getCameraProfile(sysid) }))
const { cameraProfileStore, useCameraProfile } = await import('./profileStore')

const profile = (sysid: number, over: Partial<CameraProfile> = {}): CameraProfile => ({
  sysid, kind: 'siyi_mt11', host: '192.168.144.25', port: 37260, rtsp_url: 'rtsp://{host}:8554/video1', comp_id: 100, video_source_mode: 'auto',
  android_url: '', encoding_preset: 'h264_1080p', thermal_palette: 3, thermal_overlay: true, ai_box_px: 100, clock_sync: true, auto_record: false, ...over,
})

describe('cameraProfileStore', () => {
  beforeEach(() => {
    getCameraProfile.mockReset()
  })

  it('useCameraProfile fetches once per vehicle', async () => {
    getCameraProfile.mockResolvedValue(profile(2))
    const a = renderHook(() => useCameraProfile(2))
    const b = renderHook(() => useCameraProfile(2))
    await waitFor(() => expect(a.result.current?.ai_box_px).toBe(100))
    expect(b.result.current?.sysid).toBe(2)
    expect(getCameraProfile).toHaveBeenCalledTimes(1)
  })

  it('set updates subscribers without a fetch', async () => {
    getCameraProfile.mockResolvedValue(profile(3))
    const { result } = renderHook(() => useCameraProfile(3))
    await waitFor(() => expect(result.current).not.toBeNull())
    act(() => cameraProfileStore.set(3, profile(3, { ai_box_px: 250 })))
    expect(result.current?.ai_box_px).toBe(250)
    expect(getCameraProfile).toHaveBeenCalledTimes(1)
  })

  it('invalidate refetches', async () => {
    getCameraProfile.mockResolvedValue(profile(4))
    const { result } = renderHook(() => useCameraProfile(4))
    await waitFor(() => expect(result.current).not.toBeNull())
    getCameraProfile.mockResolvedValue(profile(4, { thermal_overlay: false }))
    act(() => cameraProfileStore.invalidate(4))
    await waitFor(() => expect(result.current?.thermal_overlay).toBe(false))
    expect(getCameraProfile).toHaveBeenCalledTimes(2)
  })

  it('null sysid gives null and fetches nothing', () => {
    const { result } = renderHook(() => useCameraProfile(null))
    expect(result.current).toBeNull()
    expect(getCameraProfile).not.toHaveBeenCalled()
  })
})
