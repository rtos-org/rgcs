import type { VehicleCommand, VehicleState } from '../../shared/api/types'

/** MAV_CMD_SET_MESSAGE_INTERVAL: param1 = message id, param2 = interval in µs (0 = default, -1 = stop). */
export const MAV_CMD_SET_MESSAGE_INTERVAL = 511
export const MAX_RATE_HZ = 50
export const INTERVAL_DEFAULT = 0
export const INTERVAL_STOP = -1

/** The typed rate when it is finite and 0 < hz <= 50, otherwise null. */
export function parseHz(text: string): number | null {
  const s = text.trim()
  if (s === '') return null
  const hz = Number(s)
  return Number.isFinite(hz) && hz > 0 && hz <= MAX_RATE_HZ ? hz : null
}

export function intervalUs(hz: number): number {
  return Math.round(1e6 / hz)
}

export function intervalCommand(msgId: number, intervalMicros: number): VehicleCommand {
  return { cmd: 'other', args: { mav_cmd: MAV_CMD_SET_MESSAGE_INTERVAL, params: [msgId, intervalMicros, 0, 0, 0, 0, 0] } }
}

/** HEARTBEAT: slowing or stopping it makes RGCS declare the vehicle lost, and every command is refused. */
export const HEARTBEAT_ID = 0
/** HEARTBEAT, SYS_STATUS, GPS_RAW_INT, ATTITUDE, GLOBAL_POSITION_INT, MISSION_CURRENT, VFR_HUD. */
const CORE_TELEMETRY: ReadonlySet<number> = new Set([0, 1, 24, 30, 33, 42, 74])
/** The slowest rate a core telemetry message may be set to while the vehicle is armed. */
export const ARMED_MIN_HZ = 0.5

export function isHeartbeat(msgId: number): boolean {
  return msgId === HEARTBEAT_ID
}

export function isCoreTelemetry(msgId: number): boolean {
  return CORE_TELEMETRY.has(msgId)
}

/** Stopping core telemetry is refused while armed. */
export function canStop(msgId: number, armed: boolean): boolean {
  return !(armed && isCoreTelemetry(msgId))
}

/** While armed, core telemetry may not be slowed below ARMED_MIN_HZ. */
export function rateAllowed(hz: number, msgId: number, armed: boolean): boolean {
  return !(armed && isCoreTelemetry(msgId)) || hz >= ARMED_MIN_HZ
}

export type RateGate = 'unknown' | 'lost' | 'armed' | 'disarmed'

/** What the rate controls depend on: a primitive, so a store selector re-renders only when it changes. */
export function rateGate(state: { readonly vehicles: ReadonlyMap<number, VehicleState> }, sysid: number): RateGate {
  const v = state.vehicles.get(sysid)
  if (v === undefined) return 'unknown'
  if (v.link === 'lost') return 'lost'
  return v.armed ? 'armed' : 'disarmed'
}
