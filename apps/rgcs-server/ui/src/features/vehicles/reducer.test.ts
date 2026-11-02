import { describe, expect, it } from 'vitest'
import type { VehicleState } from '../../shared/api/types'
import { initialState, reduce, setLink, withVehicleMission } from './reducer'
import { vm } from '../../test/vm'
import { topology } from '../network/fixture'

const uav: VehicleState = {
  sysid: 1,
  name: 'UAV-01',
  kind: 'copter',
  mode: 'AUTO',
  armed: true,
  lat: 35.479883,
  lon: 138.47829,
  alt_rel: 80,
  alt_msl: 412,
  hdg: 15,
  ground_speed: 8.1,
  climb: 0,
  battery: { pct: 62, volt: 22.8, current: 12.5 },
  link: 'ok',
  last_rx_ms: 0,
  gps: { fix: 3, sats: 14, hdop: 1.2 },
  warn: false,
  unread: 0,
}

describe('vehicles reducer', () => {
  it('snapshot replaces the vehicle map', () => {
    const s = reduce(initialState, { t: 'snapshot', vehicles: [uav], cameras: [], video_sources: [] })
    expect(s.vehicles.get(1)?.name).toBe('UAV-01')
    expect(initialState.vehicles.size).toBe(0)
  })

  it('telemetry applies a diff to a known vehicle and creates unknown ones', () => {
    const s0 = reduce(initialState, { t: 'snapshot', vehicles: [uav], cameras: [], video_sources: [] })
    const s1 = reduce(s0, { t: 'telemetry', sysid: 1, diff: { alt_rel: 90 } })
    expect(s1.vehicles.get(1)?.alt_rel).toBe(90)
    expect(s0.vehicles.get(1)?.alt_rel).toBe(80)
    const s2 = reduce(s1, { t: 'telemetry', sysid: 7, diff: { name: 'UAV-07', mode: 'HOLD' } })
    expect(s2.vehicles.get(7)?.mode).toBe('HOLD')
    expect(s2.vehicles.get(7)?.kind).toBe('other')
  })

  it('discovered / lost add and remove placeholders', () => {
    const s1 = reduce(initialState, { t: 'vehicle_discovered', sysid: 3 })
    expect(s1.vehicles.get(3)?.name).toBe('UAV-03')
    const s2 = reduce(s1, { t: 'vehicle_lost', sysid: 3 })
    expect(s2.vehicles.has(3)).toBe(false)
  })

  it('messages are kept newest first', () => {
    const m = vm({ sysid: 1, id: 1, severity: 4, text: 'PreArm', ts: 1 })
    const s1 = reduce(initialState, { t: 'vehicle_message', ...m })
    const s2 = reduce(s1, { t: 'vehicle_message', ...m, id: 2, text: 'Armed' })
    expect(s2.messages.map((x) => x.id)).toEqual([2, 1])
  })

  it('link state changes produce a new object only when different', () => {
    const s1 = setLink(initialState, 'open')
    expect(s1.link).toBe('open')
    expect(setLink(s1, 'open')).toBe(s1)
  })
})

describe('command results', () => {
  const result = (id: number, ok = true) => ({ t: 'command_result' as const, id, sysid: 1, cmd: 'arm', ok, reason: null, ts: 1000 + id })

  it('keeps results newest first and dedupes by id', () => {
    const s1 = reduce(initialState, result(1))
    const s2 = reduce(s1, result(2))
    const s3 = reduce(s2, result(2, false))
    expect(s3.results.map((r) => r.id)).toEqual([2, 1])
    expect(s3.results[0]?.ok).toBe(true)
    expect(s1.results.map((r) => r.id)).toEqual([1])
  })

  it('caps results at 50 and leaves state untouched on unrelated frames', () => {
    const full = Array.from({ length: 51 }, (_, i) => result(i + 1)).reduce(reduce, initialState)
    expect(full.results).toHaveLength(50)
    expect(full.results[0]?.id).toBe(51)
    expect(full.results.at(-1)?.id).toBe(2)
    const same = reduce(full, { t: 'vehicle_discovered', sysid: 9 })
    expect(same.results).toBe(full.results)
  })
})

describe('camera, video source and input frames', () => {
  const caps = { kind: 'siyi_mt11' as const, gimbal: null, zoom: null, focus: false, photo: true, record: true, video_modes: ['rgb' as const], hfov_deg: null, roi: 'computed' as const, thermal: null, ai_tracking: null, encoding_presets: [], storage_info: false, clock_sync: false }
  const state = (zoom: number) => ({
    connected: true, last_error: null, firmware: null, recording: 'idle' as const, zoom, zoom_max: 165, video_mode: 'rgb' as const, gimbal: null, gimbal_mode: null, stream: null, encoding: null, thermal: null, track: null, candidates: [], ai_ack: null, storage: null, clock: null,
  })

  it('snapshot cameras populate the map and camera_state replaces one entry immutably', () => {
    const s1 = reduce(initialState, { t: 'snapshot', vehicles: [], cameras: [{ sysid: 1, caps, state: state(1) }], video_sources: [] })
    expect(s1.cameras.get(1)?.state.zoom).toBe(1)
    const s2 = reduce(s1, { t: 'camera_state', sysid: 1, caps, state: state(3) })
    expect(s2.cameras.get(1)?.state.zoom).toBe(3)
    expect(s1.cameras.get(1)?.state.zoom).toBe(1)
    // A camera configured after the snapshot (or after a server restart) is learnt from its frames.
    const s3 = reduce(s2, { t: 'camera_state', sysid: 9, caps, state: state(2) })
    expect(s3.cameras.get(9)?.caps.kind).toBe('siyi_mt11')
    const none = { ...caps, kind: 'none' as const }
    expect(reduce(s3, { t: 'camera_state', sysid: 1, caps: none, state: state(1) }).cameras.get(1)?.caps.kind).toBe('none')
  })

  it('mission_transfer_keeps_the_latest_write_progress_per_vehicle', () => {
    const s1 = reduce(initialState, { t: 'mission_transfer', sysid: 1, transfer: { phase: 'write', done: 4, total: 21 } })
    expect(s1.missionTransfers.get(1)).toEqual({ phase: 'write', done: 4, total: 21 })
    expect(reduce(s1, { t: 'mission_transfer', sysid: 1, transfer: { phase: 'write', done: 4, total: 21 } })).toBe(s1)
    const s2 = reduce(s1, { t: 'mission_transfer', sysid: 1, transfer: { phase: 'verify', done: 0, total: 21 } })
    expect(s2.missionTransfers.get(1)?.phase).toBe('verify')
  })

  it('mission_progress_is_stored_per_vehicle', () => {
    const s1 = reduce(initialState, { t: 'mission_progress', sysid: 1, progress: { seq: 3, total: 21 } })
    expect(s1.missionProgress.get(1)).toEqual({ seq: 3, total: 21 })
    expect(reduce(s1, { t: 'mission_progress', sysid: 1, progress: { seq: 3, total: 21 } })).toBe(s1)
    const s2 = reduce(s1, { t: 'mission_progress', sysid: 2, progress: { seq: 1, total: null } })
    expect(s2.missionProgress.size).toBe(2)
    expect(s1.missionProgress.size).toBe(1)
  })

  it('param_progress_is_stored', () => {
    const p = { received: 25, total: 1200, complete: false, downloading: true }
    const s1 = reduce(initialState, { t: 'param_progress', sysid: 1, progress: p })
    expect(s1.paramProgress.get(1)).toEqual(p)
    expect(reduce(s1, { t: 'param_progress', sysid: 1, progress: { ...p } })).toBe(s1)
    expect(initialState.paramProgress.size).toBe(0)
  })

  it('flight_draft_created_is_stored', () => {
    const flight = { id: 3, sysid: 1, status: 'draft' as const, pilot: 'admin', pilot_license: '', takeoff_at: 1, landed_at: 2, takeoff_lat: null, takeoff_lon: null, landing_lat: null, landing_lon: null, takeoff_place: '', landing_place: '', purposes: [], specific_flight: [], summary: '', safety_notes: '', flight_minutes: 1, total_minutes: 1, squawks: [], supersedes: null, created_by: 'system', created_at: 0, updated_at: 0 }
    const s1 = reduce(initialState, { t: 'flight_draft_created', sysid: 1, flight })
    expect(s1.flightDrafts.get(1)).toBe(flight)
    expect(initialState.flightDrafts.size).toBe(0)
  })

  it('log_fetch_progress_is_stored', () => {
    const p = { fc_log_id: 7, received: 65536, total: 1_000_000, done: false, error: null }
    const s1 = reduce(initialState, { t: 'log_fetch_progress', sysid: 1, progress: p })
    expect(s1.logFetch.get(1)).toEqual(p)
    expect(reduce(s1, { t: 'log_fetch_progress', sysid: 1, progress: { ...p } })).toBe(s1)
  })

  it('roi_status is stored per vehicle and vehicle_lost drops it', () => {
    const status = { active_target: 'roi_2', mode: 'rate' as const, bearing_deg: 12, elevation_deg: -20, distance_m: 300, yaw_cmd_deg: null, pitch_cmd_deg: null, gimbal_yaw_deg: null, gimbal_pitch_deg: null, speed_yaw: null, speed_pitch: null, error: null }
    const s1 = reduce(reduce(initialState, { t: 'vehicle_discovered', sysid: 3 }), { t: 'roi_status', sysid: 3, status })
    expect(s1.roi.get(3)).toEqual(status)
    expect(initialState.roi.size).toBe(0)
    const s2 = reduce(s1, { t: 'vehicle_lost', sysid: 3 })
    expect(s2.roi.has(3)).toBe(false)
    expect(s1.roi.has(3)).toBe(true)
  })

  it('snapshot clears ROI status: a reconnect or server restart must not keep a stale active ROI', () => {
    const status = { active_target: 'roi_1', mode: 'rate' as const, bearing_deg: 12, elevation_deg: -20, distance_m: 300, yaw_cmd_deg: null, pitch_cmd_deg: null, gimbal_yaw_deg: null, gimbal_pitch_deg: null, speed_yaw: null, speed_pitch: null, error: null }
    const s1 = reduce(initialState, { t: 'roi_status', sysid: 3, status })
    const s2 = reduce(s1, { t: 'snapshot', vehicles: [uav], cameras: [], video_sources: [] })
    expect(s2.roi.size).toBe(0)
    expect(s1.roi.get(3)).toEqual(status)
  })

  it('calibration_status_is_stored_per_vehicle', () => {
    const status = { kind: 'accel' as const, phase: 'waiting' as const, position: 2, compass: [], rc: [], reboot: false, reason: null }
    const s1 = reduce(initialState, { t: 'calibration', sysid: 3, status })
    expect(s1.calibration.get(3)).toEqual(status)
    expect(initialState.calibration.size).toBe(0)
  })

  it('vehicle_mission_is_stored_locally', () => {
    const m = { id: 1, name: 'm', sysid: 1, default_alt: 50, default_frame: 'rel' as const, speed: 8, home: null, fence: [], rally: [], surveys: [], items: [] }
    const s1 = withVehicleMission(initialState, 1, m)
    expect(s1.vehicleMissions.get(1)).toBe(m)
    expect(initialState.vehicleMissions.size).toBe(0)
  })

  it('snapshot video_sources populate the map', () => {
    const status = { mode: 'auto' as const, source: 'mt11' as const, scanning: false, probe_ok: true, whep_path: 'mt11' }
    const s1 = reduce(initialState, { t: 'snapshot', vehicles: [], cameras: [], video_sources: [{ sysid: 1, status }] })
    expect(s1.videoSources.get(1)).toEqual(status)
  })

  it('video_source and input_state are stored', () => {
    const status = { mode: 'auto' as const, source: 'mt11' as const, scanning: false, probe_ok: true, whep_path: 'mt11' }
    const s1 = reduce(initialState, { t: 'video_source', sysid: 1, status })
    expect(s1.videoSources.get(1)).toEqual(status)
    expect(initialState.deadman).toBe('ok')
    const s2 = reduce(s1, { t: 'input_state', deadman: 'lost' })
    expect(s2.deadman).toBe('lost')
    expect(reduce(s2, { t: 'input_state', deadman: 'lost' })).toBe(s2)
  })
  it('routes vehicle messages, log entries and acknowledgements into the log', () => {
    const m = vm({ sysid: 1, id: 10, severity: 4, text: 'PreArm', ts: 1 })
    let s = reduce(initialState, { t: 'vehicle_message', ...m })
    s = reduce(s, { t: 'log_entry', id: 11, ts: 2, sysid: 1, source: 'command', severity: 'ok', text: 'arm', ackable: false, acked_by: null, acked_at: null })
    expect(s.log.entries.map((x) => x.id)).toEqual([11, 10])
    expect(s.log.unreadAlerts).toBe(1)
    s = reduce(s, { t: 'message_ack', sysid: 1, id: 10, by: 'admin', ts: 5 })
    expect(s.log.entries[1].acked_by).toBe('admin')
    expect(s.messages[0].acked_by).toBe('admin')
  })

  it('network_status_replaces_topology', () => {
    expect(initialState.network).toBeNull()
    const t1 = topology(1000)
    const t2 = topology(2000)
    const s1 = reduce(initialState, { t: 'network_status', topology: t1 })
    expect(s1.network).toBe(t1)
    const s2 = reduce(s1, { t: 'network_status', topology: t2 })
    expect(s2.network).toBe(t2)
    expect(s2.vehicles).toBe(initialState.vehicles)
    expect(s2.cameras).toBe(initialState.cameras)
    expect(s2.log).toBe(initialState.log)
    expect(s2.results).toBe(initialState.results)
  })
})
