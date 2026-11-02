// Low-poly vehicle models built in code (user choice 2026-10-20: no model files, light on a Pi).
// Model units: about 1 long, +x right, +y forward (the nose), +z up. Vertices are interleaved
// position(3) normal(3) colour(3); a colour of -1 means "the vehicle's accent" (set per draw).
import type { VehicleKind } from '../../../shared/api/types'

export const FLOATS = 9
type V3 = readonly [number, number, number]
interface Tri {
  readonly p: readonly [V3, V3, V3]
  readonly n: V3
  readonly c: V3
}

const BODY: V3 = [0.2, 0.23, 0.27]
const DARK: V3 = [0.1, 0.11, 0.13]
const LIGHT: V3 = [0.86, 0.89, 0.92]
const ACCENT: V3 = [-1, -1, -1]

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const unit = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}
const tri = (a: V3, b: V3, c: V3, col: V3): Tri => ({ p: [a, b, c], n: unit(cross(sub(b, a), sub(c, a))), c: col })
const quad = (a: V3, b: V3, c: V3, d: V3, col: V3): Tri[] => [tri(a, b, c, col), tri(a, c, d, col)]

/** Axis-aligned box centred at `c` with sizes `s`. */
function box(c: V3, s: V3, col: V3): Tri[] {
  const [x0, y0, z0] = [c[0] - s[0] / 2, c[1] - s[1] / 2, c[2] - s[2] / 2]
  const [x1, y1, z1] = [c[0] + s[0] / 2, c[1] + s[1] / 2, c[2] + s[2] / 2]
  const P = (x: number, y: number, z: number): V3 => [x, y, z]
  return [
    ...quad(P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1), col), // top
    ...quad(P(x0, y0, z0), P(x0, y1, z0), P(x1, y1, z0), P(x1, y0, z0), col), // bottom
    ...quad(P(x0, y1, z0), P(x0, y1, z1), P(x1, y1, z1), P(x1, y1, z0), col), // front
    ...quad(P(x0, y0, z0), P(x1, y0, z0), P(x1, y0, z1), P(x0, y0, z1), col), // back
    ...quad(P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1), P(x1, y0, z1), col), // right
    ...quad(P(x0, y0, z0), P(x0, y0, z1), P(x0, y1, z1), P(x0, y1, z0), col), // left
  ]
}

/** Cylinder along z centred at `c` (radius `r`, height `h`, `n` sides). */
function cylinder(c: V3, r: number, h: number, col: V3, n = 14): Tri[] {
  const out: Tri[] = []
  const z0 = c[2] - h / 2
  const z1 = c[2] + h / 2
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 2 * Math.PI
    const b = ((i + 1) / n) * 2 * Math.PI
    const pa = (z: number): V3 => [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a), z]
    const pb = (z: number): V3 => [c[0] + r * Math.cos(b), c[1] + r * Math.sin(b), z]
    out.push(...quad(pa(z0), pb(z0), pb(z1), pa(z1), col))
    out.push(tri([c[0], c[1], z1], pa(z1), pb(z1), col), tri([c[0], c[1], z0], pb(z0), pa(z0), col))
  }
  return out
}

type Rot = (v: V3) => V3
const rotZ = (deg: number): Rot => {
  const [s, k] = [Math.sin((deg * Math.PI) / 180), Math.cos((deg * Math.PI) / 180)]
  return (v) => [v[0] * k - v[1] * s, v[0] * s + v[1] * k, v[2]]
}
/** Turns a z-axis cylinder onto the x axis (wheels). */
const zToX: Rot = (v) => [v[2], v[1], -v[0]]
/** Turns a z-axis cylinder onto the y axis (propellers facing forward). */
const zToY: Rot = (v) => [v[0], v[2], -v[1]]
const turn = (tris: readonly Tri[], r: Rot, at: V3 = [0, 0, 0]): Tri[] =>
  tris.map((t) => {
    const p = t.p.map((v) => {
      const q = r(v)
      return [q[0] + at[0], q[1] + at[1], q[2] + at[2]] as V3
    }) as unknown as [V3, V3, V3]
    return { p, n: unit(r(t.n)), c: t.c }
  })

function copter(): Tri[] {
  const arm = (deg: number) => turn(box([0, 0.3, 0], [0.06, 0.5, 0.04], DARK), rotZ(deg))
  const rotor = (deg: number) => {
    const end = rotZ(deg)([0, 0.5, 0.05])
    return [...cylinder(end, 0.03, 0.08, DARK, 8), ...cylinder([end[0], end[1], 0.1], 0.2, 0.012, ACCENT)]
  }
  const corners = [45, -45, 135, -135]
  return [
    ...box([0, 0, 0], [0.3, 0.34, 0.12], BODY),
    ...box([0, 0.19, 0.01], [0.12, 0.05, 0.06], ACCENT), // the front, so the heading reads
    ...corners.flatMap(arm),
    ...corners.flatMap(rotor),
    ...box([0.1, 0, -0.1], [0.02, 0.3, 0.02], DARK),
    ...box([-0.1, 0, -0.1], [0.02, 0.3, 0.02], DARK),
  ]
}

/** Fuselage, wing and tail shared by both planes. */
function airframe(): Tri[] {
  return [
    ...box([0, 0, 0], [0.11, 0.78, 0.11], LIGHT), // fuselage
    ...turn(box([0, 0, 0], [0.11, 0.11, 0.08], LIGHT), (v) => [v[0] * 0.7, v[1], v[2] * 0.8], [0, 0.44, -0.005]), // nose
    ...box([0, 0.08, 0.03], [1.2, 0.18, 0.025], ACCENT), // wing
    ...box([0, -0.38, 0.02], [0.42, 0.11, 0.02], ACCENT), // tailplane
    ...box([0, -0.39, 0.11], [0.02, 0.12, 0.17], LIGHT), // fin
  ]
}

/** A propeller disc facing forward (spinning about y) at `y`. */
const propeller = (y: number, r: number): Tri[] => [...turn(cylinder([0, 0, 0], r, 0.012, DARK, 12), zToY, [0, y, 0]), ...box([0, y, 0], [0.04, 0.03, 0.04], DARK)]

/** A plain fixed wing: tractor propeller ahead of the nose. */
function plane(): Tri[] {
  return [...airframe(), ...propeller(0.52, 0.15)]
}

/** A QuadPlane: two booms carrying four lift rotors, and a pusher propeller behind the tail. */
function quadplane(): Tri[] {
  const boom = (x: number) => [...box([x, 0.08, 0.0], [0.03, 0.62, 0.03], DARK), ...cylinder([x, 0.36, 0.035], 0.12, 0.01, ACCENT, 10), ...cylinder([x, -0.2, 0.035], 0.12, 0.01, ACCENT, 10)]
  return [...airframe(), ...[-0.32, 0.32].flatMap(boom), ...box([0, -0.43, 0], [0.04, 0.06, 0.04], DARK), ...propeller(-0.47, 0.11)]
}

function rover(): Tri[] {
  const wheel = (x: number, y: number) => turn(cylinder([0, 0, 0], 0.11, 0.08, DARK, 12), zToX, [x, y, 0.11])
  return [
    ...box([0, 0, 0.2], [0.44, 0.8, 0.16], BODY),
    ...box([0, -0.05, 0.32], [0.34, 0.4, 0.1], ACCENT),
    ...box([0, 0.38, 0.22], [0.3, 0.05, 0.06], LIGHT),
    ...[-0.27, 0.27].flatMap((x) => [...wheel(x, 0.27), ...wheel(x, -0.27)]),
  ]
}

function pack(tris: readonly Tri[]): Float32Array {
  const out = new Float32Array(tris.length * 3 * FLOATS)
  let o = 0
  for (const t of tris) {
    for (const v of t.p) {
      out.set([...v, ...t.n, ...t.c], o)
      o += FLOATS
    }
  }
  return out
}

/** One model per airframe. */
export type ModelKey = 'copter' | 'quadplane' | 'plane' | 'rover'

/** The model for a vehicle: a plane that hovers is a QuadPlane; 'other' flies as a multicopter, like its icon. */
export function modelFor(kind: VehicleKind, vtol: boolean): ModelKey {
  if (kind === 'plane') return vtol ? 'quadplane' : 'plane'
  return kind === 'rover' ? 'rover' : 'copter'
}

const BUILD: Readonly<Record<ModelKey, () => Tri[]>> = { copter, quadplane, plane, rover }
const cache = new Map<ModelKey, Float32Array>()

export function meshFor(key: ModelKey): Float32Array {
  const hit = cache.get(key)
  if (hit) return hit
  const mesh = pack(BUILD[key]())
  cache.set(key, mesh)
  return mesh
}
