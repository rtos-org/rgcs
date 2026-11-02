import type { VehicleState, VehicleStateDiff } from '../api/types'

/** Merge a telemetry diff into a state without mutating either. */
export function applyDiff(state: VehicleState, diff: VehicleStateDiff): VehicleState {
  const next: VehicleState = { ...state }
  for (const key of Object.keys(diff) as (keyof VehicleStateDiff)[]) {
    const value = diff[key]
    if (value !== undefined) {
      Object.assign(next, { [key]: value })
    }
  }
  return next
}
