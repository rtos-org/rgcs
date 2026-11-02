import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { CameraCaps, CameraProfile, CameraState } from '../../shared/api/types'
import { t } from '../../shared/i18n'
import { DEFAULT_PROFILE } from '../gimbal-joystick'
import { DEFAULT_ROI_CONTROL, emptyTargets } from '../roi'
import { CameraSettingsSheet } from './CameraSettingsSheet'

const profile = (over: Partial<CameraProfile> = {}): CameraProfile => ({
  sysid: 1, kind: 'none', host: '192.168.144.25', port: 37260, rtsp_url: 'rtsp://{host}:8554/video1', comp_id: 100, video_source_mode: 'auto',
  android_url: '', encoding_preset: 'h264_1080p', thermal_palette: 3, thermal_overlay: true, ai_box_px: 100, clock_sync: true, auto_record: true, ...over,
})
const camState: CameraState = { connected: true, last_error: null, firmware: { camera: 'v1.0.1', gimbal: 'v0.1.10', zoom: 'v0.0.0' }, recording: 'idle', zoom: 1, zoom_max: 165, video_mode: 'rgb', gimbal: null, gimbal_mode: 'follow', stream: null, encoding: null, thermal: null, track: null, candidates: [], ai_ack: null, storage: null, clock: null }

const roi = { targets: emptyTargets(), control: DEFAULT_ROI_CONTROL }
const dict = t('ja')
const preset = (id: string, label: string, codec: 'h264' | 'h265', width: number, height: number) => ({ id, label, codec, width, height })
const mt11Caps = {
  kind: 'siyi_mt11', gimbal: null, zoom: null, focus: true, photo: true, record: true, video_modes: ['rgb', 'thermal', 'side_by_side'], hfov_deg: 60, roi: 'computed',
  thermal: { gains: ['high', 'low'], palettes: [0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], point_temp: true, frame_temp: true },
  ai_tracking: { box_select: true, point_select: true, candidates: true },
  encoding_presets: [preset('h264_720p', 'H.264 1280×720', 'h264', 1280, 720), preset('h264_1080p', 'H.264 1920×1080', 'h264', 1920, 1080), preset('h264_4k', 'H.264 3840×2160', 'h264', 3840, 2160), preset('h265_1080p', 'H.265 1920×1080', 'h265', 1920, 1080), preset('h265_4k', 'H.265 3840×2160', 'h265', 3840, 2160)],
  storage_info: true, clock_sync: true,
} as unknown as CameraCaps
const mavCaps = { ...mt11Caps, kind: 'mavlink', thermal: null, ai_tracking: null, encoding_presets: [], storage_info: false, clock_sync: false } as CameraCaps
const base = { caps: mt11Caps, sysid: 1, inputProfile: DEFAULT_PROFILE, cameraState: camState, gamepadIds: ['Pad A'], roiSupported: true, roi, activeRoi: null, onPickRoi: () => {}, onCancel: () => {}, onCenter: () => {}, onSyncClock: () => {}, clockSync: true, dict: t('ja') }

describe('CameraSettingsSheet', () => {
  it('kind none hides host/port; choosing MT11 shows them with the rtsp preview', () => {
    render(<CameraSettingsSheet {...base} profile={profile()} onSave={() => {}} />)
    expect(screen.queryByLabelText('IP')).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('カメラ種別'), { target: { value: 'siyi_mt11' } })
    expect(screen.getByLabelText('IP')).toHaveValue('192.168.144.25')
    expect(screen.getByLabelText('制御ポート')).toHaveValue(37260)
    expect(screen.getByText('rtsp://192.168.144.25:8554/video1')).toBeInTheDocument()
    expect(screen.getByText(/v1\.0\.1/)).toBeInTheDocument()
  })

  it('MAVLink カメラ is enabled: component id + RTSP URL; the URL host becomes the saved host', () => {
    const onSave = vi.fn()
    render(<CameraSettingsSheet {...base} caps={mavCaps} profile={profile()} onSave={onSave} />)
    const option = screen.getByRole('option', { name: 'MAVLink カメラ' })
    expect(option).toBeEnabled()
    fireEvent.change(screen.getByLabelText('カメラ種別'), { target: { value: 'mavlink' } })
    expect(screen.getByLabelText('コンポーネント ID')).toHaveValue(100)
    expect(screen.getByLabelText('RTSP URL')).toBeInTheDocument()
    for (const label of ['IP', '制御ポート']) expect(screen.queryByLabelText(label)).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: '映像ソース' })).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('RTSP URL'), { target: { value: 'rtsp://192.168.144.30:8554/main' } })
    fireEvent.change(screen.getByLabelText('コンポーネント ID'), { target: { value: '154' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(onSave.mock.calls[0]![0].camera).toMatchObject({ kind: 'mavlink', host: '192.168.144.30', rtsp_url: 'rtsp://192.168.144.30:8554/main', comp_id: 154 })
  })

  it('a MAVLink RTSP URL without an IPv4 host marks the input and blocks save', () => {
    render(<CameraSettingsSheet {...base} caps={mavCaps} profile={profile({ kind: 'mavlink', rtsp_url: 'rtsp://192.168.144.25:8554/main' })} onSave={() => {}} />)
    fireEvent.change(screen.getByLabelText('RTSP URL'), { target: { value: 'rtsp://cam.local/main' } })
    expect(screen.getByLabelText('RTSP URL')).toHaveClass('invalid')
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
  })

  it('the MAVLink status box shows the connection and cam firmware only', () => {
    const live: CameraState = { ...camState, firmware: { camera: '1.2.3', gimbal: '', zoom: '' } }
    render(<CameraSettingsSheet {...base} caps={mavCaps} cameraState={live} profile={profile({ kind: 'mavlink', rtsp_url: 'rtsp://192.168.144.25:8554/main' })} onSave={() => {}} />)
    expect(screen.getByText('接続中')).toBeInTheDocument()
    expect(screen.getByText('cam 1.2.3')).toBeInTheDocument()
    for (const label of ['SDカード', 'カメラ時刻']) expect(screen.queryByText(label)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '今すぐ同期' })).not.toBeInTheDocument()
  })

  it('invalid port shows red and keeps save disabled', () => {
    render(<CameraSettingsSheet {...base} profile={profile({ kind: 'siyi_mt11' })} onSave={() => {}} />)
    fireEvent.change(screen.getByLabelText('制御ポート'), { target: { value: '0' } })
    expect(screen.getByLabelText('制御ポート')).toHaveClass('invalid')
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
  })

  it('save calls onSave with both profiles after edits on both tabs', async () => {
    const onSave = vi.fn()
    render(<CameraSettingsSheet {...base} profile={profile({ kind: 'siyi_mt11' })} onSave={onSave} />)
    fireEvent.change(screen.getByLabelText('IP'), { target: { value: '10.0.0.5' } })
    fireEvent.click(screen.getByRole('button', { name: '操作' }))
    fireEvent.change(screen.getByLabelText('最大パン速度'), { target: { value: '45' } })
    fireEvent.change(screen.getByLabelText('軸 1 の機能'), { target: { value: 'none' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1))
    const { camera: cam, input } = onSave.mock.calls[0]![0]
    expect(cam).toMatchObject({ kind: 'siyi_mt11', host: '10.0.0.5', port: 37260 })
    expect(input.max_pan_speed).toBe(45)
    expect(input.axes[1]?.fn).toBe('none')
  })

  it('center button sends the gimbal centre command', () => {
    const onCenter = vi.fn()
    render(<CameraSettingsSheet {...base} profile={profile({ kind: 'siyi_mt11' })} onSave={() => {}} onCenter={onCenter} />)
    fireEvent.click(screen.getByRole('button', { name: '操作' }))
    fireEvent.click(screen.getByRole('button', { name: 'ジンバルをセンター' }))
    expect(onCenter).toHaveBeenCalledTimes(1)
  })

  it('the ROI tab is clickable only when the camera supports ROI', () => {
    const { unmount } = render(<CameraSettingsSheet {...base} roiSupported={false} profile={profile()} onSave={() => {}} />)
    const tab = screen.getByRole('button', { name: 'ROI' })
    expect(tab).toHaveAttribute('aria-disabled', 'true')
    fireEvent.click(tab)
    expect(screen.queryByText(dict.roiPresets)).not.toBeInTheDocument()
    unmount()
    render(<CameraSettingsSheet {...base} profile={profile({ kind: 'siyi_mt11' })} onSave={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'ROI' }))
    expect(screen.getByText(dict.roiPresets)).toBeInTheDocument()
  })

  it('an invalid ROI control disables save', () => {
    render(<CameraSettingsSheet {...base} profile={profile({ kind: 'siyi_mt11' })} onSave={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: 'ROI' }))
    fireEvent.change(screen.getByLabelText(dict.roiMaxSpeed), { target: { value: '500' } })
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
  })

  it('onSave receives the ROI targets and control', () => {
    const onSave = vi.fn()
    render(<CameraSettingsSheet {...base} profile={profile({ kind: 'siyi_mt11' })} onSave={onSave} />)
    fireEvent.click(screen.getByRole('button', { name: 'ROI' }))
    fireEvent.change(screen.getByLabelText(`${dict.roiName} 1`), { target: { value: 'ゲート' } })
    fireEvent.click(screen.getByRole('button', { name: '角度制御' }))
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    const draft = onSave.mock.calls[0]![0]
    expect(draft.roiTargets[0].name).toBe('ゲート')
    expect(draft.roiControl.control_mode).toBe('angle')
    expect(draft.tab).toBe('roi')
  })

  it('pick on map hands the draft and the next empty slot to onPickRoi', () => {
    const onPickRoi = vi.fn()
    render(<CameraSettingsSheet {...base} profile={profile({ kind: 'siyi_mt11' })} onSave={() => {}} onPickRoi={onPickRoi} />)
    fireEvent.click(screen.getByRole('button', { name: 'ROI' }))
    fireEvent.change(screen.getByLabelText(`${dict.roiName} 1`), { target: { value: 'ゲート' } })
    fireEvent.click(screen.getByRole('button', { name: dict.pickOnMap }))
    const [draft, slot] = onPickRoi.mock.calls[0]!
    expect(slot).toBe(0)
    expect(draft.roiTargets[0].name).toBe('ゲート')
  })

  it('with an initial draft it opens on the ROI tab with the drafted rows', () => {
    const targets = emptyTargets().map((x, i) => (i === 0 ? { ...x, name: 'ROI 1', lat: 36.1, lon: 139.1, alt_msl: 412 } : x))
    const initial = { tab: 'roi' as const, camera: { kind: 'siyi_mt11' as const, host: '10.0.0.9', port: 37260, video_source_mode: 'auto' as const, rtsp_url: 'rtsp://{host}:8554/video1', comp_id: 100 }, input: DEFAULT_PROFILE, roiTargets: targets, roiControl: DEFAULT_ROI_CONTROL, video: { encoding_preset: 'h264_1080p' as const, thermal_palette: 3, thermal_overlay: true, ai_box_px: 100, auto_record: true, gain: null } }
    render(<CameraSettingsSheet {...base} profile={profile({ kind: 'siyi_mt11' })} onSave={() => {}} initial={initial} notice="hint text" />)
    expect(screen.getByLabelText(`${dict.roiName} 1`)).toHaveValue('ROI 1')
    expect(screen.getByText('412 m')).toBeInTheDocument()
    expect(screen.getByText('hint text')).toBeInTheDocument()
  })

  it('the connection status shows SD and clock; 今すぐ同期 calls onSyncClock while connected', () => {
    const onSyncClock = vi.fn()
    const live: CameraState = {
      ...camState,
      storage: { status: 'ok', fs: 'exFAT', total_gb: 128, free_gb: 11, free_pct: 9 },
      clock: { camera_unix_us: 1, reading_age_ms: 0, offset_ms: 300, rtt_ms: 10, synced_at_unix_ms: 1, error: null },
    }
    const { rerender } = render(<CameraSettingsSheet {...base} cameraState={live} profile={profile({ kind: 'siyi_mt11' })} onSave={() => {}} onSyncClock={onSyncClock} />)
    expect(screen.getByText('11.0 / 128 GB  9%', { normalizer: (x) => x })).toHaveStyle({ color: 'var(--danger)' })
    expect(screen.getByText('GPS 同期 +0.3 s')).toBeInTheDocument()
    expect(screen.getByText('接続中')).toBeInTheDocument()
    const sync = screen.getByRole('button', { name: '今すぐ同期' })
    expect(sync).toBeEnabled()
    fireEvent.click(sync)
    expect(onSyncClock).toHaveBeenCalledTimes(1)
    rerender(<CameraSettingsSheet {...base} cameraState={{ ...live, connected: false }} profile={profile({ kind: 'siyi_mt11' })} onSave={() => {}} onSyncClock={onSyncClock} />)
    expect(screen.getByRole('button', { name: '今すぐ同期' })).toBeDisabled()
    rerender(<CameraSettingsSheet {...base} cameraState={live} clockSync={false} profile={profile({ kind: 'siyi_mt11' })} onSave={() => {}} onSyncClock={onSyncClock} />)
    expect(screen.getByRole('button', { name: '今すぐ同期' })).toBeDisabled()
  })

  it('the 映像 tab shows encoding, palette and the gain from the camera state', () => {
    const live: CameraState = { ...camState, thermal: { gain: 'high', range_c: [-20, 150], frame: null, point: null } }
    render(<CameraSettingsSheet {...base} cameraState={live} profile={profile({ kind: 'siyi_mt11' })} onSave={() => {}} />)
    const tab = screen.getByRole('button', { name: '映像' })
    expect(tab).not.toHaveAttribute('aria-disabled')
    expect(tab).not.toHaveAttribute('title')
    fireEvent.click(tab)
    const enc = screen.getByLabelText('エンコード')
    expect(enc.querySelectorAll('option')).toHaveLength(5)
    expect(enc).toHaveValue('h264_1080p')
    expect(screen.getByRole('option', { name: 'H.265 3840×2160' })).toBeInTheDocument()
    expect(screen.getByLabelText('パレット').querySelectorAll('option')).toHaveLength(11)
    expect(screen.getByLabelText('パレット')).toHaveValue('3')
    expect(screen.getByRole('button', { name: 'High' })).toHaveClass('on')
    expect(screen.getByText('測定レンジ −20〜150℃')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Low' }))
    expect(screen.getByText('測定レンジ 0〜550℃')).toBeInTheDocument()
  })

  it('an invalid tracking box marks the input and disables save; the draft reaches onSave', () => {
    const onSave = vi.fn()
    render(<CameraSettingsSheet {...base} profile={profile({ kind: 'siyi_mt11' })} onSave={onSave} />)
    fireEvent.click(screen.getByRole('button', { name: '映像' }))
    fireEvent.change(screen.getByLabelText('追跡ボックス'), { target: { value: '20' } })
    expect(screen.getByLabelText('追跡ボックス')).toHaveClass('invalid')
    expect(screen.getByRole('button', { name: '保存' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('追跡ボックス'), { target: { value: '150' } })
    fireEvent.change(screen.getByLabelText('パレット'), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(onSave.mock.calls[0]![0].video).toMatchObject({ ai_box_px: 150, thermal_palette: 5 })
  })

  it('MAVLink caps show only auto record; kind none shows the note', () => {
    const { unmount } = render(<CameraSettingsSheet {...base} caps={mavCaps} profile={profile({ kind: 'siyi_mt11' })} onSave={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: '映像' }))
    for (const label of ['エンコード', 'パレット', '追跡ボックス']) expect(screen.queryByLabelText(label)).not.toBeInTheDocument()
    expect(screen.queryByText('ゲイン')).not.toBeInTheDocument()
    expect(screen.getByText('ARM で自動録画')).toBeInTheDocument()
    unmount()
    render(<CameraSettingsSheet {...base} caps={undefined} profile={profile()} onSave={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: '映像' }))
    expect(screen.queryByLabelText('エンコード')).not.toBeInTheDocument()
    expect(screen.queryByText('ARM で自動録画')).not.toBeInTheDocument()
    expect(screen.getByText(dict.camNoneNote)).toBeInTheDocument()
  })
})
