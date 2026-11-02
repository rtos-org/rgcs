// What each 点検・校正 card shows: the last run's date, amber after 30 days.
import type { CalibKind, CalibRecord, CalibStatus, VehicleKind } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { jstDate } from '../logbook/format'

export const STALE_MS = 30 * 86_400_000

export const isActive = (s: CalibStatus) => s.phase === 'running' || s.phase === 'waiting'

export type Tone = 'ok' | 'warn' | 'err' | 'idle'

export interface CardStatus {
  readonly tone: Tone
  readonly text: string
}

const slashDate = (ms: number) => jstDate(ms).replace(/-/g, '/')

export function cardStatus(kind: CalibKind, rec: CalibRecord | undefined, now: number, dict: Dict): CardStatus {
  if (!rec) return { tone: 'idle', text: dict.calNever }
  const date = slashDate(rec.at)
  if (!rec.ok) return { tone: 'err', text: dict.calFailed.replace('{date}', date) }
  if (kind === 'motor') return { tone: 'ok', text: dict.calMotorDone.replace('{date}', date) }
  if (now - rec.at > STALE_MS) return { tone: 'warn', text: dict.calStale }
  return { tone: 'ok', text: dict.calDone.replace('{date}', date) }
}

/** The maintenance tile's dot: a calibration failed last time or is older than 30 days (motor tests never go stale). */
export function needsAttention(records: readonly CalibRecord[], now: number): boolean {
  return records.some((r) => !r.ok || (r.kind !== 'motor' && now - r.at > STALE_MS))
}

const COMMON: readonly CalibKind[] = ['accel', 'compass', 'level', 'rc']

/** ESC calibration (`ESC_CALIBRATION`) is ArduCopter's; motor tests need multirotor motors. */
export function calibKinds(kind: VehicleKind | null, quadplane: boolean): readonly CalibKind[] {
  if (kind === 'copter') return [...COMMON, 'esc', 'motor']
  if (kind === 'plane' && quadplane) return [...COMMON, 'motor']
  return COMMON
}

/** Motors per `FRAME_CLASS` (quad, hexa, octa, octaquad, Y6, heli, tri, …). */
const MOTORS: Readonly<Record<number, number>> = { 1: 4, 2: 6, 3: 8, 4: 8, 5: 6, 7: 3, 10: 2, 12: 4, 14: 10, 15: 12 }

export function motorCount(params: Readonly<Record<string, number>>): number {
  const frame = params.Q_FRAME_CLASS ?? params.FRAME_CLASS
  return (frame === undefined ? undefined : MOTORS[frame]) ?? 4
}
