import { describe, expect, it } from 'vitest'
import type { CameraSnapshot, VehicleState } from '../../shared/api/types'
import { footprintsGeoJson } from './footprints'

const v = (sysid: number, alt_rel = 100): VehicleState => ({
  sysid, name: `UAV-0${sysid}`, kind: 'copter', mode: 'AUTO', armed: true, lat: 35.479883, lon: 138.47829, alt_rel, alt_msl: 0, hdg: 0,
  ground_speed: 0, climb: 0, battery: { pct: 50, volt: 22, current: null }, link: 'ok', last_rx_ms: 0,
  gps: { fix: 3, sats: 10, hdop: 1 }, warn: false, unread: 0,
})
const cam = (sysid: number, pitch: number): CameraSnapshot =>
  ({
    sysid,
    caps: { kind: 'siyi_mt11', gimbal: { rate: true, angle: true, center: true, modes: [], attitude: true, pitch_range: [-90, 30] }, zoom: null, focus: false, photo: false, record: false, video_modes: [], hfov_deg: 62, roi: 'computed', thermal: null, ai_tracking: null, encoding_presets: [], storage_info: false, clock_sync: false },
    state: { connected: true, last_error: null, firmware: null, recording: 'idle', zoom: 1, zoom_max: 1, video_mode: null, gimbal: { yaw: 0, pitch, roll: 0, age_ms: 0 }, gimbal_mode: null, stream: null, encoding: null, thermal: null, track: null, candidates: [], ai_ack: null, storage: null, clock: null },
  }) as CameraSnapshot

describe('footprintsGeoJson', () => {
  it('one closed polygon per vehicle whose footprint hits the ground, flagged when selected', () => {
    const vehicles = new Map([
      [1, v(1)],
      [2, v(2)],
      [3, v(3)],
    ])
    const cameras = new Map([
      [1, cam(1, -45)],
      [2, cam(2, 10)],
    ])
    const fc = footprintsGeoJson(vehicles, cameras, 1)
    expect(fc.features).toHaveLength(1)
    const f = fc.features[0]!
    expect(f.properties).toEqual({ sysid: 1, sel: 1 })
    const ring = (f.geometry as { coordinates: number[][][] }).coordinates[0]!
    expect(ring).toHaveLength(5)
    expect(ring[0]).toEqual(ring[4])
  })

  it('needs the vehicle above the ground', () => {
    expect(footprintsGeoJson(new Map([[1, v(1, 0.5)]]), new Map([[1, cam(1, -45)]]), null).features).toHaveLength(0)
  })
})
