// Status texts for the MT11 thermal / SD / clock / encoding / tracking state (prototype view model 2165-2177).
import { ApiError } from '../../shared/api/client'
import type { CameraClock, EncodingInfo, StorageInfo, ThermalState, TrackState } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'

/** Looks up `<prefix><code>`; an unknown code comes back as null. */
function codeText(dict: Dict, prefix: string, code: string): string | null {
  const key = `${prefix}${code}`
  return key in dict ? dict[key as keyof Dict] : null
}

/** 'High  68.4 / 11.2℃'; the gain alone without a frame; null when neither is known. */
export function thermalText(t: ThermalState | null | undefined): string | null {
  if (!t) return null
  const gain = t.gain === null ? null : t.gain === 'high' ? 'High' : 'Low'
  const frame = t.frame ? `${t.frame.max_c.toFixed(1)} / ${t.frame.min_c.toFixed(1)}℃` : null
  const text = [gain, frame].filter(Boolean).join('  ')
  return text === '' ? null : text
}

/** '56.3 / 128 GB  44%' when the card is ok; otherwise the translated status (the code without a dict). */
export function sdText(s: StorageInfo | null | undefined, dict?: Dict): string | null {
  if (!s) return null
  if (s.status !== 'ok') return (dict && codeText(dict, 'sdStatus_', s.status)) ?? s.status
  const total = Number(s.total_gb.toFixed(1))
  const pct = s.free_pct === null ? null : `${Math.round(s.free_pct)}%`
  return [`${s.free_gb.toFixed(1)} / ${total} GB`, pct].filter(Boolean).join('  ')
}

/** red when the card is not ok or under 10 % free. */
export function sdDanger(s: StorageInfo | null | undefined): boolean {
  if (!s) return false
  return s.status !== 'ok' || (s.free_pct !== null && s.free_pct < 10)
}

/** 'GPS 同期 +0.3 s' (camera − GPS), the translated error, or '—'. */
export function clockText(c: CameraClock | null | undefined, dict: Dict): string {
  if (!c) return dict.unknown
  if (c.error !== null) return codeText(dict, 'clockErr_', c.error) ?? c.error
  if (c.offset_ms === null) return dict.unknown
  const magnitude = (Math.abs(c.offset_ms) / 1000).toFixed(1)
  const sign = c.offset_ms < 0 && Number(magnitude) > 0 ? '−' : '+'
  return `${dict.clockGps} ${sign}${magnitude} s`
}

/** Red when |offset| > 1000 ms or the last sync failed. */
export function clockDanger(c: CameraClock | null | undefined): boolean {
  if (!c) return false
  return c.error !== null || (c.offset_ms !== null && Math.abs(c.offset_ms) > 1000)
}

const CODECS: Record<EncodingInfo['codec'], string | null> = { h264: 'H.264', h265: 'H.265', unknown: null }

/** 'H.265 1080p', 'H.264 4K'; null when nothing is known. */
export function encodingLabel(e: EncodingInfo | null | undefined): string | null {
  if (!e) return null
  const res = e.height <= 0 ? null : e.height >= 2160 ? '4K' : `${e.height}p`
  const text = [CODECS[e.codec], res].filter(Boolean).join(' ')
  return text === '' ? null : text
}

const TRACK: Record<TrackState['status'], keyof Dict> = { tracking: 'trackTracking', searching: 'trackSearching', lost: 'trackLost' }

/** 追跡中 / 再捕捉中 / 見失い; null without a track. */
export function trackLabel(t: TrackState | null | undefined, dict: Dict): string | null {
  return t ? dict[TRACK[t.status]] : null
}

/** A camera command failure for the log: a ruling-4 refusal code is translated, anything else keeps its message. */
export function cameraErrorText(e: unknown, dict: Dict): string {
  if (e instanceof ApiError) return codeText(dict, 'camErr_', e.code) ?? e.message
  return e instanceof Error ? e.message : String(e)
}
