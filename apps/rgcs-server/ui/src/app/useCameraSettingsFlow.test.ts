import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CameraCommand, CameraProfile, CameraState, CommandResult, GimbalInputProfile, RoiControl, RoiTarget, VehicleState } from '../shared/api/types'
import { DEFAULT_PROFILE } from '../features/gimbal-joystick/profile'
import { mapUiStore } from '../features/map/store'
import { DEFAULT_ROI_CONTROL, emptyTargets } from '../features/roi/schema'
import type { SheetDraft } from '../features/camera-settings/CameraSettingsSheet'
import type { Modal } from './modal'
import { ApiError } from '../shared/api/client'
import { t } from '../shared/i18n'

const calls: string[] = []
let stored: CameraProfile
const results: CommandResult[] = []
const profile = { sysid: 1, kind: 'siyi_mt11', host: '192.168.144.25', port: 37260, rtsp_url: 'rtsp://{host}:8554/video1', comp_id: 100, encoding_preset: 'h264_1080p', thermal_palette: 3, thermal_overlay: true, ai_box_px: 100, auto_record: true } as CameraProfile
const api = {
  getCameraProfile: vi.fn(async () => profile),
  // the server answers with the whole stored row
  putCameraProfile: vi.fn(async (_s: number, p: Partial<CameraProfile>) => (calls.push('kind' in p ? 'camera' : 'video'), (stored = { ...stored, ...p }))),
  sendCameraCommand: vi.fn(async (_s: number, c: CameraCommand) => void calls.push(`cmd:${c.cmd}`)),
  getRoiTargets: vi.fn(async () => emptyTargets()),
  getRoiControl: vi.fn(async () => DEFAULT_ROI_CONTROL),
  putRoiTargets: vi.fn(async (_s: number, t: readonly RoiTarget[]) => (calls.push('targets'), [...t])),
  putRoiControl: vi.fn(async (_s: number, c: RoiControl) => (calls.push('control'), c)),
  putGimbalProfile: vi.fn(async (p: GimbalInputProfile) => (calls.push('gimbal'), p)),
}
vi.mock('../features/camera/api', () => ({ getCameraProfile: () => api.getCameraProfile(), putCameraProfile: (s: number, p: Partial<CameraProfile>) => api.putCameraProfile(s, p), sendCameraCommand: (s: number, c: CameraCommand) => api.sendCameraCommand(s, c) }))
vi.mock('../features/roi/api', () => ({
  getRoiTargets: () => api.getRoiTargets(),
  getRoiControl: () => api.getRoiControl(),
  putRoiTargets: (s: number, t: readonly RoiTarget[]) => api.putRoiTargets(s, t),
  putRoiControl: (s: number, c: RoiControl) => api.putRoiControl(s, c),
}))
vi.mock('../features/gimbal-joystick/api', () => ({ putGimbalProfile: (p: GimbalInputProfile) => api.putGimbalProfile(p) }))
vi.mock('../features/vehicles/store', () => ({ vehicleStore: { pushLocalResult: (r: CommandResult) => results.push(r) } }))
const { useCameraSettingsFlow } = await import('./useCameraSettingsFlow')
const { roiTargetsStore } = await import('../features/roi/targetsStore')
const { cameraProfileStore } = await import('../features/camera/profileStore')

const draft: SheetDraft = { tab: 'connection', camera: { kind: 'siyi_mt11', host: '192.168.144.25', port: 37260, video_source_mode: 'auto', rtsp_url: 'rtsp://{host}:8554/video1', comp_id: 100 }, input: DEFAULT_PROFILE, roiTargets: emptyTargets(), roiControl: DEFAULT_ROI_CONTROL, video: { encoding_preset: 'h264_1080p', thermal_palette: 3, thermal_overlay: true, ai_box_px: 100, auto_record: true, gain: null } }

function setup(vehicles: ReadonlyMap<number, VehicleState> = new Map()) {
  const setModal = vi.fn<(m: Modal) => void>()
  const setGimbalProfile = vi.fn()
  const hook = renderHook(({ modal }: { modal: Modal }) => useCameraSettingsFlow({ modal, setModal, terrainTiles: null, vehicles, setGimbalProfile, dict: t('ja') }), {
    initialProps: { modal: { kind: 'camera-settings', sysid: 1 } as Modal },
  })
  return { ...hook, setModal, setGimbalProfile }
}

describe('useCameraSettingsFlow', () => {
  beforeEach(() => {
    calls.length = 0
    stored = profile
    results.length = 0
    vi.clearAllMocks()
  })

  it('loads the profile and the ROI settings when the sheet opens', async () => {
    const { result } = setup()
    await waitFor(() => expect(result.current.profile).toEqual(profile))
    expect(result.current.roi).toEqual({ targets: emptyTargets(), control: DEFAULT_ROI_CONTROL })
  })

  it('save calls the four PUTs in order and reports one success', async () => {
    const { result, setModal, setGimbalProfile } = setup()
    await waitFor(() => expect(result.current.roi).not.toBeNull())
    const targets = emptyTargets().map((x, i) => (i === 0 ? { ...x, name: 'A', lat: 36, lon: 139 } : x))
    await act(() => result.current.save(1, { ...draft, roiTargets: targets }))
    expect(calls).toEqual(['camera', 'targets', 'control', 'gimbal'])
    expect(roiTargetsStore.get(1)?.[0]?.name).toBe('A')
    expect(setGimbalProfile).toHaveBeenCalledWith(DEFAULT_PROFILE)
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ sysid: 1, cmd: 'camera_settings', ok: true })
    expect(setModal).toHaveBeenLastCalledWith({ kind: 'none' })
  })

  it('save skips the camera profile PUT when the connection fields did not change (keeps an active ROI)', async () => {
    api.getCameraProfile.mockResolvedValueOnce({ ...profile, video_source_mode: 'auto' })
    const { result } = setup()
    await waitFor(() => expect(result.current.roi).not.toBeNull())
    await act(() => result.current.save(1, draft))
    expect(calls).toEqual(['targets', 'control', 'gimbal'])
    expect(results[0]).toMatchObject({ ok: true })
  })

  it('a changed component id or RTSP URL is a connection change', async () => {
    const { cameraChanged } = await import('./useCameraSettingsFlow')
    const saved = { ...profile, video_source_mode: 'auto' } as CameraProfile
    expect(cameraChanged(saved, draft.camera)).toBe(false)
    expect(cameraChanged(saved, { ...draft.camera, comp_id: 154 })).toBe(true)
    expect(cameraChanged(saved, { ...draft.camera, rtsp_url: 'rtsp://192.168.144.25:8554/main' })).toBe(true)
  })

  it('a failing targets PUT reports one failure and skips the rest', async () => {
    api.putRoiTargets.mockRejectedValueOnce(new Error('targets[0].lat: out of range'))
    const { result } = setup()
    await waitFor(() => expect(result.current.roi).not.toBeNull())
    await act(() => result.current.save(1, draft))
    expect(calls).toEqual(['camera'])
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ ok: false, reason: 'targets[0].lat: out of range' })
  })

  it('skips the ROI PUTs when the ROI settings could not be loaded', async () => {
    api.getRoiTargets.mockRejectedValueOnce(new Error('404'))
    const { result } = setup()
    await waitFor(() => expect(result.current.profile).not.toBeNull())
    expect(result.current.roi).toBeNull()
    await act(() => result.current.save(1, draft))
    expect(calls).toEqual(['camera', 'gimbal'])
  })

  it('a map pick without terrain uses the home altitude and reopens the sheet on the ROI tab', async () => {
    const home = { lat: 35.469883, lon: 138.46829, alt: 412 }
    const { result, setModal, rerender } = setup(new Map([[1, { sysid: 1, home } as VehicleState]]))
    await waitFor(() => expect(result.current.profile).not.toBeNull())
    act(() => result.current.startPick(1, draft, 0))
    expect(setModal).toHaveBeenLastCalledWith({ kind: 'none' })
    expect(mapUiStore.getState().pick).toBe('roi-target')
    rerender({ modal: { kind: 'none' } })
    expect(result.current.pickHint).toBe('picking')
    await act(() => result.current.onMapPick({ lat: 36.1234567, lon: 139.7654321 }))
    expect(setModal).toHaveBeenLastCalledWith({ kind: 'camera-settings', sysid: 1 })
    rerender({ modal: { kind: 'camera-settings', sysid: 1 } })
    expect(mapUiStore.getState().pick).toBe('none')
    expect(result.current.pickHint).toBe('none')
    expect(result.current.elevationFallback).toBe(true)
    expect(result.current.draft?.tab).toBe('roi')
    expect(result.current.draft?.roiTargets[0]).toEqual({ id: 'roi_1', name: 'ROI 1', lat: 36.123457, lon: 139.765432, alt_msl: 412 })
  })

  it('cancelling a pick returns to the sheet with the draft unchanged', () => {
    const { result, setModal, rerender } = setup()
    act(() => result.current.startPick(1, draft, 2))
    rerender({ modal: { kind: 'none' } })
    act(() => result.current.cancelPick())
    expect(mapUiStore.getState().pick).toBe('none')
    expect(setModal).toHaveBeenLastCalledWith({ kind: 'camera-settings', sysid: 1 })
    rerender({ modal: { kind: 'camera-settings', sysid: 1 } })
    expect(result.current.draft).toEqual({ ...draft, tab: 'roi' })
  })

  describe('the 映像 tab', () => {
    const full = { ...profile, video_source_mode: 'auto' } as CameraProfile
    const state = { thermal: { gain: 'high', range_c: null, frame: null, point: null } } as unknown as CameraState
    const edited = { ...draft, video: { ...draft.video, encoding_preset: 'h265_4k' as const, ai_box_px: 150, gain: 'low' as const } }

    it('PUTs the video patch, stores the result, then sends the live commands', async () => {
      api.getCameraProfile.mockResolvedValueOnce(full)
      const { result } = setup()
      await waitFor(() => expect(result.current.roi).not.toBeNull())
      await act(() => result.current.save(1, edited, state))
      expect(calls).toEqual(['video', 'cmd:encoding', 'cmd:thermal_gain', 'targets', 'control', 'gimbal'])
      expect(api.putCameraProfile).toHaveBeenCalledWith(1, { encoding_preset: 'h265_4k', ai_box_px: 150 })
      expect(api.sendCameraCommand).toHaveBeenCalledWith(1, { cmd: 'encoding', args: { preset: 'h265_4k' } })
      expect(cameraProfileStore.get(1)).toMatchObject({ encoding_preset: 'h265_4k', ai_box_px: 150 })
      expect(results).toEqual([expect.objectContaining({ ok: true })])
    })

    it('a connection change stores the camera PUT result and skips the commands', async () => {
      api.getCameraProfile.mockResolvedValueOnce(full)
      const { result } = setup()
      await waitFor(() => expect(result.current.roi).not.toBeNull())
      await act(() => result.current.save(1, { ...edited, camera: { ...edited.camera, host: '10.0.0.7' } }, state))
      expect(calls).toEqual(['camera', 'video', 'targets', 'control', 'gimbal'])
      expect(api.sendCameraCommand).not.toHaveBeenCalled()
      expect(cameraProfileStore.get(1)).toMatchObject({ host: '10.0.0.7' })
    })

    it('a refused command reports one failure and skips the rest', async () => {
      api.getCameraProfile.mockResolvedValueOnce(full)
      api.sendCameraCommand.mockRejectedValueOnce(new Error('stream_unknown'))
      const { result } = setup()
      await waitFor(() => expect(result.current.roi).not.toBeNull())
      await act(() => result.current.save(1, edited, state))
      expect(calls).toEqual(['video'])
      expect(results).toEqual([expect.objectContaining({ ok: false, reason: 'stream_unknown' })])
    })

    it('an encoding the camera rejects is a translated failure, not saved', async () => {
      api.getCameraProfile.mockResolvedValueOnce(full)
      api.sendCameraCommand.mockRejectedValueOnce(new ApiError(409, 'encoding_rejected', 'refused: encoding_rejected'))
      const { result } = setup()
      await waitFor(() => expect(result.current.roi).not.toBeNull())
      await act(() => result.current.save(1, edited, state))
      expect(calls).toEqual(['video'])
      expect(results).toEqual([expect.objectContaining({ ok: false, reason: 'カメラがこのエンコード設定を拒否しました' })])
    })
  })
})
