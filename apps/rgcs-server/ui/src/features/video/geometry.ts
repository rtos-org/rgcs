// Overlay geometry for the cockpit video (port of the Python app's video_geometry.js).
// The cockpit is full-bleed, so the picture is `object-fit: cover`, not letterboxed.
import type { Detection, NormRect } from '../../shared/api/types'

/** The 0x20 main-stream size, or null while unknown or degenerate (a 0, 1-pixel reply). */
export function knownStream(stream: readonly [number, number] | null): [number, number] | null {
  return stream && stream[0] > 1 && stream[1] > 1 ? [stream[0], stream[1]] : null
}

export interface Rect {
  readonly x: number
  readonly y: number
  readonly w: number
  readonly h: number
}

/** Where the whole picture lands inside the element (it overflows on the cropped side), or null while a size is unknown. */
export function coverRect(elW: number, elH: number, vidW: number, vidH: number): Rect | null {
  if (!(elW > 0 && elH > 0 && vidW > 0 && vidH > 0)) return null
  // Fit the limiting side exactly (no float drift on it); the other side overflows.
  const widthLimited = elW / vidW >= elH / vidH
  const w = widthLimited ? elW : (vidW * elH) / vidH
  const h = widthLimited ? (vidH * elW) / vidW : elH
  return { x: (elW - w) / 2, y: (elH - h) / 2, w, h }
}

/** Element-local point → normalized picture coordinates, or null outside the picture. */
export function toNormalized(px: number, py: number, r: Rect | null): { nx: number; ny: number } | null {
  if (!r) return null
  const nx = (px - r.x) / r.w
  const ny = (py - r.y) / r.h
  if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return null
  return { nx, ny }
}

/** Normalized top-left box (0x50 track) → display rect. */
export function rectToDisplay(b: NormRect, r: Rect): Rect {
  return { x: r.x + b.x * r.w, y: r.y + b.y * r.h, w: b.w * r.w, h: b.h * r.h }
}

/** Normalized corner box (0x5F detection) → display rect. */
export function detectionToDisplay(d: Detection, r: Rect): Rect {
  return { x: r.x + d.x0 * r.w, y: r.y + d.y0 * r.h, w: (d.x1 - d.x0) * r.w, h: (d.y1 - d.y0) * r.h }
}

/** Main-stream pixel (thermal 0x12 / 0x14) → display point. */
export function pointToDisplay(xy: readonly [number, number], stream: readonly [number, number], r: Rect): { x: number; y: number } {
  return { x: r.x + (xy[0] / stream[0]) * r.w, y: r.y + (xy[1] / stream[1]) * r.h }
}

function axisSpan(center: number, size: number, limit: number): [number, number] {
  const s = Math.min(size, limit - 1)
  const start = Math.max(0, Math.min(Math.round(center - s / 2), limit - 1 - s))
  return [start, start + s]
}

/** Display rect of the stream-pixel box the driver selects for a click at (nx, ny) (mirrors its rounding). */
export function previewBox(nx: number, ny: number, r: Rect, sw: number, sh: number, boxPx: number): Rect {
  const [lx, rx] = axisSpan(nx * sw, boxPx, sw)
  const [ly, ry] = axisSpan(ny * sh, boxPx, sh)
  const sx = r.w / sw
  const sy = r.h / sh
  return { x: r.x + lx * sx, y: r.y + ly * sy, w: (rx - lx) * sx, h: (ry - ly) * sy }
}
