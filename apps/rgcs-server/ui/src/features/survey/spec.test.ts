import { describe, expect, it } from 'vitest'
import { ALPHA7R4, defaultSpec, surveySpecSchema } from './spec'

const M_LAT = 1 / 111_194.9
const rect = [
  { lat: 35, lon: 139 },
  { lat: 35, lon: 139 + 300 * M_LAT / Math.cos((35 * Math.PI) / 180) },
  { lat: 35 + 100 * M_LAT, lon: 139 + 300 * M_LAT / Math.cos((35 * Math.PI) / 180) },
  { lat: 35 + 100 * M_LAT, lon: 139 },
]

describe('defaultSpec', () => {
  it('uses the documented defaults', () => {
    const s = defaultSpec(rect, ALPHA7R4, 'plane')
    expect(s).toMatchObject({ version: 1, altM: 100, frontPct: 80, sidePct: 70, start: 'home', speedMs: 18, windMs: 0, skip: 0, turn: 'split', bankDeg: 30, leadInM: null, overshootM: null, marginM: null, airframe: 'plane', wpRadiusM: 90 })
    expect(defaultSpec(rect, ALPHA7R4, 'copter').speedMs).toBe(8)
  })
  it('takes options', () => {
    expect(defaultSpec(rect, ALPHA7R4, 'plane', { bankDeg: 40, wpRadiusM: 50, speedMs: 22 })).toMatchObject({ bankDeg: 40, wpRadiusM: 50, speedMs: 22 })
  })
  it('angle follows the longest edge (east-west -> 90)', () => {
    expect(defaultSpec(rect, ALPHA7R4, 'plane').angleDeg).toBeCloseTo(90, 1)
  })
})

describe('surveySpecSchema', () => {
  const ok = defaultSpec(rect, ALPHA7R4, 'plane')
  it('accepts a default spec', () => expect(surveySpecSchema.safeParse(ok).success).toBe(true))
  it.each([
    ['front 100', { frontPct: 100 }],
    ['skip -1', { skip: -1 }],
    ['skip 1.5', { skip: 1.5 }],
    ['skip 11', { skip: 11 }],
    ['bank 4', { bankDeg: 4 }],
    ['bank 61', { bankDeg: 61 }],
    ['alt 4', { altM: 4 }],
    ['alt 1001', { altM: 1001 }],
    ['side 96', { sidePct: 96 }],
    ['polygon without lat', { polygon: [{ lon: 1 }] }],
    ['polygon of 10 001 vertices', { polygon: Array.from({ length: 10_001 }, (_, i) => ({ lat: 35, lon: 139 + i * 1e-6 })) }],
  ])('rejects %s', (_n, patch) => expect(surveySpecSchema.safeParse({ ...ok, ...patch }).success).toBe(false))
})
