// The canvas view transform (prototype `netLod`, `netFitView`, `netZoomAt`, `netPan`): screen = world · k + t.
export interface View {
  readonly k: number
  readonly tx: number
  readonly ty: number
}

export type Lod = 'full' | 'compact' | 'site'

export const ZOOM_MIN = 0.06, ZOOM_MAX = 2.5
const FIT_MAX = 1.2, FIT_MARGIN = 0.97

export function lodFor(k: number): Lod {
  return k >= 0.55 ? 'full' : k >= 0.28 ? 'compact' : 'site'
}

export function fitView(cw: number, ch: number, W: number, H: number): View {
  const k = Math.min(FIT_MAX, cw / W, ch / H) * FIT_MARGIN
  return { k, tx: (cw - W * k) / 2, ty: Math.max(4, (ch - H * k) * 0.2) }
}

/** Zoom by `f` about the screen point (px, py), clamped to 6–250 %. */
export function zoomAt(v: View, f: number, px: number, py: number): View {
  const k = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, v.k * f))
  const r = k / v.k
  return { k, tx: px - (px - v.tx) * r, ty: py - (py - v.ty) * r }
}

export function panBy(v: View, dx: number, dy: number): View {
  return { k: v.k, tx: v.tx + dx, ty: v.ty + dy }
}
