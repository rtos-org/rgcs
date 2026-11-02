import type { VehicleCommand } from '../../shared/api/types'

/** MAV_CMD_DO_SET_MISSION_CURRENT: param1 is the mission seq to continue from. */
export const MAV_CMD_DO_SET_MISSION_CURRENT = 224

/** A clicked mission badge: its owner, its number and where it sits in the viewport. */
export interface WaypointPick {
  readonly sysid: number
  /** The badge number: items are 1-based and seq 0 is home, so it equals the MAVLink seq. */
  readonly n: number
  readonly x: number
  readonly y: number
}

/** "Go to WP n": the mission continues from seq n; the flight mode is left as it is. */
export function wpGoCommand(n: number): VehicleCommand {
  return { cmd: 'other', args: { mav_cmd: MAV_CMD_DO_SET_MISSION_CURRENT, params: [n, 0, 0, 0, 0, 0, 0] } }
}

const EDGE = 8
const GAP = 10

/** Top-left of the popover: centred under the anchor, above it when there is no room below, inside the viewport. */
export function popoverPlacement(at: { readonly x: number; readonly y: number }, size: { readonly w: number; readonly h: number }, view: { readonly w: number; readonly h: number }): { left: number; top: number } {
  const clamp = (v: number, hi: number) => Math.min(Math.max(v, EDGE), Math.max(EDGE, hi))
  const below = at.y + GAP
  const top = below + size.h > view.h - EDGE ? at.y - GAP - size.h : below
  return { left: clamp(at.x - size.w / 2, view.w - size.w - EDGE), top: clamp(top, view.h - size.h - EDGE) }
}
