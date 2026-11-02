import { describe, expect, it } from 'vitest'
import { ApiError } from '../../shared/api/client'
import type { CameraClock, EncodingInfo, StorageInfo, ThermalState, TrackState } from '../../shared/api/types'
import { t } from '../../shared/i18n'
import { cameraErrorText, clockDanger, clockText, encodingLabel, sdDanger, sdText, thermalText, trackLabel } from './mediaFormat'

const ja = t('ja')
const frame = { max_c: 68.4, min_c: 11.2, max_xy: [10, 20] as [number, number], min_xy: [30, 40] as [number, number] }
const thermal: ThermalState = { gain: 'high', range_c: [-20, 150], frame, point: null }
const sd: StorageInfo = { status: 'ok', fs: 'exFAT', total_gb: 128, free_gb: 56.3, free_pct: 44 }
const clock = (over: Partial<CameraClock>): CameraClock => ({ camera_unix_us: 1, reading_age_ms: 0, offset_ms: 300, rtt_ms: 20, synced_at_unix_ms: 1, error: null, ...over })
const enc = (codec: EncodingInfo['codec'], width: number, height: number): EncodingInfo => ({ codec, width, height, bitrate_kbps: 4000, fps: 30 })
const track = (status: TrackState['status']): TrackState => ({ status, rect: { x: 0.4, y: 0.4, w: 0.2, h: 0.2 }, target: 'person', age_ms: 0 })

describe('thermalText', () => {
  it('shows gain and frame extremes', () => {
    expect(thermalText(thermal)).toBe('High  68.4 / 11.2℃')
    expect(thermalText({ ...thermal, gain: 'low', frame: { ...frame, max_c: 41.2, min_c: 9.8 } })).toBe('Low  41.2 / 9.8℃')
  })
  it('shows only the gain without a frame, and null without either', () => {
    expect(thermalText({ ...thermal, frame: null })).toBe('High')
    expect(thermalText({ ...thermal, gain: null, frame: null })).toBeNull()
    expect(thermalText(null)).toBeNull()
  })
})

describe('sdText / sdDanger', () => {
  it('formats free / total and percent', () => {
    expect(sdText(sd)).toBe('56.3 / 128 GB  44%')
    expect(sdText({ ...sd, free_gb: 11, free_pct: 9 })).toBe('11.0 / 128 GB  9%')
  })
  it('a problem status is translated', () => {
    expect(sdText({ ...sd, status: 'not_inserted' }, ja)).toBe(ja.sdStatus_not_inserted)
    expect(sdText(null)).toBeNull()
  })
  it('is dangerous under 10 % free or when not ok', () => {
    expect(sdDanger({ ...sd, free_pct: 9 })).toBe(true)
    expect(sdDanger({ ...sd, status: 'not_inserted' })).toBe(true)
    expect(sdDanger(sd)).toBe(false)
    expect(sdDanger(null)).toBe(false)
  })
})

describe('clockText / clockDanger', () => {
  it('shows the signed offset in seconds', () => {
    expect(clockText(clock({}), ja)).toBe('GPS 同期 +0.3 s')
    expect(clockText(clock({ offset_ms: -1200 }), ja)).toBe('GPS 同期 −1.2 s')
    // a sub-50 ms offset rounds to zero and shows no minus sign
    expect(clockText(clock({ offset_ms: -0.1 }), ja)).toBe('GPS 同期 +0.0 s')
    expect(clockDanger(clock({ offset_ms: -1200 }))).toBe(true)
    expect(clockDanger(clock({}))).toBe(false)
  })
  it('an error is translated and dangerous; nothing is a dash', () => {
    expect(clockText(clock({ error: 'no_gps_time' }), ja)).toBe(ja.clockErr_no_gps_time)
    expect(clockDanger(clock({ error: 'no_gps_time' }))).toBe(true)
    expect(clockText(null, ja)).toBe('—')
    expect(clockText(clock({ offset_ms: null }), ja)).toBe('—')
    expect(clockDanger(null)).toBe(false)
  })
  it('a rejected time is a translated failure in both languages', () => {
    expect(clockText(clock({ error: 'rejected', offset_ms: null }), ja)).toBe('カメラが時刻を拒否しました')
    expect(clockText(clock({ error: 'rejected', offset_ms: null }), t('en'))).toBe('The camera rejected the time')
    expect(clockDanger(clock({ error: 'rejected', offset_ms: null }))).toBe(true)
  })
})

describe('encodingLabel', () => {
  it('names codec and resolution', () => {
    expect(encodingLabel(enc('h265', 1920, 1080))).toBe('H.265 1080p')
    expect(encodingLabel(enc('h264', 3840, 2160))).toBe('H.264 4K')
    expect(encodingLabel(enc('h264', 1280, 720))).toBe('H.264 720p')
    expect(encodingLabel(null)).toBeNull()
  })
})

describe('trackLabel', () => {
  it('maps the track status', () => {
    expect(trackLabel(track('tracking'), ja)).toBe('追跡中')
    expect(trackLabel(track('searching'), ja)).toBe('再捕捉中')
    expect(trackLabel(track('lost'), ja)).toBe('見失い')
    expect(trackLabel(null, ja)).toBeNull()
  })
})

describe('cameraErrorText', () => {
  it('translates a refusal code and keeps other errors as their message', () => {
    expect(cameraErrorText(new ApiError(409, 'clock_sync_off', 'x'), ja)).toBe(ja.camErr_clock_sync_off)
    expect(cameraErrorText(new ApiError(500, 'internal', 'boom'), ja)).toBe('boom')
    expect(cameraErrorText('plain', ja)).toBe('plain')
  })
})
