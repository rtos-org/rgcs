// What the planner map takes from the open plans: the other ones (shown, not missing, not
// the one being edited). `workspace` already holds the live editor in the active row.
import { useMemo } from 'react'
import type { Workspace } from './model'
import type { OtherMission } from './overlay'

export interface PlanSetMap {
  readonly others: readonly OtherMission[]
}

export function planSetMapOf(ws: Workspace): PlanSetMap {
  // a hidden row is not drawn (the active row is never hidden); predicting a parked row needs its
  // vehicle's parameters: only its plan is drawn
  const others = ws.rows
    .filter((r) => !r.missing && !r.hidden && r.key !== ws.active)
    .map((r): OtherMission => ({ key: r.key, color: r.color, draft: r.ui.history.present, predicted: null }))
  return { others }
}

/** MissionMap's open-plan props. */
export function usePlanSetMap(ws: Workspace): PlanSetMap {
  return useMemo(() => planSetMapOf(ws), [ws])
}
