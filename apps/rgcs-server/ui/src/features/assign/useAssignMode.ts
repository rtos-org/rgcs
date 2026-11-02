// The state behind the flight plan screen's 編集 | 割当 switch (spec 2026-10-31 §3.1). The mode
// lives in the planner's component state, not the URL; the editor's own state lives in its
// stores, so going back to 編集 finds it untouched.
import { useMemo, useState } from 'react'
import type { VehicleState } from '../../shared/api/types'
import type { AssignOverlayInput } from './assignOverlay'
import type { BoardOverlay } from './board'

export interface AssignMode {
  readonly on: boolean
  readonly setOn: (on: boolean) => void
  /** For `AssignBoard`. */
  readonly onOverlay: (overlay: BoardOverlay | null) => void
  /** For `MissionMap`: null in 編集. */
  readonly assign: AssignOverlayInput | null
}

const EMPTY: BoardOverlay = { plans: [], colours: new Map(), assignments: new Map(), highlight: null }

export function useAssignMode(vehicles: ReadonlyMap<number, VehicleState>): AssignMode {
  const [on, setOn] = useState(false)
  const [overlay, setOverlay] = useState<BoardOverlay | null>(null)
  const assign = useMemo(() => (on ? { ...(overlay ?? EMPTY), vehicles: [...vehicles.values()] } : null), [on, overlay, vehicles])
  return { on, setOn, onOverlay: setOverlay, assign }
}
