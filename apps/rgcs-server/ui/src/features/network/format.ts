// Number formatting for the network inspector.
import { t, type Dict } from '../../shared/i18n'

const JA = t('ja')

/** One decimal, rounded half up on the tenth (9.96 → '10.0'), unlike a bare `toFixed(1)`. */
export function fmtRate(n: number): string {
  return (Math.round(n * 10) / 10).toFixed(1)
}

/** `210 B/s`, `2.0 KB/s`, `1.4 MB/s` (binary units). */
export function fmtBytes(bps: number): string {
  if (bps < 1024) return `${Math.round(bps)} B/s`
  if (bps < 1024 * 1024) return `${fmtRate(bps / 1024)} KB/s`
  return `${fmtRate(bps / (1024 * 1024))} MB/s`
}

/** `0.4 s` under 10 s, `42 s` under a minute, then `1 分 5 秒` / `1 時間 2 分` (en: `1 min 5 s`). */
export function fmtAge(ms: number | null, dict: Dict = JA): string {
  if (ms === null || !Number.isFinite(ms)) return '—'
  const s = Math.max(0, ms) / 1000
  if (s < 10) return `${fmtRate(s)} s`
  if (s < 60) return `${Math.floor(s)} s`
  const total = Math.floor(s)
  if (total < 3600) return dict.netMinSec.replace('{m}', String(Math.floor(total / 60))).replace('{s}', String(total % 60))
  return dict.netHourMin.replace('{h}', String(Math.floor(total / 3600))).replace('{m}', String(Math.floor((total % 3600) / 60)))
}

/** `0.0 %`. */
export const fmtLoss = (pct: number): string => `${fmtRate(pct)} %`
