import { describe, expect, it } from 'vitest'
import { dist, polar, type Xy } from './geom'
import { captureLoiter, trackLine } from './l1'

const l1 = { period: 14, damping: 0.75, rollLimitDeg: 65 }
const heading = (deg: number): Xy => ({ x: Math.sin(deg * (Math.PI / 180)), y: Math.cos(deg * (Math.PI / 180)) })

describe('L1 loiter capture (AP_L1_Control::update_loiter)', () => {
  it('ends on the circle, travelling the loiter way round', () => {
    const c = { x: 0, y: 0 }
    const { pts, phi } = captureLoiter({ x: -400, y: 0 }, heading(0), c, 80, true, 27, l1)
    const end = pts.at(-1)!
    expect(Math.abs(dist(end, c) - 80)).toBeLessThan(3)
    expect(phi).toBeCloseTo(polar(c, end))
    // clockwise: the last step moves the polar angle downwards
    const before = pts.at(-2)!
    expect(Math.sin(polar(c, end) - polar(c, before))).toBeLessThan(0)
  })

  it('swings wide like the SITL QuadPlane (2026-10-20): from heading 320° the centre lies 105° off to the right', () => {
    // track sampled at 1 Hz: after leaving the leg at (-88, 363) the plane went as far north as 438 m
    const { pts } = captureLoiter({ x: -88, y: 363 }, heading(-40), { x: 31, y: 332 }, 74, true, 27, l1)
    const north = Math.max(...pts.map((p) => p.y))
    expect(north).toBeGreaterThan(420)
    expect(north).toBeLessThan(455)
  })

  it('starting on the circle there is nothing to capture', () => {
    const { pts } = captureLoiter({ x: 80, y: 0 }, heading(180), { x: 0, y: 0 }, 80, true, 27, l1)
    expect(pts.length).toBeLessThanOrEqual(2)
  })
})

describe('L1 line following (AP_L1_Control::update_waypoint)', () => {
  const a = { x: 0, y: 0 }
  const south = { x: 0, y: -2000 }
  const xtrack = (p: Xy) => Math.abs(p.x)

  it('on the line and heading along it there is nothing to fly', () => {
    expect(trackLine({ x: 0, y: -100 }, heading(180), a, south, 27, l1, 90).length).toBeLessThanOrEqual(2)
  })

  it('reversing onto the next leg (WP8 in the SITL flight) swings past the waypoint and comes back onto the line', () => {
    // accepted 91 m before the waypoint, flying on at 27 m/s, the next leg runs back the way it came
    const pts = trackLine({ x: 8, y: -91 }, heading(4), a, south, 27, l1, 90)
    const end = pts.at(-1)!
    expect(xtrack(end)).toBeLessThan(1.5)
    expect(end.y).toBeLessThan(-91)
    expect(Math.max(...pts.map((p) => p.y))).toBeGreaterThan(-60)
    const wide = Math.max(...pts.map(xtrack))
    expect(wide).toBeGreaterThan(40)
    expect(wide).toBeLessThan(200)
  })

  it('captures a parallel offset line at no more than 45° and ends on it', () => {
    const pts = trackLine({ x: 300, y: 0 }, heading(180), a, south, 27, l1, 90)
    expect(xtrack(pts.at(-1)!)).toBeLessThan(1.5)
    // 45° capture: crossing 300 m sideways takes at least ~300 m along the line
    expect(pts.at(-1)!.y).toBeLessThan(-300)
  })

  it('stops at the acceptance distance of the leg end on a short leg', () => {
    const end = { x: 0, y: -400 }
    const pts = trackLine({ x: 8, y: -91 }, heading(4), a, end, 27, l1, 90)
    expect(dist(pts.at(-1)!, end)).toBeLessThanOrEqual(90)
    expect(dist(pts.at(-1)!, end)).toBeGreaterThan(80)
  })
})
