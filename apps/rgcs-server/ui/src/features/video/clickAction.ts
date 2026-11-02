// What a click on the cockpit video means.
import type { CameraCaps, CameraCommand, CameraState } from '../../shared/api/types'
import { knownStream } from './geometry'

export type RefuseCode = 'rgb_only' | 'thermal_only' | 'stream_unknown'
export type ClickResult = { kind: 'command'; cmd: CameraCommand } | { kind: 'refuse'; code: RefuseCode } | null

export interface ClickMods {
  readonly ctrl: boolean
  readonly meta: boolean
  readonly alt: boolean
}

const refuse = (code: RefuseCode): ClickResult => ({ kind: 'refuse', code })
const command = (cmd: CameraCommand): ClickResult => ({ kind: 'command', cmd })

/** Alt+click: point temperature, IR only. */
function measureClick(nx: number, ny: number, state: CameraState, caps: CameraCaps): ClickResult {
  if (!caps.thermal?.point_temp) return caps.ai_tracking ? refuse('thermal_only') : null
  if (state.video_mode !== 'thermal') return refuse('thermal_only')
  if (knownStream(state.stream) === null) return refuse('stream_unknown')
  return command({ cmd: 'measure_point', args: { x: nx, y: ny } })
}

/**
 * Plain click → box select of `boxPx`, Ctrl / ⌘ + click → detection point select (RGB only),
 * Alt + click → point temperature (IR only). 2画面 ignores clicks. The server checks again.
 */
export function clickAction(mods: ClickMods, nx: number, ny: number, state: CameraState, caps: CameraCaps, boxPx: number): ClickResult {
  const mode = state.video_mode ?? 'rgb'
  if (mode === 'side_by_side') return null
  if (mods.alt) return measureClick(nx, ny, state, caps)
  if (!caps.ai_tracking) return null
  if (mode !== 'rgb') return refuse('rgb_only')
  if (knownStream(state.stream) === null) return refuse('stream_unknown')
  if (mods.ctrl || mods.meta) return command({ cmd: 'ai_select_point', args: { x: nx, y: ny } })
  return command({ cmd: 'ai_select_box', args: { x: nx, y: ny, box_px: boxPx } })
}
