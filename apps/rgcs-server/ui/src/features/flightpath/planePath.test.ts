import { describe, expect, it } from 'vitest'
import type { Home, MissionItem } from '../../shared/api/types'
import { toLatLon, toXy, type Xy } from './geom'
import { PLANE_DEFAULTS, type PlaneParams } from './params'
import { predictPlane, predictPlaneParts } from './planePath'
import { eas2tas } from './track'

const home: Home = { lat: 36.25, lon: 137.6, alt: 1500 }
const at = (xy: Xy) => toLatLon(home, xy)
const item = (command: number, xy: Xy | null, alt: number, params: [number, number, number, number] = [0, 0, 0, 0]): MissionItem => {
  const p = xy ? at(xy) : { lat: 0, lon: 0 }
  return { command, frame: 'rel', params, lat: p.lat, lon: p.lon, alt, autocontinue: true }
}
const qp: PlaneParams = { ...PLANE_DEFAULTS, quadplane: true }
const local = (items: MissionItem[], p: PlaneParams = qp) => predictPlane(items, home, p).map((pt) => ({ ...toXy(home, pt), alt: pt.alt }))
const r = (pt: Xy, c: Xy) => Math.hypot(pt.x - c.x, pt.y - c.y)

describe('predicted ArduPlane / QuadPlane path (AUTO)', () => {
  it('a QuadPlane NAV_TAKEOFF climbs straight up (VTOL takeoff unless Q_OPTIONS allows a fixed-wing one)', () => {
    const path = local([item(22, null, 40)])
    expect(path[0]).toMatchObject({ alt: 0 })
    // the climb is one vertical piece; the RTL at the mission end follows
    expect(r(path[1]!, { x: 0, y: 0 })).toBeLessThan(0.01)
    expect(path[1]!.alt).toBeCloseTo(40)
  })

  it('a plain plane takes off along the way to the next waypoint at its climb rate', () => {
    const path = local([item(22, null, 40), item(16, { x: 0, y: 1000 }, 40)], PLANE_DEFAULTS)
    const climbed = path.find((pt) => pt.alt >= 40 - 1e-6)!
    // TECS_CLMB_MAX 5 m/s at AIRSPEED_CRUISE 12 m/s: 40 m of height takes 96 m of ground
    // 96 m of ground at sea-level density; at 1500 m the true airspeed (and the run) is longer
    expect(climbed.y).toBeGreaterThan(96)
    expect(climbed.y).toBeLessThan(96 * eas2tas(1540))
    expect(Math.abs(climbed.x)).toBeLessThan(0.01)
  })

  it('LOITER_TO_ALT spirals on the circle at the climb rate until within 5 m, then leaves toward the next waypoint', () => {
    // a short approach: the leg's altitude slope (ALT_SLOPE_MIN) cannot climb 200 m before the circle
    const c = { x: 0, y: 250 }
    const path = local([item(22, null, 50), item(31, c, 250, [0, 80, 0, 0]), item(16, { x: 0, y: 1500 }, 250)])
    const radius = 80 * eas2tas(1500 + 250) ** 2
    const onCircle = path.filter((pt) => Math.abs(r(pt, c) - radius) < 0.5)
    expect(onCircle.length).toBeGreaterThan(36)
    for (let i = 1; i < path.length; i++) {
      const ds = r(path[i]!, path[i - 1]!)
      // TECS_CLMB_MAX over the true airspeed: never steeper than 5 m/s at 12 m/s EAS
      if (ds > 0) expect(path[i]!.alt - path[i - 1]!.alt).toBeLessThanOrEqual((5 / 12) * ds + 1e-6)
    }
    expect(onCircle.at(-1)!.alt).toBeGreaterThanOrEqual(245)
    expect(onCircle[0]!.alt).toBeLessThan(200)
    // on to the waypoint, accepted turn-distance out (the RTL at the mission end follows)
    expect(Math.min(...path.map((pt) => r(pt, { x: 0, y: 1500 })))).toBeLessThan(100)
  })

  it('a negative radius loiters counter-clockwise, a positive one clockwise', () => {
    const turn = (radius: number) => {
      const c = { x: 0, y: 600 }
      const flown = Math.abs(radius) * eas2tas(1600) ** 2
      const path = local([item(22, null, 100), item(18, c, 100, [2, 0, radius, 0])]).filter((pt) => Math.abs(r(pt, c) - flown) < 0.5)
      const cross = path.slice(1).reduce((s, pt, i) => s + ((path[i]!.x - c.x) * (pt.y - c.y) - (path[i]!.y - c.y) * (pt.x - c.x)), 0)
      return Math.sign(cross)
    }
    expect(turn(-70)).toBe(1)
    expect(turn(70)).toBe(-1)
  })

  it('LOITER_TIME always uses WP_LOITER_RAD (param3 only gives the direction)', () => {
    const c = { x: 0, y: 600 }
    const path = local([item(22, null, 100), item(19, c, 100, [30, 0, 200, 0])])
    // L1 flies R·EAS2TAS² (AP_L1_Control::loiter_radius): thinner air at 1600 m widens the circle
    const want = 60 * eas2tas(1600) ** 2
    expect(path.filter((pt) => Math.abs(r(pt, c) - want) < 0.5).length).toBeGreaterThan(20)
    expect(path.some((pt) => Math.abs(r(pt, c) - 200 * eas2tas(1600) ** 2) < 0.5)).toBe(false)
  })

  it('a fixed wing cuts the corner of a waypoint it turns at', () => {
    const corner = { x: 0, y: 800 }
    const path = local([item(22, null, 100), item(16, corner, 100), item(16, { x: 800, y: 800 }, 100)])
    const closest = Math.min(...path.map((pt) => r(pt, corner)))
    expect(closest).toBeGreaterThan(3)
    expect(closest).toBeLessThan(30)
  })

  it('NAV_WAYPOINT param2 > 0 is the acceptance radius, used instead of the turn distance', () => {
    const corner = { x: 0, y: 800 }
    const closest = (radius: number) => {
      const path = local([item(22, null, 100), item(16, corner, 100, [0, radius, 0, 0]), item(16, { x: 800, y: 800 }, 100)])
      return Math.min(...path.map((pt) => r(pt, corner)))
    }
    expect(closest(150)).toBeGreaterThan(80)
    expect(closest(1)).toBeLessThan(closest(0))
    // AP_Mission keeps it in a byte: at most 255 m
    expect(closest(1000)).toBeCloseTo(closest(255), 5)
  })

  it('after DO_VTOL_TRANSITION to multicopter a loiter is a hover at the point, not a circle', () => {
    const c = { x: 0, y: 600 }
    const path = local([item(22, null, 60), item(3000, null, 0, [3, 0, 0, 0]), item(18, c, 60, [3, 0, 80, 0])])
    expect(path.some((pt) => r(pt, c) < 0.01)).toBe(true)
    // the straight approach may cross the 80 m radius once; a circle would put dozens of points on it
    expect(path.filter((pt) => Math.abs(r(pt, c) - 80 * eas2tas(1560) ** 2) < 0.5).length).toBeLessThanOrEqual(1)
  })

  it('a QuadPlane NAV_LAND flies to the point and descends vertically', () => {
    const land = { x: 300, y: 300 }
    const path = local([item(22, null, 50), item(21, land, 0)])
    const last = path.at(-1)!
    expect(r(last, land)).toBeLessThan(0.01)
    expect(last.alt).toBe(0)
    const above = path[path.length - 2]!
    expect(r(above, land)).toBeLessThan(0.01)
    expect(above.alt).toBeGreaterThan(40)
  })

  it('LOITER_UNLIM ends the prediction after one drawn circle', () => {
    const c = { x: 0, y: 600 }
    const path = local([item(22, null, 80), item(17, c, 80, [0, 0, 70, 0]), item(16, { x: 0, y: 2000 }, 80)])
    expect(Math.max(...path.map((pt) => pt.y))).toBeLessThan(600 + 70 * eas2tas(1580) ** 2 + 1)
  })

  it('a loiter approach spreads the climb over the way to the centre, so the plane joins the circle still climbing', () => {
    const c = { x: 400, y: 900 }
    // a gentle 40 m climb (the slope, not TECS, sets the pace) onto a wide 250 m circle
    const path = local([item(22, null, 60), item(16, { x: 0, y: 600 }, 60), item(31, c, 100, [0, 250, 0, 0]), item(16, { x: 0, y: 1500 }, 100)])
    const radius = 250 * eas2tas(1600) ** 2
    const join = path.find((pt) => Math.abs(r(pt, c) - radius) < 0.5)!
    // L1 heads for the centre and joins on the near side, ~40 % of the slope's way: still well short of 100 m
    expect(join.alt).toBeLessThan(90)
    expect(join.alt).toBeGreaterThan(65)
  })

  it('leaving a loiter with xtrack 0 converges onto the line from the centre to the next waypoint (L1); xtrack 1 flies straight', () => {
    const c = { x: 400, y: 900 }
    const next = { x: 0, y: 1500 }
    const line = (pt: Xy) => Math.abs((next.x - c.x) * (pt.y - c.y) - (next.y - c.y) * (pt.x - c.x)) / Math.hypot(next.x - c.x, next.y - c.y)
    const leg = (xtrack: number) => {
      const path = local([item(22, null, 150), item(18, c, 150, [1, 0, 120, xtrack]), item(16, next, 150)])
      return path.filter((pt) => r(pt, c) > 120 * eas2tas(1650) ** 2 + 1 && pt.y > c.y && r(pt, next) > 20)
    }
    const converged = leg(0).filter((pt) => line(pt) < 2)
    expect(converged.length).toBeGreaterThan(3)
    expect(Math.min(...converged.map((pt) => r(pt, c)))).toBeLessThan(0.8 * r(next, c))
    expect(leg(1).filter((pt) => line(pt) < 2).length).toBeLessThanOrEqual(1)
  })

  it('captures a loiter like L1 does: straight at the centre, turning onto the near side', () => {
    const c = { x: 0, y: 800 }
    const path = local([item(22, null, 100), item(18, c, 100, [3, 0, 150, 0])])
    const radius = 150 * eas2tas(1600) ** 2
    // the approach stays on the line toward the centre until the turn, and never crosses deep inside
    const joined = path.findIndex((pt) => Math.abs(r(pt, c) - radius) < 0.5)
    const before = path.slice(0, joined).filter((pt) => r(pt, c) > radius + 60)
    expect(Math.max(...before.map((pt) => Math.abs(pt.x)))).toBeLessThan(0.01)
    // it joins on the near side (south here); L1's ~10 m cut inside the circle is not modelled
    const join = path[joined]!
    expect(join.y).toBeLessThan(c.y - radius * 0.9)
    expect(Math.min(...path.map((pt) => r(pt, c)))).toBeGreaterThan(radius - 1)
  })
  it('a waypoint leading into a loiter is left a turn distance early and the capture swings wide (SITL 2026-10-20)', () => {
    // the user's mission on the SITL QuadPlane, flown into WP2 on a 320° course (as the vehicle was):
    // it overshot WP2's latitude (417 m) to 438 m before joining the circle
    const sitl: PlaneParams = { ...qp, airspeed: 25, rollLimitDeg: 65, navL1Period: 14, loiterRad: 60, wpRadius: 90 }
    const wp2 = { x: -132, y: 417 }
    const path = local([item(22, null, 50), item(16, { x: 208, y: 11 }, 50), item(16, wp2, 50), item(31, { x: 31, y: 332 }, 500)], sitl)
    const north = Math.max(...path.map((pt) => pt.y))
    expect(north).toBeGreaterThan(428)
    expect(north).toBeLessThan(448)
    // the leg ends turn-distance before WP2 (min(WP_RADIUS·EAS2TAS², L1 distance) for a turn ≥ 90°)
    const closest = Math.min(...path.map((pt) => r(pt, wp2)))
    expect(closest).toBeGreaterThan(20)
  })

  it('after the last waypoint the mission ends in RTL: the plane flies home and circles it at the last altitude', () => {
    const path = local([item(22, null, 80), item(16, { x: 0, y: 1500 }, 80), item(16, { x: 1500, y: 1500 }, 120)], PLANE_DEFAULTS)
    const radius = 60 * eas2tas(1620) ** 2
    const circling = path.filter((pt) => Math.abs(r(pt, { x: 0, y: 0 }) - radius) < 1)
    expect(circling.length).toBeGreaterThan(30)
    expect(circling.at(-1)!.alt).toBeCloseTo(120, 0)
  })

  it('no RTL is added after a mission that ends with a landing or a RTL of its own', () => {
    const landed = local([item(22, null, 50), item(16, { x: 0, y: 1500 }, 50), item(21, { x: 600, y: 1500 }, 0)])
    expect(r(landed.at(-1)!, { x: 600, y: 1500 })).toBeLessThan(0.01)
    const rtl = local([item(22, null, 50), item(16, { x: 0, y: 1500 }, 50), item(20, null, 0)], PLANE_DEFAULTS)
    const once = local([item(22, null, 50), item(16, { x: 0, y: 1500 }, 50)], PLANE_DEFAULTS)
    expect(rtl).toEqual(once)
  })

  it('tells where the mission part ends and the RTL tail begins', () => {
    const items = [item(22, null, 80), item(16, { x: 0, y: 1500 }, 80), item(16, { x: 1500, y: 1500 }, 120)]
    const parts = predictPlaneParts(items, home, PLANE_DEFAULTS)
    expect(parts.points).toEqual(predictPlane(items, home, PLANE_DEFAULTS))
    expect(parts.missionEnd).toBeGreaterThan(1)
    expect(parts.missionEnd).toBeLessThan(parts.points.length)
    // the mission part ends near the last waypoint, the tail goes home
    const lastMission = toXy(home, parts.points[parts.missionEnd - 1]!)
    expect(r(lastMission, { x: 1500, y: 1500 })).toBeLessThan(150)
    const landed = [item(22, null, 50), item(16, { x: 0, y: 1500 }, 50), item(21, { x: 600, y: 1500 }, 0)]
    const whole = predictPlaneParts(landed, home, qp)
    expect(whole.missionEnd).toBe(whole.points.length)
  })

  it('a 700-waypoint survey predicts within 150 ms', () => {
    const lanes = Array.from({ length: 700 }, (_, k) => item(16, { x: Math.floor(k / 2) * 40, y: k % 4 === 1 || k % 4 === 2 ? 1200 : 0 }, 100))
    const p: PlaneParams = { ...PLANE_DEFAULTS, airspeed: 18, rollLimitDeg: 35, wpRadius: 60 }
    local([item(22, null, 100), ...lanes], p)
    const t0 = performance.now()
    local([item(22, null, 100), ...lanes], p)
    expect(performance.now() - t0).toBeLessThan(150)
  })
})
