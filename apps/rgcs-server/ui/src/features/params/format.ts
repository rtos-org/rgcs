// Display strings for the maintenance view (progress, write results, history rows).
import type { ParamHistoryEntry, ParamProgress, ParamWriteResult } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'
import { formatNumber } from './changes'

/** Rows rendered at once; the rest is reached by narrowing the search. */
export const MAX_ROWS = 300

/** Parameters already listed but nothing received this session: the list is the last download. */
const cached = (p: ParamProgress | null, listed: number): boolean => listed > 0 && (p === null || (p.received === 0 && !p.downloading))

export function progressText(p: ParamProgress | null, listed: number, dict: Dict): string {
  if (cached(p, listed)) return dict.paramCached.replace('{n}', String(listed))
  if (p === null) return '–'
  return `${p.received} / ${p.total ?? '?'}`
}

export function progressPct(p: ParamProgress | null, listed: number): number | null {
  if (cached(p, listed) || p === null || p.total === null || p.total === 0) return null
  return Math.min(100, Math.round((p.received / p.total) * 100))
}

/** Why a write is not verified; empty when it is (the caller shows a Lucide check). */
export function resultText(r: ParamWriteResult, dict: Dict): string {
  if (r.verified) return ''
  const why = r.reason === 'vehicle_armed' ? dict.paramArmedAbort : r.reason === 'mismatch' ? dict.paramMismatch : dict.paramNoEcho
  return `${dict.paramUnverified} (${why})`
}

/** `NAME: old → new`; whether it was verified is its own column. */
export function historyText(e: ParamHistoryEntry): string {
  const old = e.old_value === null ? '?' : formatNumber(e.old_value)
  return `${e.name}: ${old} → ${formatNumber(e.new_value)}`
}

/** Local wall time `YYYY-MM-DD HH:MM:SS` of a store timestamp. */
export function historyTime(ts: string): string {
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return ts
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}
