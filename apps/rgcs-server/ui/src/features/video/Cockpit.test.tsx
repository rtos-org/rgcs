import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CameraCaps, CameraProfile, CameraState, RoiStatus, RoiTarget, VehicleState, VideoSourceStatus } from '../../shared/api/types'
import { cameraProfileStore } from '../camera/profileStore'
import { vehicleStore } from '../vehicles/store'
import { t } from '../../shared/i18n'
import { emptyTargets } from '../roi/schema'

const stats: ((l: { rtt: number | null; jitter: number | null }) => void)[] = []
vi.mock('../../shared/video/whep', () => ({
  WhepPlayer: class {
    constructor(_v: HTMLVideoElement, _url: string, opts: { onStats?: (l: { rtt: number | null; jitter: number | null }) => void }) {
      if (opts.onStats) stats.push(opts.onStats)
    }
    start() {}
    stop() {}
  },
}))

const { Cockpit } = await import('./Cockpit')
const { ZOOM_SLIDER_MAX } = await import('./cockpitView')
const v: VehicleState = {
  sysid: 1, name: 'UAV-01', kind: 'copter', mode: 'AUTO', armed: true, lat: 36, lon: 139, alt_rel: 81.6, alt_msl: 0, hdg: 0,
  ground_speed: 7.25, climb: 0, battery: { pct: 64, volt: 22.1, current: null }, link: 'ok', last_rx_ms: 0,
  gps: { fix: 3, sats: 12, hdop: 1 }, warn: false, unread: 0,
}
const mt11: CameraCaps = {
  kind: 'siyi_mt11',
  gimbal: { rate: true, angle: true, center: true, modes: ['lock', 'follow', 'fpv'], attitude: true, pitch_range: [-90, 30] },
  zoom: { max: 165, absolute: true, step: true, continuous: true, unit: 'times' },
  focus: true, photo: true, record: true, video_modes: ['rgb', 'thermal', 'side_by_side'], hfov_deg: 62, roi: 'computed', thermal: null, ai_tracking: null, encoding_presets: [], storage_info: false, clock_sync: false,
}
const state: CameraState = {
  connected: true, last_error: null, firmware: null, recording: 'idle', zoom: 1, zoom_max: 165, video_mode: 'rgb',
  gimbal: { yaw: 45, pitch: -90, roll: 0, age_ms: 0 }, gimbal_mode: 'follow', stream: null, encoding: null, thermal: null, track: null, candidates: [], ai_ack: null, storage: null, clock: null,
}
const live: VideoSourceStatus = { mode: 'auto', source: 'mt11', scanning: false, probe_ok: true, whep_path: 'mt11' }
const presets: RoiTarget[] = emptyTargets().map((x, i) => (i === 0 ? { ...x, name: '送電塔 A', lat: 36.1, lon: 139.1 } : i === 1 ? { ...x, name: '橋', lat: 36.2, lon: 139.2 } : x))
const roiStatus: RoiStatus = {
  active_target: 'roi_1', mode: 'rate', bearing_deg: 123, elevation_deg: -4, distance_m: 412, yaw_cmd_deg: 0, pitch_cmd_deg: 0,
  gimbal_yaw_deg: 0, gimbal_pitch_deg: 0, speed_yaw: 0, speed_pitch: 0, error: null,
}
const setup = (over: { caps?: CameraCaps; state?: CameraState; roi?: RoiStatus } = {}) => {
  const p = {
    vehicle: v, camera: { sysid: 1, caps: over.caps ?? mt11, state: over.state ?? state }, status: live, pending: false, dict: t('ja'), onCommand: vi.fn(), onSettings: vi.fn(), onRestore: vi.fn(), map: <div data-testid="mini-map" />,
    roiTargets: presets, roiStatus: over.roi, onRoiStart: vi.fn(), onRoiStop: vi.fn(),
  }
  const r = render(<Cockpit {...p} />)
  return { ...p, rerender: r.rerender }
}

describe('Cockpit', () => {
  it('shows the vehicle pills, the mini map and a restore button', () => {
    const p = setup()
    expect(screen.getByText('UAV-01')).toBeInTheDocument()
    expect(screen.getByText('AUTO')).toBeInTheDocument()
    expect(screen.getByText('82 m')).toBeInTheDocument()
    expect(screen.getByTestId('mini-map')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '元に戻す' }))
    expect(p.onRestore).toHaveBeenCalledOnce()
  })

  it('sends record, photo, zoom steps, video type, gimbal mode and center from the bar', () => {
    const p = setup()
    for (const name of ['録画', '写真', 'ズームイン', 'ズームアウト', 'IR', 'ロック', 'ジンバルをセンター']) fireEvent.click(screen.getByRole('button', { name }))
    expect(p.onCommand.mock.calls.map(([c]) => c)).toEqual([
      { cmd: 'record_start' },
      { cmd: 'photo' },
      { cmd: 'zoom_step', args: { steps: 1 } },
      { cmd: 'zoom_step', args: { steps: -1 } },
      { cmd: 'video_mode', args: { mode: 'thermal' } },
      { cmd: 'gimbal_mode', args: { mode: 'lock' } },
      { cmd: 'gimbal_center', args: { mode: 'one_key_reset' } },
    ])
    fireEvent.click(screen.getByRole('button', { name: 'カメラ設定' }))
    expect(p.onSettings).toHaveBeenCalledOnce()
  })

  it('the log zoom slider sends one absolute zoom when released, not one per pixel', () => {
    const p = setup()
    const slider = screen.getByRole('slider', { name: 'ズーム' })
    fireEvent.change(slider, { target: { value: '700' } })
    fireEvent.change(slider, { target: { value: '1000' } })
    expect(p.onCommand).not.toHaveBeenCalled()
    // the value follows the thumb while dragging; after release it waits for camera_state
    expect(screen.getByText('165.0×')).toBeInTheDocument()
    fireEvent.pointerUp(slider)
    expect(p.onCommand.mock.calls).toEqual([[{ cmd: 'zoom_absolute', args: { zoom: 165 } }]])
  })

  it('a MAVLink camera: percent zoom, a linear slider, and only the gimbal and video card rows', () => {
    const mav: CameraCaps = {
      ...mt11, kind: 'mavlink', video_modes: ['rgb'], roi: 'native', focus: false,
      gimbal: { rate: true, angle: true, center: false, modes: [], attitude: true, pitch_range: [-90, 25] },
      zoom: { max: 100, absolute: true, step: true, continuous: true, unit: 'percent' },
    }
    const p = setup({ caps: mav, state: { ...state, zoom: 40, zoom_max: 100, gimbal_mode: null, gimbal: { yaw: 0, pitch: -20, roll: 0, age_ms: 0 } } })
    expect(screen.getByText('40%')).toBeInTheDocument()
    const rows = [...document.querySelectorAll('.cam-card .kv > span')]
    expect(rows.filter((_, i) => i % 2 === 0).map((s) => s.textContent)).toEqual(['ジンバル', '映像'])
    expect(rows[1]?.textContent).toBe('0.0° / −20.0°')
    for (const label of ['サーマル', 'SDカード', 'カメラ時刻']) expect(screen.queryByText(label)).toBeNull()
    const slider = screen.getByRole('slider', { name: 'ズーム' })
    expect(slider).toHaveValue(String(ZOOM_SLIDER_MAX * 0.4))
    fireEvent.change(slider, { target: { value: String(ZOOM_SLIDER_MAX / 2) } })
    expect(screen.getByText('50%')).toBeInTheDocument()
    fireEvent.pointerUp(slider)
    expect(p.onCommand.mock.calls).toEqual([[{ cmd: 'zoom_absolute', args: { zoom: 50 } }]])
  })

  it('stops recording when recording, and hides what a camera cannot do', () => {
    const p = setup({ state: { ...state, recording: 'recording' }, caps: { ...mt11, gimbal: null, video_modes: [], zoom: null, photo: false } })
    fireEvent.click(screen.getByRole('button', { name: '録画' }))
    expect(p.onCommand).toHaveBeenCalledWith({ cmd: 'record_stop' })
    for (const name of ['写真', 'IR', 'ロック', 'ジンバルをセンター', 'ズームイン']) expect(screen.queryByRole('button', { name })).toBeNull()
    expect(screen.queryByRole('slider')).toBeNull()
    expect(screen.queryByText('ジンバル')).toBeNull()
  })

  it('the status card puts the gimbal on the dial and shows source and measured delay', () => {
    setup()
    expect(screen.getByText(/^Follow\s+45\.0° \/ −90\.0°$/)).toBeInTheDocument()
    const pt = document.querySelector('.cam-dial .pt') as HTMLElement
    expect(pt.style.transform).toBe('translate(18px, 36px)')
    act(() => stats[stats.length - 1]!({ jitter: 80, rtt: 40 }))
    expect(screen.getAllByText(/100 ms/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/MT11/).length).toBeGreaterThan(0)
  })

  it('a vehicle without a camera shows only the video and the map', () => {
    setup({ caps: { ...mt11, kind: 'none' } })
    expect(screen.queryByRole('button', { name: '録画' })).toBeNull()
    expect(document.querySelector('.cam-card')).toBeNull()
    expect(screen.getByTestId('mini-map')).toBeInTheDocument()
  })

  it('shows the ROI chips for an ROI camera with set presets and starts / stops from them', () => {
    const p = setup()
    expect(document.querySelector('.cam-bar .chips')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '橋' }))
    expect(p.onRoiStart).toHaveBeenCalledWith('roi_2')
    fireEvent.click(screen.getByRole('button', { name: '停止' }))
    expect(p.onRoiStop).toHaveBeenCalledOnce()
  })

  it('has no ROI chips when the camera cannot do ROI', () => {
    setup({ caps: { ...mt11, roi: 'none', thermal: null, ai_tracking: null, encoding_presets: [], storage_info: false, clock_sync: false } })
    expect(document.querySelector('.chips')).toBeNull()
  })

  it('the status card has an ROI row while ROI is active', () => {
    setup({ roi: roiStatus })
    expect(screen.getByRole('button', { name: '送電塔 A' })).toHaveClass('on')
    const label = [...document.querySelectorAll('.cam-card .kv > span')].find((s) => s.textContent === 'ROI')
    expect(label?.nextElementSibling?.textContent).toBe('送電塔 A  方位 123°  412 m')
  })

  it('the status card shows thermal, SD, clock and the encoding in prototype order', () => {
    const caps: CameraCaps = {
      ...mt11,
      thermal: { gains: ['low', 'high'], palettes: [0, 2, 3], point_temp: true, frame_temp: true },
      encoding_presets: [{ id: 'h265_1080p', label: 'H.265 1920×1080', codec: 'h265', width: 1920, height: 1080 }], storage_info: true, clock_sync: true,
    }
    const st: CameraState = {
      ...state,
      thermal: { gain: 'high', range_c: [-20, 150], frame: { max_c: 41.2, min_c: 9.8, max_xy: [1, 1], min_xy: [2, 2] }, point: null },
      storage: { status: 'ok', fs: 'exFAT', total_gb: 128, free_gb: 11, free_pct: 9 },
      clock: { camera_unix_us: 1, reading_age_ms: 0, offset_ms: 300, rtt_ms: 10, synced_at_unix_ms: 1, error: null },
      encoding: { codec: 'h265', width: 1920, height: 1080, bitrate_kbps: 4000, fps: 30 },
    }
    setup({ caps, state: st })
    const rows = [...document.querySelectorAll('.cam-card .kv > span')]
    const value = (label: string) => rows.find((s) => s.textContent === label)?.nextElementSibling as HTMLElement | undefined
    expect(rows.filter((_, i) => i % 2 === 0).map((s) => s.textContent)).toEqual(['ジンバル', 'サーマル', 'SDカード', 'カメラ時刻', '映像'])
    expect(value('サーマル')?.textContent).toBe('High  41.2 / 9.8℃')
    expect(value('SDカード')?.textContent).toBe('11.0 / 128 GB  9%')
    expect(value('SDカード')?.style.color).toBe('var(--danger)')
    expect(value('カメラ時刻')?.textContent).toBe('GPS 同期 +0.3 s')
    expect(value('カメラ時刻')?.style.color).toBe('')
    expect(value('映像')?.textContent).toMatch(/^H\.265 1080p {2}MT11/)
  })

  it('the status card has no thermal row without the thermal cap', () => {
    const st: CameraState = { ...state, thermal: { gain: 'high', range_c: null, frame: null, point: null } }
    setup({ state: st })
    expect(screen.queryByText('サーマル')).toBeNull()
    expect(screen.queryByText('SDカード')).toBeNull()
  })

  describe('overlay clicks and AI追跡', () => {
    const ai: CameraCaps = {
      ...mt11,
      thermal: { gains: ['low', 'high'], palettes: [0, 2], point_temp: true, frame_temp: true },
      ai_tracking: { box_select: true, point_select: true, candidates: true },
    }
    const known: CameraState = { ...state, stream: [1280, 720] }
    const profile: CameraProfile = {
      sysid: 1, kind: 'siyi_mt11', host: '192.168.144.25', port: 37260, rtsp_url: '', comp_id: 154, video_source_mode: 'auto', android_url: '',
      encoding_preset: 'h264_1080p', thermal_palette: 0, thermal_overlay: true, ai_box_px: 100, clock_sync: true, auto_record: false,
    }
    const size = (w: number, h: number) => {
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => w })
      Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => h })
    }
    beforeEach(() => {
      cameraProfileStore.set(1, profile)
      size(1280, 720)
    })
    afterEach(() => {
      size(0, 0)
      vi.restoreAllMocks()
    })
    const overlay = () => document.querySelector('.cockpit-overlay') as HTMLElement

    it('a click at the centre selects a box of the profile size', () => {
      const p = setup({ caps: ai, state: known })
      fireEvent.click(overlay(), { clientX: 640, clientY: 360 })
      expect(p.onCommand).toHaveBeenCalledWith({ cmd: 'ai_select_box', args: { x: 0.5, y: 0.5, box_px: 100 } })
      expect(document.querySelector('.cockpit-overlay .trk')).not.toBeNull()
    })

    it('Alt+click in IR measures the point', () => {
      const p = setup({ caps: ai, state: { ...known, video_mode: 'thermal' } })
      fireEvent.click(overlay(), { clientX: 320, clientY: 180, altKey: true })
      expect(p.onCommand).toHaveBeenCalledWith({ cmd: 'measure_point', args: { x: 0.25, y: 0.25 } })
    })

    it('a refused click goes to the log, not to the camera', () => {
      const push = vi.spyOn(vehicleStore, 'pushLocalResult')
      const p = setup({ caps: ai, state: { ...known, video_mode: 'thermal' } })
      fireEvent.click(overlay(), { clientX: 640, clientY: 360 })
      expect(p.onCommand).not.toHaveBeenCalled()
      expect(push).toHaveBeenCalledWith(expect.objectContaining({ sysid: 1, cmd: 'ai_track', ok: false, reason: 'AI 追跡は RGB 表示でのみ使えます' }))
    })

    it('a failed AI ACK is logged once per seq', () => {
      const push = vi.spyOn(vehicleStore, 'pushLocalResult')
      const p = setup({ caps: ai, state: known })
      const rerender = (st: CameraState) => p.rerender(<Cockpit {...p} camera={{ sysid: 1, caps: ai, state: st }} />)
      rerender({ ...known, ai_ack: { code: 'low_texture', seq: 3 } })
      rerender({ ...known, ai_ack: { code: 'low_texture', seq: 3 } })
      rerender({ ...known, ai_ack: { code: 'ok', seq: 4 } })
      expect(push).toHaveBeenCalledTimes(1)
      expect(push).toHaveBeenCalledWith(expect.objectContaining({ cmd: 'ai_track', reason: '目標の特徴が少なすぎます' }))
    })

    it('the AI追跡 button needs MT11 AI caps, starts at the centre and cancels while tracking', () => {
      const p = setup({ caps: ai, state: known })
      fireEvent.click(screen.getByRole('button', { name: 'AI追跡' }))
      expect(p.onCommand).toHaveBeenCalledWith({ cmd: 'ai_select_box', args: { x: 0.5, y: 0.5, box_px: 200 } })
      cleanup()
      const tracking = { ...known, track: { status: 'tracking' as const, rect: { x: 0.4, y: 0.4, w: 0.2, h: 0.2 }, target: '', age_ms: 0 } }
      const q = setup({ caps: ai, state: tracking })
      const btn = screen.getByRole('button', { name: 'AI追跡' })
      expect(btn).toHaveClass('btn', 'btn-sm', 'on')
      fireEvent.click(btn)
      expect(q.onCommand).toHaveBeenCalledWith({ cmd: 'ai_cancel' })
      cleanup()
      setup({ caps: { ...mt11, kind: 'mavlink' }, state: known })
      expect(screen.queryByRole('button', { name: 'AI追跡' })).toBeNull()
    })

    it('the AI追跡 button is disabled outside RGB', () => {
      setup({ caps: ai, state: { ...known, video_mode: 'thermal' } })
      const btn = screen.getByRole('button', { name: 'AI追跡' })
      expect(btn).toBeDisabled()
      expect(btn).toHaveAttribute('title', 'AI 追跡は RGB 表示でのみ使えます')
    })

    it('macOS Ctrl+click (a context menu event, no click) selects a point', () => {
      const p = setup({ caps: ai, state: known })
      fireEvent.contextMenu(overlay(), { clientX: 640, clientY: 360, ctrlKey: true })
      expect(p.onCommand).toHaveBeenCalledWith({ cmd: 'ai_select_point', args: { x: 0.5, y: 0.5 } })
      fireEvent.contextMenu(overlay(), { clientX: 640, clientY: 360 })
      expect(p.onCommand).toHaveBeenCalledOnce()
    })

    it('the context menu is suppressed on the video', () => {
      setup({ caps: ai, state: known })
      const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
      overlay().dispatchEvent(ev)
      expect(ev.defaultPrevented).toBe(true)
    })
  })
})
