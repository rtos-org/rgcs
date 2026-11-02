import { describe, expect, it } from 'vitest'
import type { FenceZone, RallyPoint } from '../../shared/api/types'
import { fencePoints, fenceToWpl, parseFenceFile, parseRallyFile, rallyToWpl } from './planFiles'

const zones: FenceZone[] = [
  { kind: 'polygon', inclusion: true, vertices: [{ lat: 36.25, lon: 137.63 }, { lat: 36.26, lon: 137.63 }, { lat: 36.26, lon: 137.65 }] },
  { kind: 'polygon', inclusion: true, vertices: [{ lat: 36.3, lon: 137.7 }, { lat: 36.31, lon: 137.7 }, { lat: 36.31, lon: 137.71 }] },
  { kind: 'circle', inclusion: false, center: { lat: 36.255, lon: 137.64 }, radius: 80 },
]
const rally: RallyPoint[] = [{ lat: 36.251, lon: 137.639, alt: 40 }]

describe('fence / rally files', () => {
  const home = { lat: 36.2509, lon: 137.6385, alt: 1505 }
  it('writes the fence as Mission Planner does: QGC WPL 110, the home row first (MP drops line 0 of a fence file), MAV_CMD_NAV_FENCE_* with the vertex count in param1', () => {
    const text = fenceToWpl(zones, home)
    const lines = text.trim().split(/\r?\n/)
    expect(lines[0]).toBe('QGC WPL 110')
    expect(lines[1]!.split('\t')).toEqual(['0', '1', '0', '16', '0', '0', '0', '0', '36.2509000', '137.6385000', '1505.000000', '1'])
    expect(fenceToWpl(zones, null).split(/\r?\n/)[1]).toBe('0\t1\t0\t0\t0\t0\t0\t0\t0\t0\t0\t1')
    const cols = lines.slice(2).map((l) => l.split('\t'))
    expect(cols.map((c) => c[0])).toEqual(['1', '2', '3', '4', '5', '6', '7'])
    expect(cols.map((c) => c[3])).toEqual(['5001', '5001', '5001', '5001', '5001', '5001', '5004'])
    expect(cols.map((c) => Number(c[4]))).toEqual([3, 3, 3, 3, 3, 3, 80])
    expect(cols[0]![8]).toBe('36.25000000')
  })

  it('reads its own fence back, keeping two adjacent polygons of the same kind apart', () => {
    expect(parseFenceFile(fenceToWpl(zones, home))).toEqual(zones)
  })

  it('writes and reads rally points (MAV_CMD_NAV_RALLY_POINT, altitude relative to home)', () => {
    const text = rallyToWpl(rally, home)
    expect(text.split(/\r?\n/)[2]!.split('\t').slice(0, 4)).toEqual(['1', '0', '3', '5100'])
    expect(parseRallyFile(text)).toEqual(rally)
  })

  it('reads a QGroundControl .plan (geoFence polygons / circles, rallyPoints)', () => {
    const plan = JSON.stringify({
      fileType: 'Plan',
      geoFence: { version: 2, polygons: [{ inclusion: false, version: 1, polygon: [[36.1, 137.1], [36.2, 137.1], [36.2, 137.2]] }], circles: [{ inclusion: true, version: 1, circle: { center: [35.469883, 137.15], radius: 500 } }] },
      rallyPoints: { version: 2, points: [[36.12, 137.12, 30]] },
    })
    expect(parseFenceFile(plan)).toEqual([
      { kind: 'polygon', inclusion: false, vertices: [{ lat: 36.1, lon: 137.1 }, { lat: 36.2, lon: 137.1 }, { lat: 36.2, lon: 137.2 }] },
      { kind: 'circle', inclusion: true, center: { lat: 35.469883, lon: 137.15 }, radius: 500 },
    ])
    expect(parseRallyFile(plan)).toEqual([{ lat: 36.12, lon: 137.12, alt: 30 }])
  })

  it('rejects files that are neither, and coordinates out of range', () => {
    expect(() => parseFenceFile('hello')).toThrow()
    expect(() => parseRallyFile('QGC WPL 110\n0\t0\t3\t5100\t0\t0\t0\t0\t95\t137\t30\t1\n')).toThrow()
    // a mission file has no fence items: nothing to load
    expect(() => parseFenceFile('QGC WPL 110\n0\t1\t0\t16\t0\t0\t0\t0\t36\t137\t0\t1\n')).toThrow()
  })

  it("reads Mission Planner's older fence (.fen: return point, then the closed polygon) and rally (.ral) files", () => {
    const fen = '#saved by Mission Planner 1.3.80\n36.2509 137.6385\n36.249 137.636\n36.256 137.636\n36.256 137.642\n36.249 137.636\n'
    expect(parseFenceFile(fen)).toEqual([{ kind: 'polygon', inclusion: true, vertices: [{ lat: 36.249, lon: 137.636 }, { lat: 36.256, lon: 137.636 }, { lat: 36.256, lon: 137.642 }] }])
    const ral = '#saved by Mission Planner 1.3.80\nRALLY\t36.251\t137.639\t40\t0\t0\t0\n'
    expect(parseRallyFile(ral)).toEqual([{ lat: 36.251, lon: 137.639, alt: 40 }])
  })

  it('the points to frame a fence: polygon vertices and each circle\'s extent', () => {
    const pts = fencePoints([zones[2]!])
    expect(pts).toHaveLength(2)
    // 80 m north / south of the centre
    expect(pts[1]!.lat - pts[0]!.lat).toBeCloseTo((160 / 6_371_000) * (180 / Math.PI), 9)
    expect(fencePoints([zones[0]!])).toEqual(zones[0]!.kind === 'polygon' ? zones[0]!.vertices : [])
  })
})
