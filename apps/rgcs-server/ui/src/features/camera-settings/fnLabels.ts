// Words for the joystick axis / button functions instead of their raw ids.
import type { Dict } from '../../shared/i18n'
import type { AXIS_FUNCTIONS, BUTTON_FUNCTIONS } from '../gimbal-joystick/profile'

export const axisFnLabel = (f: (typeof AXIS_FUNCTIONS)[number], dict: Dict): string => dict[`fn_${f}`]

export function buttonFnLabel(f: (typeof BUTTON_FUNCTIONS)[number], dict: Dict): string {
  const roi = /^roi_(\d+)$/.exec(f)
  if (roi) return dict.fn_roi.replace('{n}', roi[1]!)
  return dict[`fn_${f}` as keyof Dict] ?? f
}
