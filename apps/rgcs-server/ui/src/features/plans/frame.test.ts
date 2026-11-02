import { describe, expect, it } from 'vitest'
import { appendWaypoint, emptyDraft } from '../mission/model'
import { framePoints } from './frame'

describe('framePoints', () => {
  it('frames_the_route_fence_and_rally_but_not_the_home', () => {
    const base = appendWaypoint(emptyDraft(), 36.1, 139.1)
    const d = {
      ...base,
      mission: {
        ...base.mission,
        home: { lat: 35, lon: 138, alt: 0 },
        fence: [{ kind: 'polygon' as const, inclusion: true, vertices: [{ lat: 36.2, lon: 139.2 }, { lat: 36.3, lon: 139.2 }, { lat: 36.3, lon: 139.3 }] }],
        rally: [{ lat: 36.4, lon: 139.4, alt: 50 }],
      },
    }
    const pts = framePoints(d)
    expect(pts.map((p) => p.lat)).toEqual([36.1, 36.2, 36.3, 36.3, 36.4])
    expect(pts.every((p) => Object.keys(p).sort().join() === 'lat,lon')).toBe(true)
  })
})
