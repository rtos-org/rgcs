import type { ButtonFunction, CameraCommand, CameraState, VideoMode } from '../../shared/api/types'
import { AI_CENTRE_BOX_PX } from '../video/cockpitView'

const VIDEO_CYCLE: readonly VideoMode[] = ['rgb', 'thermal', 'side_by_side']

/** The camera command a button function means given the current camera state. */
export function buttonCommand(fn: ButtonFunction, state: CameraState | null): CameraCommand | null {
  switch (fn) {
    case 'shutter':
      return { cmd: 'photo' }
    case 'record_toggle':
      return state?.recording === 'recording' ? { cmd: 'record_stop' } : { cmd: 'record_start' }
    case 'center_gimbal':
      return { cmd: 'gimbal_center', args: { mode: 'one_key_reset' } }
    case 'thermal_toggle': {
      const i = VIDEO_CYCLE.indexOf(state?.video_mode ?? 'rgb')
      return { cmd: 'video_mode', args: { mode: VIDEO_CYCLE[(i + 1) % VIDEO_CYCLE.length]! } }
    }
    case 'zoom_in_step':
      return { cmd: 'zoom_step', args: { steps: 1 } }
    case 'zoom_out_step':
      return { cmd: 'zoom_step', args: { steps: -1 } }
    case 'zoom_1x':
      return { cmd: 'zoom_reset' }
    case 'mode_lock':
      return { cmd: 'gimbal_mode', args: { mode: 'lock' } }
    case 'mode_follow':
      return { cmd: 'gimbal_mode', args: { mode: 'follow' } }
    case 'mode_fpv':
      return { cmd: 'gimbal_mode', args: { mode: 'fpv' } }
    case 'mode_cycle': {
      const order = ['lock', 'follow', 'fpv'] as const
      const i = order.indexOf(state?.gimbal_mode ?? 'lock')
      return { cmd: 'gimbal_mode', args: { mode: order[(i + 1) % order.length]! } }
    }
    case 'thermal_gain_toggle':
      return { cmd: 'thermal_gain', args: { gain: state?.thermal?.gain === 'high' ? 'low' : 'high' } }
    case 'ai_tracking_toggle':
      return state?.track ? { cmd: 'ai_cancel' } : { cmd: 'ai_select_box', args: { x: 0.5, y: 0.5, box_px: AI_CENTRE_BOX_PX } }
    case 'focus_near':
      return { cmd: 'focus', args: { dir: -1 } }
    case 'focus_far':
      return { cmd: 'focus', args: { dir: 1 } }
    case 'gimbal_stop':
    case 'roi_stop':
    case 'roi_1':
    case 'roi_2':
    case 'roi_3':
    case 'roi_4':
    case 'roi_5':
    case 'roi_6':
    case 'roi_7':
    case 'roi_8':
    case 'roi_9':
    case 'roi_10':
    case 'none':
      return null
  }
}

/** What releasing a held button sends: focus runs while the button is down. */
export function releaseCommand(fn: ButtonFunction): CameraCommand | null {
  return fn === 'focus_near' || fn === 'focus_far' ? { cmd: 'focus', args: { dir: 0 } } : null
}

/** What a joystick button does: a camera command, or starting / stopping a GPS ROI preset. */
export type ButtonAction = { kind: 'camera'; cmd: CameraCommand } | { kind: 'roi_start'; id: string } | { kind: 'roi_stop' }

const ROI_PRESET = /^roi_(10|[1-9])$/

/**
 * `roi_N` toggles that preset (押すたびに開始 / 停止; another active preset is
 * replaced), `roi_stop` stops (nothing while inactive), everything else is a camera command.
 */
export function buttonAction(fn: ButtonFunction, state: CameraState | null, roiActive: string | null): ButtonAction | null {
  if (ROI_PRESET.test(fn)) return roiActive === fn ? { kind: 'roi_stop' } : { kind: 'roi_start', id: fn }
  if (fn === 'roi_stop') return roiActive === null ? null : { kind: 'roi_stop' }
  const cmd = buttonCommand(fn, state)
  return cmd ? { kind: 'camera', cmd } : null
}
