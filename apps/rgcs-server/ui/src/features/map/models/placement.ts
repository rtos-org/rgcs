// Where a vehicle model sits in MapLibre's mercator world: column-major model matrices in float64
// (the layer multiplies them with the frame matrix before handing float32 to the GPU).
import { toMercator } from '../air'

export interface ModelAt {
  readonly lon: number
  readonly lat: number
  /** Metres above mean sea level (as the 3D layer draws the vehicle). */
  readonly amsl: number
}

type V3 = readonly [number, number, number]

/** The model's axes in (east, north, up) after roll, then pitch, then the heading turn. */
export function bodyBasis(hdgDeg: number, rollDeg: number, pitchDeg: number): { right: V3; nose: V3; up: V3 } {
  const r = (rollDeg * Math.PI) / 180
  const p = (pitchDeg * Math.PI) / 180
  const h = (hdgDeg * Math.PI) / 180
  // roll about the nose (right wing down +), pitch about the right axis (nose up +)
  const roll = (v: V3): V3 => [v[0] * Math.cos(r) + v[2] * Math.sin(r), v[1], -v[0] * Math.sin(r) + v[2] * Math.cos(r)]
  const pitch = (v: V3): V3 => [v[0], v[1] * Math.cos(p) - v[2] * Math.sin(p), v[1] * Math.sin(p) + v[2] * Math.cos(p)]
  // heading: clockwise from north, so the nose (0, 1) goes to (sin h, cos h)
  const turn = (v: V3): V3 => [v[0] * Math.cos(h) + v[1] * Math.sin(h), -v[0] * Math.sin(h) + v[1] * Math.cos(h), v[2]]
  const body = (v: V3) => turn(pitch(roll(v)))
  return { right: body([1, 0, 0]), nose: body([0, 1, 0]), up: body([0, 0, 1]) }
}

/**
 * Model units → mercator: +x right, +y nose, +z up, each `size` mercator units long, turned to
 * `hdgDeg` (clockwise from north) and tilted by `att`. Mercator y grows southwards (north is −y).
 */
export function modelMatrix(at: ModelAt, hdgDeg: number, size: number, att: { readonly roll: number; readonly pitch: number } | null = null): Float64Array {
  const o = toMercator(at.lon, at.lat, at.amsl)
  const b = bodyBasis(hdgDeg, att?.roll ?? 0, att?.pitch ?? 0)
  const col = (v: V3) => [v[0] * size, -v[1] * size, v[2] * size, 0]
  return Float64Array.from([...col(b.right), ...col(b.nose), ...col(b.up), o.x, o.y, o.z, 1])
}

/** A model `px` pixels long at `zoom` (MapLibre's 512 px tiles), but never smaller than `realMerc`. */
export function screenSizeMerc(px: number, zoom: number, realMerc: number): number {
  return Math.max(px / (512 * 2 ** zoom), realMerc)
}

/** a · b for column-major 4×4 matrices. */
export function mul4(a: ArrayLike<number>, b: ArrayLike<number>): Float64Array {
  const out = new Float64Array(16)
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let sum = 0
    for (let k = 0; k < 4; k++) sum += a[k * 4 + r]! * b[c * 4 + k]!
    out[c * 4 + r] = sum
  }
  return out
}
