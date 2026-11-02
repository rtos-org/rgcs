import { describe, expect, it } from 'vitest'
import { MAX_TRACK_POINTS, appendPoint, trimTracks, tracksGeoJson, type Tracks } from './tracks'

const MIN = 60_000
const at = (lon: number, lat = 36, alt = 0, t = 0) => ({ lon, lat, alt, t })

describe('tracks', () => {
  it('appends [lon, lat, alt_rel, t] immutably and ignores sub-metre jitter', () => {
    const t0: Tracks = new Map()
    const t1 = appendPoint(t0, 1, at(138.48029, 35.481883, 30, 1000))
    expect(t0.size).toBe(0)
    expect(t1.get(1)).toEqual([[138.48029, 35.481883, 30, 1000]])
    expect(appendPoint(t1, 1, at(138.480290001, 35.481883001, 30, 2000))).toBe(t1)
    const t3 = appendPoint(t1, 1, at(138.48039, 35.481883, 30, 3000))
    expect(t3.get(1)).toHaveLength(2)
    expect(t1.get(1)).toHaveLength(1)
  })

  it('keeps a vertical climb (altitude counts as movement)', () => {
    const t1 = appendPoint(new Map(), 1, at(139, 36, 10, 0))
    expect(appendPoint(t1, 1, at(139, 36, 15, 1000)).get(1)).toHaveLength(2)
  })

  it('caps each track at MAX_TRACK_POINTS keeping the newest', () => {
    // start from a full track (appending 20 000 points one by one would copy O(n²))
    const full = Array.from({ length: MAX_TRACK_POINTS }, (_, i) => [139 + i * 0.0001, 36, 0, i] as const)
    let t: Tracks = new Map([[1, full]])
    for (let i = MAX_TRACK_POINTS; i <= MAX_TRACK_POINTS + 5; i++) t = appendPoint(t, 1, at(139 + i * 0.0001, 36, 0, i))
    expect(t.get(1)).toHaveLength(MAX_TRACK_POINTS)
    expect(t.get(1)?.at(-1)?.[0]).toBeCloseTo(139 + (MAX_TRACK_POINTS + 5) * 0.0001)
    expect(t.get(1)?.[0]?.[3]).toBe(6) // the six oldest dropped
  })

  it('trims points older than the kept minutes; 0 minutes keeps nothing; unchanged tracks keep identity', () => {
    let t: Tracks = new Map()
    t = appendPoint(t, 1, at(139, 36, 0, 0))
    t = appendPoint(t, 1, at(139.001, 36, 0, 5 * MIN))
    t = appendPoint(t, 2, at(140, 36, 0, 9 * MIN))
    expect(trimTracks(t, 10 * MIN, 10 * MIN)).toBe(t)
    const trimmed = trimTracks(t, 12 * MIN, 10 * MIN)
    expect(trimmed.get(1)).toEqual([[139.001, 36, 0, 5 * MIN]])
    expect(trimmed.get(2)).toHaveLength(1)
    expect(trimTracks(t, 12 * MIN, 0).size).toBe(0)
  })

  it('produces one LineString per vehicle with a selected flag', () => {
    let t: Tracks = new Map()
    t = appendPoint(t, 1, at(139))
    t = appendPoint(t, 1, at(139.001))
    t = appendPoint(t, 2, at(140))
    const fc = tracksGeoJson(t, 1)
    expect(fc.features).toHaveLength(1) // a single point is not a line
    expect(fc.features[0]?.properties).toEqual({ sysid: 1, selected: true })
    expect(fc.features[0]?.geometry).toEqual({ type: 'LineString', coordinates: [[139, 36], [139.001, 36]] })
  })
})
