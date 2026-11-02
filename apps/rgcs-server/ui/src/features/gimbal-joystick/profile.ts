import { z } from 'zod'
import type { AxisFunction, ButtonFunction, GimbalInputProfile } from '../../shared/api/types'

export const AXIS_FUNCTIONS = ['none', 'pan', 'tilt'] as const satisfies readonly AxisFunction[]
export const BUTTON_FUNCTIONS = [
  'none',
  'shutter',
  'record_toggle',
  'center_gimbal',
  'thermal_toggle',
  'thermal_gain_toggle',
  'focus_near',
  'focus_far',
  'ai_tracking_toggle',
  'gimbal_stop',
  'zoom_in_step',
  'zoom_out_step',
  'zoom_1x',
  'mode_lock',
  'mode_follow',
  'mode_fpv',
  'mode_cycle',
  'roi_1',
  'roi_2',
  'roi_3',
  'roi_4',
  'roi_5',
  'roi_6',
  'roi_7',
  'roi_8',
  'roi_9',
  'roi_10',
  'roi_stop',
] as const satisfies readonly ButtonFunction[]

/** Mirrors `GimbalInputProfile::validate` on the server. */
export const profileSchema = z.object({
  device_id: z.string().nullable(),
  axes: z.array(
    z.object({
      axis: z.number().int().min(0).max(255),
      fn: z.enum(AXIS_FUNCTIONS),
      deadzone: z.number().min(0).max(0.5),
      invert: z.boolean(),
      scale: z.number().min(0.1).max(2),
    }),
  ),
  buttons: z.array(z.object({ button: z.number().int().min(0).max(255), fn: z.enum(BUTTON_FUNCTIONS) })),
  max_pan_speed: z.number().min(1).max(100),
  max_tilt_speed: z.number().min(1).max(100),
})

export const DEFAULT_PROFILE: GimbalInputProfile = {
  device_id: null,
  axes: [
    { axis: 0, fn: 'pan', deadzone: 0.08, invert: false, scale: 1 },
    { axis: 1, fn: 'tilt', deadzone: 0.08, invert: true, scale: 1 },
  ],
  buttons: [
    { button: 0, fn: 'record_toggle' },
    { button: 1, fn: 'shutter' },
    { button: 2, fn: 'center_gimbal' },
    { button: 3, fn: 'thermal_toggle' },
  ],
  max_pan_speed: 30,
  max_tilt_speed: 20,
}
