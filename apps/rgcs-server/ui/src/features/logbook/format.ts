// Display helpers for the logbook (JST dates and times, places, periods).
import type { Flight, InspectionRun, MaintenanceInput } from '../../shared/api/types'
import type { Dict } from '../../shared/i18n'

const JST = 'Asia/Tokyo'

const dateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: JST, year: 'numeric', month: '2-digit', day: '2-digit' })
const timeFmt = new Intl.DateTimeFormat('en-GB', { timeZone: JST, hour: '2-digit', minute: '2-digit', hour12: false })

/** `YYYY-MM-DD` in JST. */
export function jstDate(ms: number): string {
  return dateFmt.format(new Date(ms))
}

/** `HH:MM` in JST (24 h). */
export function jstTime(ms: number): string {
  return timeFmt.format(new Date(ms)).replace(/^24/, '00')
}

export function todayJst(now: Date = new Date()): string {
  return jstDate(now.getTime())
}

/** First day of the JST month … today. */
export function monthRange(now: Date = new Date()): { readonly from: string; readonly to: string } {
  const to = jstDate(now.getTime())
  return { from: `${to.slice(0, 8)}01`, to }
}

export function minutesText(n: number, dict: Dict): string {
  return `${n} ${dict.lbMinutes}`
}

/** The hand-entered place, else the coordinates to 5 decimals, else empty. */
export function placeText(place: string, lat: number | null, lon: number | null): string {
  if (place !== '') return place
  if (lat === null || lon === null) return ''
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`
}

/** `|`-separated dictionary lists (purposes, specific flight forms). */
export function splitList(s: string): readonly string[] {
  return s === '' ? [] : s.split('|')
}

/** Bytes as `x.x MB` / `x KB`. */
export function sizeText(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${Math.max(1, Math.round(bytes / 1024))} KB`
}

/** `datetime-local` value (JST) for a unix ms timestamp. */
export function toLocalInput(ms: number): string {
  return `${jstDate(ms)}T${jstTime(ms)}`
}

/** Parses a `datetime-local` value entered as JST back to unix ms; `null` when malformed. */
export function fromLocalInput(v: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) return null
  const ms = Date.parse(`${v.slice(0, 16)}:00+09:00`)
  return Number.isNaN(ms) ? null : ms
}

/** The maintenance draft offered after a run with 異常. */
export function maintenanceDraftFor(run: InspectionRun): MaintenanceInput {
  const ng = run.results.filter((r) => r.result === 'ng').map((r) => r.label)
  return { performed_on: run.performed_on, detail: `日常点検で異常: ${ng.join('、')}`, reason: '日常点検', place: run.place, engineer: run.inspector, notes: '', supersedes: null }
}

/** Replaces the edited flight (or the row it corrected) in place. */
export function replaceFlight(rows: readonly Flight[], saved: Flight): readonly Flight[] {
  const target = rows.findIndex((r) => r.id === saved.id || (saved.supersedes !== null && r.id === saved.supersedes))
  return target === -1 ? [...rows, saved] : rows.map((r, i) => (i === target ? saved : r))
}
