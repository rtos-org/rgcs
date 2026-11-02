// 詳細パネルのピン: a pinned panel stays on its vehicle while the selection moves.
import type { SysId } from '../shared/api/types'

/** The vehicle the right panel shows: the pinned one while it exists, else the selection. */
export function panelSysid(pinned: SysId | null, selected: SysId | null, exists: (sysid: SysId) => boolean): SysId | null {
  return pinned !== null && exists(pinned) ? pinned : selected
}

/** The pin button on the panel showing `shown`: pins it, or unpins when it is the pinned one. */
export function togglePin(pinned: SysId | null, shown: SysId): SysId | null {
  return pinned === shown ? null : shown
}
