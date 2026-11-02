// Client-side checks for the ROI tab; the server validates again.
import { z } from 'zod'
import type { RoiControl, RoiTarget } from '../../shared/api/types'
import { ROI_SLOT_COUNT } from './csv'

const num = (lo: number, hi: number) => z.number().finite().min(lo).max(hi)

export const roiControlSchema: z.ZodType<RoiControl> = z.object({
  control_mode: z.enum(['rate', 'angle']),
  rate_hz: num(1, 50),
  target_rate_hz: num(0.2, 10),
  smoothing_tau_s: num(0, 10),
  deadband_deg: num(0, 5),
  pid_kp: num(0, 50),
  pid_ki: num(0, 20),
  pid_kd: num(0, 10),
  max_speed: num(1, 100),
  yaw_offset_deg: num(-180, 180),
})

const roiTargetSchema = z.object({
  id: z.string(),
  name: z.string().max(64),
  lat: num(-90, 90),
  lon: num(-180, 180),
  alt_msl: num(-500, 9000),
})

export const roiTargetsSchema = z.array(roiTargetSchema).length(ROI_SLOT_COUNT)

export const DEFAULT_ROI_CONTROL: RoiControl = {
  control_mode: 'rate',
  rate_hz: 10,
  target_rate_hz: 2,
  smoothing_tau_s: 0.8,
  deadband_deg: 0.3,
  pid_kp: 2,
  pid_ki: 0.2,
  pid_kd: 0,
  max_speed: 60,
  yaw_offset_deg: 0,
}

export const emptyTargets = (): RoiTarget[] => Array.from({ length: ROI_SLOT_COUNT }, (_, i) => ({ id: `roi_${i + 1}`, name: '', lat: 0, lon: 0, alt_msl: 0 }))

/** Ruling 11: a preset is usable when it has a name and a position other than 0,0. */
export const isSet = (t: RoiTarget): boolean => t.name.trim() !== '' && !(t.lat === 0 && t.lon === 0)

const round6 = (v: number) => Math.round(v * 1e6) / 1e6

/** 地図で指定: put the picked point into `slot` (name defaults to `ROI n`, prototype `pickRoi`). */
export function pickInto(targets: readonly RoiTarget[], slot: number, at: { lat: number; lon: number; alt: number }): RoiTarget[] {
  return targets.map((t, i) =>
    i === slot ? { ...t, name: t.name.trim() === '' ? `ROI ${slot + 1}` : t.name, lat: round6(at.lat), lon: round6(at.lon), alt_msl: Math.round(at.alt) } : t,
  )
}

/** The first slot that is not set, else the last one. */
export function nextEmptySlot(targets: readonly RoiTarget[]): number {
  const i = targets.findIndex((t) => !isSet(t))
  return i < 0 ? targets.length - 1 : i
}
