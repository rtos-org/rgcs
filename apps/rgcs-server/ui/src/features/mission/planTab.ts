// The planner tab (Mission / Fence / Rally), remembered per browser.
import type { PlanTab } from './fenceMap'

const TAB_KEY = 'rgcs.planTab'
export const PLAN_TABS: readonly PlanTab[] = ['mission', 'fence', 'rally']

export function readPlanTab(): PlanTab {
  try {
    const v = localStorage.getItem(TAB_KEY)
    return v === 'fence' || v === 'rally' ? v : 'mission'
  } catch {
    return 'mission'
  }
}

export function savePlanTab(tab: PlanTab): void {
  try {
    localStorage.setItem(TAB_KEY, tab)
  } catch {
    // a per-viewer convenience only
  }
}
