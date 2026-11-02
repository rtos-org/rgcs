import type { RoiStatus } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'

/** The translated `roiErr_*` for a ruling-10 error code; an unknown code is shown as is. */
export function roiErrorText(code: string, dict: Dict): string {
  const key = `roiErr_${code}`
  return key in dict ? dict[key as keyof Dict] : code
}

/** Camera card / status text: "送電塔 A  方位 123°  412 m", or the name and the error. */
export function roiText(name: string, s: RoiStatus | undefined, dict: Dict): string {
  if (!s) return name
  if (s.error) return `${name}  ${roiErrorText(s.error, dict)}`
  if (s.bearing_deg === null || s.distance_m === null) return name
  return `${name}  ${dict.roiBearing} ${Math.round(s.bearing_deg)}°  ${Math.round(s.distance_m)} m`
}
