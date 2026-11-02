/** `HH:MM` in local time, for log pills and message rows. */
export function hhmm(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}`
}

/** `HH:MM:SS` in local time, for message log rows (prototype log). */
export function hhmmss(ts: number): string {
  const d = new Date(ts)
  return `${hhmm(ts)}:${String(d.getSeconds()).padStart(2, '0')}`
}

/** `YYYY/MM/DD HH:MM` in local time: the app's date format (the header clock without the weekday). */
export function ymdHm(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${hhmm(ts)}`
}

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`

/**
 * A message's time: `HH:MM:SS` today, `<yesterday> HH:MM` for yesterday, `MM/DD HH:MM`
 * before that, so an old alert never reads as current.
 */
export function msgStamp(ts: number, now: number, yesterday: string): string {
  const d = new Date(ts)
  if (dayKey(d) === dayKey(new Date(now))) return hhmmss(ts)
  const y = new Date(now)
  y.setDate(y.getDate() - 1)
  if (dayKey(d) === dayKey(y)) return `${yesterday} ${hhmm(ts)}`
  return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')} ${hhmm(ts)}`
}

/** `YYYY-MM-DD HH:MM` in the browser's zone (status rows, consent records). */
export function dateTimeText(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${hhmm(ts)}`
}
