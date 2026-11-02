import { ApiError } from '../../shared/api/client'
import type { Dict } from '../../shared/i18n'

/** The server's tile cap for one area (`OVERLAY_MAX_TILES`). */
export const AREA_MAX_TILES = 3000

/** A failed area call in the operator's words. */
export function areaErrorText(e: unknown, dict: Dict): string {
  const code = e instanceof ApiError ? e.code : 'network'
  if (code === 'too_many_tiles') return dict.ovErrTooMany.replace('{max}', String(AREA_MAX_TILES))
  if (code === 'bad_rect') return dict.ovErrBadRect
  if (code === 'busy') return dict.ovErrBusy
  return dict.ovErrOther.replace('{code}', code)
}
