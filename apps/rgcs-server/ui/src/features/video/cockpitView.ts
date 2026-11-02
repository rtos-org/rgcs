import type { GimbalMode, ZoomUnit } from '../../shared/api/types'
import type { Latency } from '../../shared/video'
import { angleText } from '../camera'

/**
 * The zoom slider runs 0..1000 on a log scale so 1×–2× gets as much travel as 80×–165×.
 * A percent zoom (MAVLink, 0–100 % of the range) is linear.
 */
export const ZOOM_SLIDER_MAX = 1000
/** Box size for a centre start (AI追跡 button, joystick `ai_tracking_toggle`). */
export const AI_CENTRE_BOX_PX = 200
/** The dial's rim: ±90° of yaw / pitch lands this many pixels from the centre (prototype `.cam-dial`). */
const DIAL_RIM_PX = 36
const DIAL_RANGE_DEG = 90

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export function zoomToPos(zoom: number, max: number, unit: ZoomUnit = 'times'): number {
  if (unit === 'percent') return max > 0 ? Math.round(clamp(zoom / max, 0, 1) * ZOOM_SLIDER_MAX) : 0
  if (max <= 1) return 0
  return Math.round(clamp(Math.log(zoom) / Math.log(max), 0, 1) * ZOOM_SLIDER_MAX)
}

export function posToZoom(pos: number, max: number, unit: ZoomUnit = 'times'): number {
  if (unit === 'percent') return Math.round((clamp(pos, 0, ZOOM_SLIDER_MAX) / ZOOM_SLIDER_MAX) * max)
  if (max <= 1) return 1
  const zoom = Math.exp((clamp(pos, 0, ZOOM_SLIDER_MAX) / ZOOM_SLIDER_MAX) * Math.log(max))
  return clamp(Math.round(zoom * 10) / 10, 1, max)
}

/** Yaw across, pitch up (screen y grows downwards); `+ 0` keeps −0 out of styles. */
export function dialOffset(att: { readonly yaw: number; readonly pitch: number } | null): { x: number; y: number } {
  if (!att) return { x: 0, y: 0 }
  const px = (deg: number) => clamp((deg / DIAL_RANGE_DEG) * DIAL_RIM_PX, -DIAL_RIM_PX, DIAL_RIM_PX) + 0
  return { x: px(att.yaw), y: px(-att.pitch) }
}

const MODE_NAME: Record<GimbalMode, string> = { lock: 'Lock', follow: 'Follow', fpv: 'FPV' }

export function gimbalText(mode: GimbalMode | null, att: { readonly yaw: number; readonly pitch: number } | null): string {
  const parts = [mode ? MODE_NAME[mode] : '', att ? `${angleText(att.yaw)} / ${angleText(att.pitch)}` : ''].filter(Boolean)
  return parts.length > 0 ? parts.join('  ') : '—'
}

/** Receiver-side delay: what the jitter buffer holds plus the one-way network time (half the round trip). */
export function latencyText(l: Latency | null): string {
  if (!l || (l.jitter === null && l.rtt === null)) return '— ms'
  return `${(l.jitter ?? 0) + Math.round((l.rtt ?? 0) / 2)} ms`
}
