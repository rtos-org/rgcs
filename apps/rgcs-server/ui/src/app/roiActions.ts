// GPS ROI start / stop from the cockpit chips and the joystick buttons.
// Failures go to the footer results like other commands; there is no dialog.
import type { CameraCommand, RoiStatus } from '../shared/api/types'
import type { ButtonAction } from '../features/gimbal-joystick'
import { startRoi, stopRoi } from '../features/roi/api'
import { useRoiTargets } from '../features/roi/targetsStore'
import { vehicleStore } from '../features/vehicles/store'

function report(sysid: number, cmd: string, e: unknown): void {
  vehicleStore.pushLocalResult({ id: -Date.now(), sysid, cmd, ok: false, reason: e instanceof Error ? e.message : String(e), ts: Date.now() })
}

export function roiStart(sysid: number, id: string): void {
  startRoi(sysid, id).catch((e: unknown) => report(sysid, 'roi_start', e))
}

export function roiStop(sysid: number): void {
  stopRoi(sysid).catch((e: unknown) => report(sysid, 'roi_stop', e))
}

/** Carries out a joystick button's action for `sysid`. */
export function runButtonAction(sysid: number, action: ButtonAction | null, camera: (sysid: number, cmd: CameraCommand) => void): void {
  if (action === null) return
  if (action.kind === 'camera') camera(sysid, action.cmd)
  else if (action.kind === 'roi_start') roiStart(sysid, action.id)
  else roiStop(sysid)
}

/** The name of the vehicle's active ROI preset (its id until the presets load), else null. */
export function useActiveRoiName(sysid: number | null, roi: ReadonlyMap<number, RoiStatus>): string | null {
  const targets = useRoiTargets(sysid)
  const id = sysid === null ? null : (roi.get(sysid)?.active_target ?? null)
  if (id === null) return null
  return targets.find((t) => t.id === id)?.name || id
}
