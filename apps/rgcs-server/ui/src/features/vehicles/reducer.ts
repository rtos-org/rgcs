import type { CalibStatus, CameraSnapshot, CommandResult, Deadman, Flight, LogFetchProgress, Mission, MissionProgress, MissionTransfer, NetworkTopology, ParamProgress, RoiStatus, ServerMessage, SysId, VehicleMessage, VehicleState, VideoSourceStatus } from '../../shared/api/types'
import { applyDiff } from '../../shared/ws/apply'
import { EMPTY_LOG, logReduce, toLogEntry, type LogState } from '../log/store'

export type LinkState = 'connecting' | 'open' | 'closed'

export interface VehiclesState {
  readonly vehicles: ReadonlyMap<SysId, VehicleState>
  readonly messages: readonly VehicleMessage[]
  /** `command_result` frames, newest first, unique by id (the footer shows the top two). */
  readonly results: readonly CommandResult[]
  readonly cameras: ReadonlyMap<SysId, CameraSnapshot>
  readonly videoSources: ReadonlyMap<SysId, VideoSourceStatus>
  /** Last `mission_progress` per vehicle. */
  readonly missionProgress: ReadonlyMap<SysId, MissionProgress>
  /** Last `mission_transfer` per vehicle (a mission write in progress, then done / failed). */
  readonly missionTransfers: ReadonlyMap<SysId, MissionTransfer>
  /** The mission each vehicle is known to carry (set after a verified upload or a download). */
  readonly vehicleMissions: ReadonlyMap<SysId, Mission>
  /** Last `param_progress` per vehicle. */
  readonly paramProgress: ReadonlyMap<SysId, ParamProgress>
  /** Last `flight_draft_created` per vehicle (a DISARM closed or moved a draft). */
  readonly flightDrafts: ReadonlyMap<SysId, Flight>
  /** Last `log_fetch_progress` per vehicle. */
  readonly logFetch: ReadonlyMap<SysId, LogFetchProgress>
  /** Last `calibration` session state per vehicle (点検・校正). */
  readonly calibration: ReadonlyMap<SysId, CalibStatus>
  /** Last `roi_status` per vehicle (inactive = no entry or `active_target` null). */
  readonly roi: ReadonlyMap<SysId, RoiStatus>
  /** Last `network_status` topology (1 Hz, full frame); null until the first one. */
  readonly network: NetworkTopology | null
  readonly deadman: Deadman
  readonly link: LinkState
  /** The message log behind the footer pill and the history sheet. */
  readonly log: LogState
}

export const initialState: VehiclesState = {
  vehicles: new Map(),
  messages: [],
  results: [],
  cameras: new Map(),
  videoSources: new Map(),
  missionProgress: new Map(),
  missionTransfers: new Map(),
  vehicleMissions: new Map(),
  paramProgress: new Map(),
  flightDrafts: new Map(),
  logFetch: new Map(),
  calibration: new Map(),
  roi: new Map(),
  network: null,
  deadman: 'ok',
  link: 'connecting',
  log: EMPTY_LOG,
}


const MAX_MESSAGES = 200
const MAX_RESULTS = 50

/** Newest first; a result whose id is already present is ignored (HTTP reply vs WS race). */
export function addResult(results: readonly CommandResult[], r: CommandResult): readonly CommandResult[] {
  if (results.some((x) => x.id === r.id)) return results
  return [r, ...results].slice(0, MAX_RESULTS)
}

function placeholder(sysid: SysId): VehicleState {
  return {
    sysid,
    name: `UAV-${String(sysid).padStart(2, '0')}`,
    kind: 'other',
    mode: '',
    armed: false,
    lat: 0,
    lon: 0,
    alt_rel: 0,
    alt_msl: 0,
    hdg: null,
    ground_speed: 0,
    climb: 0,
    battery: { pct: null, volt: 0, current: null },
    link: 'ok',
    last_rx_ms: 0,
    gps: { fix: 0, sats: 0, hdop: null },
    warn: false,
    unread: 0,
  }
}

function withVehicle(state: VehiclesState, v: VehicleState): VehiclesState {
  const vehicles = new Map(state.vehicles)
  vehicles.set(v.sysid, v)
  return { ...state, vehicles }
}

/** Pure reducer over server frames; the store and the tests share it. */
export function reduce(state: VehiclesState, msg: ServerMessage): VehiclesState {
  switch (msg.t) {
    case 'snapshot':
      return {
        ...state,
        vehicles: new Map(msg.vehicles.map((v) => [v.sysid, v])),
        cameras: new Map(msg.cameras.map((c) => [c.sysid, c])),
        videoSources: new Map(msg.video_sources.map((v) => [v.sysid, v.status])),
        // An active ROI re-announces itself within 0.5 s; anything older may be stale.
        roi: new Map(),
      }
    case 'camera_state': {
      const cameras = new Map(state.cameras)
      cameras.set(msg.sysid, { sysid: msg.sysid, caps: msg.caps, state: msg.state })
      return { ...state, cameras }
    }
    case 'video_source': {
      const videoSources = new Map(state.videoSources)
      videoSources.set(msg.sysid, msg.status)
      return { ...state, videoSources }
    }
    case 'mission_progress': {
      const prev = state.missionProgress.get(msg.sysid)
      if (prev && prev.seq === msg.progress.seq && prev.total === msg.progress.total) return state
      const missionProgress = new Map(state.missionProgress)
      missionProgress.set(msg.sysid, msg.progress)
      return { ...state, missionProgress }
    }
    case 'mission_transfer': {
      const prev = state.missionTransfers.get(msg.sysid)
      const t = msg.transfer
      if (prev && prev.phase === t.phase && prev.done === t.done && prev.total === t.total) return state
      const missionTransfers = new Map(state.missionTransfers)
      missionTransfers.set(msg.sysid, t)
      return { ...state, missionTransfers }
    }
    case 'param_progress': {
      const prev = state.paramProgress.get(msg.sysid)
      const p = msg.progress
      if (prev && prev.received === p.received && prev.total === p.total && prev.complete === p.complete && prev.downloading === p.downloading) return state
      const paramProgress = new Map(state.paramProgress)
      paramProgress.set(msg.sysid, p)
      return { ...state, paramProgress }
    }
    case 'flight_draft_created': {
      const flightDrafts = new Map(state.flightDrafts)
      flightDrafts.set(msg.sysid, msg.flight)
      return { ...state, flightDrafts }
    }
    case 'log_fetch_progress': {
      const prev = state.logFetch.get(msg.sysid)
      const p = msg.progress
      if (prev && prev.fc_log_id === p.fc_log_id && prev.received === p.received && prev.total === p.total && prev.done === p.done && prev.error === p.error) return state
      const logFetch = new Map(state.logFetch)
      logFetch.set(msg.sysid, p)
      return { ...state, logFetch }
    }
    case 'calibration': {
      const calibration = new Map(state.calibration)
      calibration.set(msg.sysid, msg.status)
      return { ...state, calibration }
    }
    case 'roi_status': {
      const roi = new Map(state.roi)
      roi.set(msg.sysid, msg.status)
      return { ...state, roi }
    }
    case 'network_status':
      return { ...state, network: msg.topology }
    case 'input_state':
      return state.deadman === msg.deadman ? state : { ...state, deadman: msg.deadman }
    case 'telemetry': {
      const prev = state.vehicles.get(msg.sysid) ?? placeholder(msg.sysid)
      return withVehicle(state, applyDiff(prev, msg.diff))
    }
    case 'vehicle_discovered':
      return state.vehicles.has(msg.sysid) ? state : withVehicle(state, placeholder(msg.sysid))
    case 'vehicle_lost': {
      const vehicles = new Map(state.vehicles)
      vehicles.delete(msg.sysid)
      if (!state.roi.has(msg.sysid)) return { ...state, vehicles }
      const roi = new Map(state.roi)
      roi.delete(msg.sysid)
      return { ...state, vehicles, roi }
    }
    case 'vehicle_message': {
      const { t: _t, ...m } = msg
      const log = logReduce(state.log, { k: 'entry', entry: toLogEntry(m) })
      return { ...state, messages: [m, ...state.messages].slice(0, MAX_MESSAGES), log }
    }
    case 'log_entry': {
      const { t: _t, ...entry } = msg
      const log = logReduce(state.log, { k: 'entry', entry })
      return log === state.log ? state : { ...state, log }
    }
    case 'message_ack':
      return withAck(state, msg.id, msg.by, msg.ts)
    case 'command_result': {
      const { t: _t, ...r } = msg
      const results = addResult(state.results, r)
      return results === state.results ? state : { ...state, results }
    }
    default:
      return state
  }
}

export function setLink(state: VehiclesState, link: LinkState): VehiclesState {
  return state.link === link ? state : { ...state, link }
}

/** Local action: remember what the vehicle carries (not a server frame). */
export function withVehicleMission(state: VehiclesState, sysid: SysId, mission: Mission): VehiclesState {
  const vehicleMissions = new Map(state.vehicleMissions)
  vehicleMissions.set(sysid, mission)
  return { ...state, vehicleMissions }
}

/** A warning / error was acknowledged (by anyone): mark it in the log and the vehicle's list. */
export function withAck(state: VehiclesState, id: number, by: string, ts: number): VehiclesState {
  const log = logReduce(state.log, { k: 'ack', id, by, ts })
  const hit = state.messages.some((m) => m.id === id && m.acked_by === null)
  if (log === state.log && !hit) return state
  const messages = hit ? state.messages.map((m) => (m.id === id ? { ...m, acked_by: by, acked_at: ts } : m)) : state.messages
  return { ...state, log, messages }
}
