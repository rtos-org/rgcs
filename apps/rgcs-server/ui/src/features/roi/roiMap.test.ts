import type { LineString } from 'geojson'
import { describe, expect, it } from 'vitest'
import type { CameraCaps, CameraSnapshot, CameraState, RoiTarget, VehicleState } from '../../shared/api/types'
import { haversineM } from '../mission/geo'
import { bearingOf } from '../map/gimbal'
import { destination, roiMarkerEl, sightGeoJson } from './roiMap'

const v: VehicleState = {
  sysid: 1, name: 'UAV-01', kind: 'copter', mode: 'AUTO', armed: true, lat: 36.25, lon: 137.63, alt_rel: 50, alt_msl: 1550, hdg: 30,
  ground_speed: 0, climb: 0, battery: { pct: 80, volt: 22, current: null }, link: 'ok', last_rx_ms: 0, gps: { fix: 3, sats: 12, hdop: 1 }, warn: false, unread: 0,
}
const caps: CameraCaps = {
  kind: 'siyi_mt11',
  gimbal: { rate: true, angle: true, center: true, modes: ['lock', 'follow', 'fpv'], attitude: true, pitch_range: [-90, 30] },
  zoom: null, focus: false, photo: true, record: true, video_modes: [], hfov_deg: 62, roi: 'computed', thermal: null, ai_tracking: null, encoding_presets: [], storage_info: false, clock_sync: false,
}
const state: CameraState = {
  connected: true, last_error: null, firmware: null, recording: 'idle', zoom: 1, zoom_max: 1, video_mode: 'rgb',
  gimbal: { yaw: -20, pitch: -10, roll: 0, age_ms: 0 }, gimbal_mode: 'follow', stream: null, encoding: null, thermal: null, track: null, candidates: [], ai_ack: null, storage: null, clock: null,
}
const cam: CameraSnapshot = { sysid: 1, caps, state }
const target: RoiTarget = { id: 'roi_2', name: '送電塔 A', lat: 36.26, lon: 137.63, alt_msl: 1500 }

const line = (fc: ReturnType<typeof sightGeoJson>) => (fc.features[0]!.geometry as LineString).coordinates

describe('roiMarkerEl', () => {
  it('is an .rg-roi with the name label and the preset id', () => {
    const el = roiMarkerEl(target, false)
    expect(el.classList.contains('rg-roi')).toBe(true)
    expect(el.classList.contains('on')).toBe(false)
    expect(el.dataset.id).toBe('roi_2')
    expect(el.querySelector('.sq')).not.toBeNull()
    expect(el.querySelector('.lbl')?.textContent).toBe('送電塔 A')
    expect(roiMarkerEl(target, true).classList.contains('on')).toBe(true)
  })

  it('does not interpret the name as markup', () => {
    const el = roiMarkerEl({ ...target, name: '<b>x</b>' }, false)
    expect(el.querySelector('b')).toBeNull()
    expect(el.querySelector('.lbl')?.textContent).toBe('<b>x</b>')
  })
})

describe('destination', () => {
  it('goes 1 km east', () => {
    const [lng, lat] = destination(35, 139, 90, 1000)
    expect(lng).toBeCloseTo(139.01098, 4)
    expect(lat).toBeCloseTo(35.0, 4)
  })
})

describe('sightGeoJson', () => {
  it('is empty without heading, gimbal attitude or gimbal rate', () => {
    expect(sightGeoJson({ ...v, hdg: null }, cam, null).features).toEqual([])
    expect(sightGeoJson(v, { ...cam, state: { ...state, gimbal: null } }, null).features).toEqual([])
    expect(sightGeoJson(v, { ...cam, caps: { ...caps, gimbal: { ...caps.gimbal!, rate: false } } }, null).features).toEqual([])
    expect(sightGeoJson(v, undefined, null).features).toEqual([])
    expect(sightGeoJson(undefined, cam, null).features).toEqual([])
    expect(sightGeoJson({ ...v, gps: { ...v.gps, fix: 0 } }, cam, null).features).toEqual([])
  })

  it('without a target ends 450 m away along the camera bearing', () => {
    const c = line(sightGeoJson(v, cam, null))
    expect(c[0]).toEqual([v.lon, v.lat])
    const end = c[1]!
    expect(haversineM(v.lat, v.lon, end[1]!, end[0]!)).toBeCloseTo(450, 3)
    const expected = destination(v.lat, v.lon, bearingOf(30, -20), 450)
    expect(end[0]).toBeCloseTo(expected[0], 9)
    expect(end[1]).toBeCloseTo(expected[1], 9)
  })

  it('with an active target ends on the target when the gimbal points at it', () => {
    const north = { ...cam, state: { ...state, gimbal: { ...state.gimbal!, yaw: 30 } } }
    const end = line(sightGeoJson(v, north, target))[1]!
    expect(Math.abs(end[0]! - target.lon)).toBeLessThan(1e-6)
    expect(Math.abs(end[1]! - target.lat)).toBeLessThan(1e-6)
  })
})
