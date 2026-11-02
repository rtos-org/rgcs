import { describe, expect, it } from 'vitest'
import { FLOATS, meshFor, modelFor, type ModelKey } from './meshes'

const bounds = (data: Float32Array) => {
  const lo = [Infinity, Infinity, Infinity]
  const hi = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < data.length; i += FLOATS) for (let k = 0; k < 3; k++) (lo[k] = Math.min(lo[k]!, data[i + k]!)), (hi[k] = Math.max(hi[k]!, data[i + k]!))
  return { lo, hi }
}

describe('low-poly vehicle meshes (model units: +y forward, +z up, about 1 long)', () => {
  it('every kind is whole triangles with unit normals', () => {
    for (const key of ['copter', 'quadplane', 'plane', 'rover'] as const) {
      const m = meshFor(key)
      expect(m.length % (FLOATS * 3)).toBe(0)
      expect(m.length).toBeGreaterThan(FLOATS * 36)
      for (let i = 0; i < m.length; i += FLOATS) expect(Math.hypot(m[i + 3]!, m[i + 4]!, m[i + 5]!)).toBeCloseTo(1, 5)
    }
  })

  it('both planes are longer than tall and their wings span across (x), nose forward (+y)', () => {
    for (const key of ['plane', 'quadplane'] as const) {
      const { lo, hi } = bounds(meshFor(key))
      expect(hi[0]! - lo[0]!).toBeGreaterThan(0.9)
      expect(hi[1]! - lo[1]!).toBeGreaterThan(0.6)
      expect(hi[2]! - lo[2]!).toBeLessThan(0.4)
      expect(hi[1]!).toBeGreaterThan(-lo[1]! * 0.8)
    }
  })

  // Lift rotors sit on booms beside the fuselage, ahead of the wing: nothing of a plain plane is there.
  const besideNose = (data: Float32Array) => {
    let n = 0
    for (let i = 0; i < data.length; i += FLOATS) if (Math.abs(data[i]!) > 0.2 && data[i + 1]! > 0.25) n++
    return n
  }

  it('the QuadPlane has lift rotors on booms and a pusher behind the tail; the plain plane has neither', () => {
    expect(besideNose(meshFor('quadplane'))).toBeGreaterThan(0)
    expect(besideNose(meshFor('plane'))).toBe(0)
    expect(bounds(meshFor('quadplane')).lo[1]!).toBeLessThan(bounds(meshFor('plane')).lo[1]! - 0.02)
  })

  it('the plain plane pulls with a propeller ahead of its nose', () => {
    expect(bounds(meshFor('plane')).hi[1]!).toBeGreaterThan(bounds(meshFor('quadplane')).hi[1]! + 0.02)
  })

  it('modelFor picks the model from the kind and the VTOL flag', () => {
    const cases: [Parameters<typeof modelFor>[0], boolean, ModelKey][] = [
      ['plane', true, 'quadplane'], ['plane', false, 'plane'], ['copter', false, 'copter'], ['rover', true, 'rover'], ['other', false, 'copter'],
    ]
    for (const [kind, vtol, key] of cases) expect(modelFor(kind, vtol)).toBe(key)
  })

  it('the copter is square in plan; the rover sits on the ground (z ≥ 0)', () => {
    const c = bounds(meshFor('copter'))
    expect(c.hi[0]! - c.lo[0]!).toBeCloseTo(c.hi[1]! - c.lo[1]!, 1)
    expect(bounds(meshFor('rover')).lo[2]!).toBeGreaterThanOrEqual(-1e-6)
  })
})
