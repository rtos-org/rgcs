import { describe, expect, it } from 'vitest'
import type { DraftItem } from './model'
import { elevProfile } from './elevProfile'

const item = (uid: number, lat: number, alt: number, frame: DraftItem['frame'] = 'rel', command = 16): DraftItem => ({ uid, command, frame, params: [0, 0, 0, 0], lat, lon: 138.47829, alt, autocontinue: true })
const draft = (items: DraftItem[]) => ({ mission: { id: null, name: 'm', sysid: null, default_alt: 50, default_frame: 'rel' as const, speed: 8, home: null }, items, nextUid: 99 })

describe('elevProfile', () => {
  it('is null without positioned items', () => {
    expect(elevProfile(draft([{ ...item(1, 0, 0, 'rel', 20), lon: 0 }]) as never, () => 100)).toBeNull()
  })
  it('draws the ground and the flight altitude along the route with one point per item', () => {
    const p = elevProfile(draft([item(1, 35.479883, 50, 'rel', 22), item(2, 35.480883, 50)]) as never, () => 100)!
    expect(p.total).toBeGreaterThan(100)
    expect(p.points.map((q) => [q.uid, q.seq, q.x, Math.round(q.agl), Math.round(q.rel)])).toEqual([
      [1, 1, 0, 50, 50],
      [2, 2, 100, 50, 50],
    ])
    expect(p.groundD.startsWith('M0,100 L0.0,')).toBe(true)
    expect(p.groundD.endsWith('L1000,100 Z')).toBe(true)
    expect(p.pathD.startsWith('M0.0,')).toBe(true)
    expect(p.belowGround).toBe(false)
    expect(p.yMin).toBeLessThan(100)
    expect(p.yMax).toBeGreaterThan(150)
  })
  it('flags a leg that cuts into a ridge (Rel altitude over rising ground)', () => {
    const ridge = (_lon: number, lat: number) => (lat > 35.480183 && lat < 35.480583 ? 300 : 100)
    const p = elevProfile(draft([item(1, 35.479883, 50, 'rel', 22), item(2, 35.480883, 50)]) as never, ridge)!
    expect(p.belowGround).toBe(true)
  })
  it('follows the terrain on Ter legs and uses the home ground when the DEM is missing', () => {
    const p = elevProfile(draft([item(1, 35.479883, 40, 'ter', 22), item(2, 35.480883, 40, 'ter')]) as never, () => null)!
    expect(p.points.map((q) => Math.round(q.agl))).toEqual([40, 40])
    expect(p.hasDem).toBe(false)
  })

  it('places the FENCE_ALT_MAX ceiling (home ground + alt max) on the chart', () => {
    const p = elevProfile(draft([item(1, 35.479883, 50, 'rel', 22), item(2, 35.480883, 50)]) as never, () => 100, 120)!
    expect(p.ceiling).toBe(220)
    expect(p.yMax).toBeGreaterThan(220)
    expect(p.ceilingY).toBeGreaterThan(0)
    expect(p.ceilingY).toBeLessThan(100)
    expect(elevProfile(draft([item(1, 35.479883, 50, 'rel', 22)]) as never, () => 100)!.ceiling).toBeNull()
  })
})
