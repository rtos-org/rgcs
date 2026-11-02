import { describe, expect, it, vi } from 'vitest'
import { toMercator } from './air'
import { floatMarkers, floatOffset, pixelsPerMetre, projectToScreen, sameMatrix } from './float'

// Column-major 4x4: x' = x, y' = y, z' = 0, w = 1 — plus z lifts y by one clip unit per mercator unit.
const M = [1, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1]
const SIZE = { w: 200, h: 100 }

describe('projectToScreen', () => {
  it('maps clip space to CSS pixels with y down', () => {
    expect(projectToScreen(M, SIZE, { x: 0, y: 0, z: 0 })).toEqual({ x: 100, y: 50 })
    expect(projectToScreen(M, SIZE, { x: 1, y: 1, z: 0 })).toEqual({ x: 200, y: 0 })
  })
  it('is null behind the camera', () => {
    const behind = [...M.slice(0, 15), -1]
    expect(projectToScreen(behind, SIZE, { x: 0, y: 0, z: 0 })).toBeNull()
  })
})

describe('floatOffset', () => {
  it('is the screen delta from the ground point to the altitude point', () => {
    expect(floatOffset(M, SIZE, { x: 0, y: 0, z: 0.5 }, { x: 100, y: 50 })).toEqual([0, -25])
  })
  it('is zero when the point cannot be projected', () => {
    expect(floatOffset([...M.slice(0, 15), -1], SIZE, { x: 0, y: 0, z: 0.5 }, { x: 100, y: 50 })).toEqual([0, 0])
  })
})

describe('pixelsPerMetre', () => {
  it('is how far one metre of altitude moves the point up the screen', () => {
    // M lifts y by one clip unit per mercator unit: half the height (50 px) per unit
    expect(pixelsPerMetre(M, SIZE, 139, 36, 1000)).toBeCloseTo(50 * toMercator(139, 36, 1).z, 12)
  })
  it('is null behind the camera', () => {
    expect(pixelsPerMetre([...M.slice(0, 15), -1], SIZE, 139, 36, 1000)).toBeNull()
  })
})

describe('floatMarkers', () => {
  it('moves a marker only when its float offset changes (each setOffset makes MapLibre re-test terrain occlusion with readPixels)', () => {
    let offset: [number, number] = [0, 0]
    let sets = 0
    const marker = {
      getOffset: () => ({ x: offset[0], y: offset[1] }),
      setOffset: (o: [number, number]) => {
        offset = o
        sets++
        return marker
      },
    }
    const map = { getContainer: () => ({ clientWidth: 200, clientHeight: 100 }), project: () => ({ x: 100, y: 50 }) }
    const entry = { marker, lon: 0, lat: 0, amsl: 1_000_000, base: [0, 0] as const }
    floatMarkers(map as never, M, [entry as never])
    floatMarkers(map as never, M, [entry as never])
    floatMarkers(map as never, M, [entry as never])
    expect(sets).toBe(1)
    floatMarkers(map as never, null, [entry as never])
    expect(offset).toEqual([0, 0])
    expect(sets).toBe(2)
  })
})

describe('floatMarkers with a known ground', () => {
  it('projects the ground with the frame matrix instead of asking the map (a terrain lookup per call)', () => {
    let offset: [number, number] = [0, 0]
    const marker = { setOffset: (o: [number, number]) => ((offset = o), marker) }
    const project = vi.fn(() => ({ x: 100, y: 50 }))
    const map = { getContainer: () => ({ clientWidth: 200, clientHeight: 100 }), project }
    const ground = toMercator(0, 0, 0).z
    floatMarkers(map as never, M, [{ marker, lon: 0, lat: 0, amsl: 1_000_000, base: [0, 0], ground: 0 } as never])
    expect(project).not.toHaveBeenCalled()
    expect(offset[1]).toBeCloseTo(-50 * (toMercator(0, 0, 1_000_000).z - ground), 6)
  })
  it('sameMatrix compares values', () => {
    expect(sameMatrix(M, [...M])).toBe(true)
    expect(sameMatrix(M, [...M.slice(0, 15), 2])).toBe(false)
    expect(sameMatrix(null, M)).toBe(false)
  })
})
