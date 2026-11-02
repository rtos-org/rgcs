// Shapes shared by the assignment board's panels.
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { AssignOverlayInput } from './assignOverlay'

/** What a board drag carries: a plan, and the vehicle it is moved off (null from a plan card). */
export interface AssignDrag {
  readonly planId: number
  readonly from: number | null
}

/** `useCardDrag<AssignDrag>().dragProps`. */
export type DragPropsFn = (payload: AssignDrag, enabled?: boolean) => { onPointerDown: (e: ReactPointerEvent) => void }

/** Enter / Space on a role="button" card act like a click. */
export function isActivation(key: string): boolean {
  return key === 'Enter' || key === ' '
}

/** What the board feeds the planner map; the planner adds the vehicles it already has. */
export type BoardOverlay = Omit<AssignOverlayInput, 'vehicles'>
