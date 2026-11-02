// Per-mission comparison figures for the plan comparison table: distance, flight time and an estimated battery use.
import type { Draft } from '../mission/model'
import { stats } from '../mission/summary'

/** Battery reserve kept back from the estimate; the warning fires when the estimated use exceeds 1 - RESERVE. */
export const RESERVE = 0.3

export interface CompareRow {
  readonly key: string
  readonly distanceM: number
  readonly durationS: number
  /** Estimated battery use in percent (目安); null when the vehicle's endurance is unknown. */
  readonly batteryPct: number | null
  readonly batteryWarn: boolean
}

export interface CompareInput {
  readonly key: string
  readonly draft: Draft
  readonly enduranceMin: number | null
}

function batteryFor(durationS: number, enduranceMin: number | null): number | null {
  if (enduranceMin === null || enduranceMin <= 0) return null
  return Math.round((durationS / 60 / enduranceMin) * 100)
}

export function compareRows(rows: readonly CompareInput[]): readonly CompareRow[] {
  return rows.map(({ key, draft, enduranceMin }) => {
    const s = stats(draft.items, draft.mission.home, draft.mission.speed)
    const batteryPct = batteryFor(s.duration_s, enduranceMin)
    return {
      key,
      distanceM: s.distance_m,
      durationS: s.duration_s,
      batteryPct,
      batteryWarn: batteryPct !== null && batteryPct > (1 - RESERVE) * 100,
    }
  })
}
