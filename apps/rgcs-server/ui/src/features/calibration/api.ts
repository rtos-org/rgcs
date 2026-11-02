// REST calls for 点検・校正: sessions, motor test, reboot.
import { apiFetch } from '../../shared/api/client'
import type { CalibKind, CalibRecord, CalibStatus } from '../../shared/api/types'
import { requestConfirm, sendCommand } from '../commands/api'

/** A calibration start waits for the vehicle's ACK (gyro calibration first for the accelerometer). */
const CALIB_TIMEOUT_MS = 30_000
const MAV_CMD_PREFLIGHT_REBOOT_SHUTDOWN = 246

export interface CalibOverview {
  readonly records: CalibRecord[]
  readonly session: CalibStatus | null
}

export interface MotorRun {
  readonly motor: number
  readonly pct: number
  readonly seconds: number
  /** Motors run one after another from `motor`; 0 = only `motor`. */
  readonly count: number
}

export interface MotorReply {
  readonly ok: boolean
  readonly reason: string | null
}

export type CalibStep = 'next' | 'cancel' | 'finish'

const base = (sysid: number) => `/api/vehicles/${sysid}/calibration`

export const getCalibration = (sysid: number): Promise<CalibOverview> => apiFetch(base(sysid))

export function startCalibration(sysid: number, kind: CalibKind, confirmToken?: string): Promise<CalibStatus> {
  const body = confirmToken === undefined ? { kind } : { kind, confirm_token: confirmToken }
  return apiFetch(base(sysid), { method: 'POST', body, timeoutMs: CALIB_TIMEOUT_MS })
}

export const stepCalibration = (sysid: number, step: CalibStep): Promise<CalibStatus | null> =>
  apiFetch(`${base(sysid)}/${step}`, { method: 'POST', body: {}, timeoutMs: CALIB_TIMEOUT_MS })

/** ESC calibration writes ESC_CALIBRATION and needs a confirm token (`calib_esc`). */
export async function startEsc(sysid: number): Promise<CalibStatus> {
  const { confirm_token } = await requestConfirm(sysid, 'calib_esc')
  return startCalibration(sysid, 'esc', confirm_token)
}

export async function motorTest(sysid: number, run: MotorRun): Promise<MotorReply> {
  const { confirm_token } = await requestConfirm(sysid, 'motor_test')
  return apiFetch(`/api/vehicles/${sysid}/motor-test`, { method: 'POST', body: { ...run, confirm_token }, timeoutMs: CALIB_TIMEOUT_MS })
}

/** The new compass calibration takes effect after a reboot. */
export const rebootVehicle = (sysid: number) =>
  sendCommand(sysid, { cmd: 'other', args: { mav_cmd: MAV_CMD_PREFLIGHT_REBOOT_SHUTDOWN, params: [1, 0, 0, 0, 0, 0, 0] } })
