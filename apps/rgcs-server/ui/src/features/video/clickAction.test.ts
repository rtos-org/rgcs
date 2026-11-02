import { describe, expect, it } from 'vitest'
import type { CameraCaps, CameraState } from '../../shared/api/types'
import { clickAction } from './clickAction'

const caps: CameraCaps = {
  kind: 'siyi_mt11', gimbal: null, zoom: null, focus: true, photo: true, record: true, video_modes: ['rgb', 'thermal', 'side_by_side'], hfov_deg: 62, roi: 'computed',
  thermal: { gains: ['low', 'high'], palettes: [0, 2], point_temp: true, frame_temp: true },
  ai_tracking: { box_select: true, point_select: true, candidates: true },
  encoding_presets: [], storage_info: true, clock_sync: true,
}
const rgb: CameraState = {
  connected: true, last_error: null, firmware: null, recording: 'idle', zoom: 1, zoom_max: 30, video_mode: 'rgb', gimbal: null, gimbal_mode: null,
  stream: [1920, 1080], encoding: null, thermal: null, track: null, candidates: [], ai_ack: null, storage: null, clock: null,
}
const ir: CameraState = { ...rgb, video_mode: 'thermal' }
const none = { ctrl: false, meta: false, alt: false }

describe('clickAction', () => {
  it('plain click in RGB selects a box of the profile size', () => {
    expect(clickAction(none, 0.5, 0.25, rgb, caps, 150)).toEqual({ kind: 'command', cmd: { cmd: 'ai_select_box', args: { x: 0.5, y: 0.25, box_px: 150 } } })
  })

  it('Ctrl+click and ⌘+click in RGB select a detection point', () => {
    const point = { kind: 'command', cmd: { cmd: 'ai_select_point', args: { x: 0.1, y: 0.2 } } }
    expect(clickAction({ ...none, ctrl: true }, 0.1, 0.2, rgb, caps, 100)).toEqual(point)
    expect(clickAction({ ...none, meta: true }, 0.1, 0.2, rgb, caps, 100)).toEqual(point)
  })

  it('Alt+click in IR measures the point; Alt elsewhere is refused', () => {
    expect(clickAction({ ...none, alt: true }, 0.5, 0.5, ir, caps, 100)).toEqual({ kind: 'command', cmd: { cmd: 'measure_point', args: { x: 0.5, y: 0.5 } } })
    expect(clickAction({ ...none, alt: true }, 0.5, 0.5, rgb, caps, 100)).toEqual({ kind: 'refuse', code: 'thermal_only' })
  })

  it('a plain click in IR is refused (tracking is RGB only)', () => {
    expect(clickAction(none, 0.5, 0.5, ir, caps, 100)).toEqual({ kind: 'refuse', code: 'rgb_only' })
  })

  it('2画面 does nothing', () => {
    const sbs = { ...rgb, video_mode: 'side_by_side' as const }
    expect(clickAction(none, 0.5, 0.5, sbs, caps, 100)).toBeNull()
    expect(clickAction({ ...none, alt: true }, 0.5, 0.5, sbs, caps, 100)).toBeNull()
  })

  it('an unknown stream resolution is refused', () => {
    expect(clickAction(none, 0.5, 0.5, { ...rgb, stream: null }, caps, 100)).toEqual({ kind: 'refuse', code: 'stream_unknown' })
    expect(clickAction({ ...none, alt: true }, 0.5, 0.5, { ...ir, stream: null }, caps, 100)).toEqual({ kind: 'refuse', code: 'stream_unknown' })
  })

  it('a degenerate stream size (0x20 with 0 width / height) is unknown', () => {
    for (const stream of [[0, 1080], [1920, 0], [0, 0]] as [number, number][]) {
      expect(clickAction(none, 0.5, 0.5, { ...rgb, stream }, caps, 100)).toEqual({ kind: 'refuse', code: 'stream_unknown' })
      expect(clickAction({ ...none, alt: true }, 0.5, 0.5, { ...ir, stream }, caps, 100)).toEqual({ kind: 'refuse', code: 'stream_unknown' })
    }
  })

  it('a camera without AI tracking ignores tracking clicks', () => {
    expect(clickAction(none, 0.5, 0.5, rgb, { ...caps, ai_tracking: null }, 100)).toBeNull()
    expect(clickAction({ ...none, alt: true }, 0.5, 0.5, ir, { ...caps, ai_tracking: null, thermal: null }, 100)).toBeNull()
  })
})
