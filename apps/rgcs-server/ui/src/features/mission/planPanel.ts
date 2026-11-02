// Whether the planner's right panel is folded to its rail (spec 2026-10-20 §9), remembered per
// browser and shared by the Mission / Fence / Rally tabs.
import { useState } from 'react'

const PANEL_KEY = 'rgcs.planPanel'

export function readPanelCollapsed(): boolean {
  try {
    return localStorage.getItem(PANEL_KEY) === 'collapsed'
  } catch {
    return false
  }
}

export function savePanelCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(PANEL_KEY, collapsed ? 'collapsed' : 'open')
  } catch {
    // a per-viewer convenience only
  }
}

export interface PlanPanel {
  readonly collapsed: boolean
  readonly collapse: () => void
  readonly expand: () => void
}

export function usePlanPanel(): PlanPanel {
  const [collapsed, setCollapsed] = useState(readPanelCollapsed)
  const set = (next: boolean) => {
    savePanelCollapsed(next)
    setCollapsed(next)
  }
  return { collapsed, collapse: () => set(true), expand: () => set(false) }
}
