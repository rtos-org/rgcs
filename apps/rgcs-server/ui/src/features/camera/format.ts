import type { ZoomUnit } from '../../shared/api/types'

/** `1.5×` for a multiplier; `40%` for a camera that reports zoom as a percentage of its range (MAVLink). */
export function zoomText(zoom: number, unit: ZoomUnit = 'times'): string {
  return unit === 'percent' ? `${Math.round(zoom)}%` : `${zoom.toFixed(1)}×`
}

/** Typographic minus, one decimal, degree sign. */
export function angleText(deg: number): string {
  const v = Math.abs(deg).toFixed(1)
  return `${deg < 0 ? '−' : ''}${v}°`
}

export function recDuration(startedAt: number, now: number): string {
  const total = Math.max(0, Math.floor((now - startedAt) / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const p = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${p(m)}:${p(s)}`
}
