import { describe, expect, it } from 'vitest'
import type { MissionItem } from '../../shared/api/types'
import { toLocal } from '../mission/arc'
import type { LatLon } from '../mission/geo'
import { generateSurvey, surveyGeometry, surveyNumbers, type SurveyGeometry } from './generate'
import { turnRadiusM } from './photo'
import { ALPHA7R4, defaultSpec, type SurveySpec } from './spec'
import { planTurn } from './turns'

const O: LatLon = { lat: 36.25, lon: 139.0 }
const M_LAT = 110_540
const M_LON = 111_320 * Math.cos((36.25 * Math.PI) / 180)
/** Point `e` m east and `n` m north of O. */
const at = (e: number, n: number): LatLon => ({ lat: O.lat + n / M_LAT, lon: O.lon + e / M_LON })
const dist = (a: LatLon, b: LatLon) => Math.hypot(toLocal(a, b).x, toLocal(a, b).y)
const east = (p: LatLon) => toLocal(O, p).x

// 400 m east-west x 300 m north-south
const RECT = [at(0, 0), at(400, 0), at(400, 300), at(0, 300)]
const CENTRE = at(200, 150)
const spec = (o: Partial<SurveySpec> = {}): SurveySpec => ({ ...defaultSpec(RECT, ALPHA7R4, 'plane'), angleDeg: 90, start: 'nw', ...o })

type Ok = { items: MissionItem[]; geometry: SurveyGeometry }
function gen(s: SurveySpec, home: LatLon | null = null): Ok {
  const r = generateSurvey(s, home)
  if ('error' in r) throw new Error(r.error)
  return r
}
const WP = 16
const ARC = 36
const TRIG = 206
const pos = (it: MissionItem): LatLon => ({ lat: it.lat, lon: it.lon })
const nav = (items: readonly MissionItem[]) => items.filter((it) => it.command === WP || it.command === ARC)
/** The items of each turn: between a trigger-off and the next trigger-on, without the lane's own lead-in and overshoot WPs. */
function turns(items: readonly MissionItem[]): MissionItem[][] {
  const out: MissionItem[][] = []
  let cur: MissionItem[] | null = null
  for (const it of items) {
    if (it.command === TRIG && it.params[0] === 0) cur = []
    else if (it.command === TRIG) {
      if (cur) out.push(cur.slice(1, -2)) // drop the overshoot WP, the lead-in start (or the turn point on it) and the shooting-start WP
      cur = null
    } else if (cur) cur.push(it)
  }
  return out
}

describe('generateSurvey', () => {
  it('starts with DO_CHANGE_SPEED: airspeed for plane, ground speed for copter', () => {
    expect(gen(spec()).items[0]).toMatchObject({ command: 178, params: [0, 18, -1, 0], lat: 0, lon: 0, alt: 0 })
    expect(gen(spec({ airframe: 'copter', speedMs: 8 })).items[0].params).toEqual([1, 8, -1, 0])
  })

  it('all items are rel at the survey altitude; DO items sit at 0, 0, 0', () => {
    for (const it of gen(spec()).items) {
      expect(it.frame).toBe('rel')
      expect(it.autocontinue).toBe(true)
      if (it.command === WP || it.command === ARC) expect(it.alt).toBe(100)
      else expect([it.lat, it.lon, it.alt]).toEqual([0, 0, 0])
    }
  })

  it('geometry: auto lead-in, overshoot and margins', () => {
    const g = gen(spec()).geometry
    expect(g.turnRadiusM).toBeCloseTo(57.22, 1)
    // ceil5(max(R, 8 s × (18 + 0) m/s)) = 145
    expect(g.leadInM).toBe(145)
    expect(g.overshootM).toBe(30)
    expect(g.marginAlongM).toBeCloseTo(34, 6)
    expect(g.marginAcrossM).toBeCloseTo(51, 6)
    expect(g.spacingM).toBeCloseTo(30.6, 6)
    expect(g.triggerDistM).toBeCloseTo(13.6, 6)
    expect(g.lanes).toHaveLength(14)
    expect([...g.order].sort((a, b) => a - b)).toEqual(g.lanes.map((_, i) => i))
  })

  it('auto lead-in is ceil5(max(R, 8 × (speed + wind))) for plane, 0 for copter', () => {
    expect(gen(spec({ windMs: 5 })).geometry.leadInM).toBe(185)
    // 60° bank at 5 m/s: R 1.5 m, so the 8 s term (40 m) decides
    expect(gen(spec({ speedMs: 5, bankDeg: 60 })).geometry.leadInM).toBe(40)
    // a slow, shallow turn: R 102 m beats 8 × 12 = 96 m
    expect(gen(spec({ speedMs: 12, bankDeg: 8 })).geometry.leadInM).toBe(105)
    expect(gen(spec({ airframe: 'copter', speedMs: 8 })).geometry.leadInM).toBe(0)
  })

  it('explicit margin, lead-in and overshoot; wind widens the radius', () => {
    const g = gen(spec({ marginM: 10, leadInM: 80, overshootM: 15, windMs: 5 })).geometry
    expect([g.marginAlongM, g.marginAcrossM, g.leadInM, g.overshootM]).toEqual([10, 10, 80, 15])
    expect(g.turnRadiusM).toBeCloseTo(turnRadiusM(23, 30), 6)
  })

  it('trigger items alternate dist / 0, two per lane', () => {
    const { items, geometry } = gen(spec())
    const trig = items.filter((it) => it.command === TRIG)
    expect(trig).toHaveLength(2 * geometry.lanes.length)
    trig.forEach((it, i) => {
      if (i % 2 === 0) {
        expect(it.params[0]).toBeCloseTo(13.6, 6)
        expect(it.params.slice(1)).toEqual([0, 1, 0])
      } else expect(it.params).toEqual([0, 0, 0, 0])
    })
  })

  it('only the shooting-end WP lies between a trigger-on and its trigger-off', () => {
    const { items } = gen(spec())
    items.forEach((it, i) => {
      if (it.command !== TRIG || it.params[0] === 0) return
      expect(items[i - 1].command).toBe(WP)
      expect(items[i + 1].command).toBe(WP)
      expect(items[i + 2]).toMatchObject({ command: TRIG, params: [0, 0, 0, 0] })
    })
  })

  it('shooting runs alternate direction and cover each lane end to end', () => {
    const { items, geometry } = gen(spec())
    const runs = items.flatMap((it, i) => (it.command === TRIG && it.params[0] > 0 ? [[pos(items[i - 1]), pos(items[i + 1])]] : []))
    runs.forEach(([s, e], k) => {
      const lane = geometry.lanes[geometry.order[k]]
      expect(dist(s, e)).toBeCloseTo(dist(lane.a, lane.b), 3)
      const eastbound = east(e) > east(s)
      if (k > 0) expect(eastbound).not.toBe(east(runs[k - 1][1]) > east(runs[k - 1][0]))
    })
  })

  it('split turns stay outside the shooting area and never repeat a position', () => {
    const { items } = gen(spec())
    const t = turns(items)
    expect(t).toHaveLength(13)
    for (const turn of t) {
      expect(turn.length).toBeGreaterThan(0)
      for (const it of turn) {
        expect(it.command).toBe(WP)
        expect(east(pos(it)) > 400 + 34 || east(pos(it)) < -34).toBe(true)
      }
    }
    const n = nav(items)
    n.slice(1).forEach((it, i) => expect(dist(pos(n[i]), pos(it))).toBeGreaterThanOrEqual(0.5))
  })

  it('arc turns: command 36 with first-arc signs alternating per turn', () => {
    const { items } = gen(spec({ turn: 'arc' }))
    const signs = turns(items).map((turn) => {
      const arcs = turn.filter((it) => it.command === ARC)
      expect(arcs.length).toBeGreaterThan(0)
      for (const a of arcs) expect(Math.abs(a.params[0])).toBeGreaterThanOrEqual(1)
      return Math.sign(arcs[0].params[0])
    })
    expect(signs).toHaveLength(13)
    signs.slice(1).forEach((s, i) => expect(s).toBe(-signs[i]))
  })

  it('arc turns: param1 is the whole-degree sweep of each planned arc', () => {
    const { items, geometry } = gen(spec({ turn: 'arc' }))
    const offs = items.flatMap((it, i) => (it.command === TRIG && it.params[0] === 0 ? [i] : []))
    const ons = items.flatMap((it, i) => (it.command === TRIG && it.params[0] > 0 ? [i] : []))
    offs.slice(0, -1).forEach((off, k) => {
      const shootStart = toLocal(O, pos(items[off - 3]))
      const shootEnd = toLocal(O, pos(items[off - 1]))
      const heading = (Math.atan2(shootEnd.x - shootStart.x, shootEnd.y - shootStart.y) * 180) / Math.PI
      const nextOn = ons[k + 1]
      const over = toLocal(O, pos(items[off + 1]))
      const lead = toLocal(O, pos(items[nextOn - 2]))
      const planned = planTurn(over, lead, heading, geometry.turnRadiusM).arcs.filter((a) => Math.abs(a.sweepDeg) >= 1).map((a) => Math.round(a.sweepDeg))
      const emitted = items.slice(off + 1, nextOn).filter((it) => it.command === ARC).map((it) => it.params[0])
      for (const p1 of emitted) {
        expect(Number.isInteger(p1)).toBe(true)
        expect(p1).not.toBe(0)
      }
      expect(emitted).toEqual(planned)
    })
  })

  it('copter: no lead-in, overshoot or turn items', () => {
    const { items, geometry } = gen(spec({ airframe: 'copter', speedMs: 8, turn: 'arc' }))
    expect(items.some((it) => it.command === ARC)).toBe(false)
    const ends = geometry.lanes.flatMap((l) => [l.a, l.b])
    const wps = items.filter((it) => it.command === WP)
    expect(wps).toHaveLength(2 * geometry.lanes.length)
    for (const it of wps) expect(Math.min(...ends.map((e) => dist(e, pos(it))))).toBeLessThan(0.01)
  })

  it('is deterministic', () => {
    expect(gen(spec()).items).toEqual(gen(spec()).items)
  })

  it('invalid polygons give invalid_polygon', () => {
    const bowTie = [at(0, 0), at(400, 300), at(400, 0), at(0, 300)]
    expect(generateSurvey(spec({ polygon: bowTie }), null)).toEqual({ error: 'invalid_polygon' })
    expect(generateSurvey(spec({ polygon: [at(0, 0), at(10, 10)] }), null)).toEqual({ error: 'invalid_polygon' })
    expect(surveyGeometry(spec({ polygon: bowTie }), null)).toBeNull()
  })

  it.each([
    ['sw', -1, -1],
    ['nw', 1, -1],
    ['ne', 1, 1],
    ['se', -1, 1],
  ] as const)('start %s puts the first lead-in in that corner', (start, sn, se) => {
    const first = pos(gen(spec({ start })).items[1])
    expect(Math.sign(first.lat - CENTRE.lat)).toBe(sn)
    expect(Math.sign(first.lon - CENTRE.lon)).toBe(se)
  })

  it('start home picks the entry nearest home, nw without home', () => {
    const ne = pos(gen(spec({ start: 'home' }), at(400, 300)).items[1])
    expect(ne.lat).toBeGreaterThan(CENTRE.lat)
    expect(ne.lon).toBeGreaterThan(CENTRE.lon)
    const nw = pos(gen(spec({ start: 'home' }), null).items[1])
    expect(nw.lat).toBeGreaterThan(CENTRE.lat)
    expect(nw.lon).toBeLessThan(CENTRE.lon)
  })

  it('a 2 km x 1 km area at 0.32 cm/px generates in under 200 ms', () => {
    const big = [at(0, 0), at(2000, 0), at(2000, 1000), at(0, 1000)]
    const s = spec({ polygon: big, altM: 30 })
    gen(s) // warm-up
    const t0 = performance.now()
    const { items } = gen(s)
    expect(performance.now() - t0).toBeLessThan(200)
    expect(items.length).toBeGreaterThan(100)
  })
})

describe('surveyNumbers', () => {
  it('rectangle: photos, lanes, interval, blur, distance and time', () => {
    const s = spec()
    const { items, geometry } = gen(s)
    const n = surveyNumbers(s, geometry, items)
    // 14 lanes of 400 + 2 x 34 = 468 m, a photo every 13.6 m: floor(468 / 13.6) + 1 = 35 each
    expect(n.photos).toBe(14 * 35)
    expect(n.lanes).toBe(14)
    expect(n.areaM2 / 120_000).toBeCloseTo(1, 2)
    expect(n.intervalS).toBeCloseTo(13.6 / 18, 6)
    expect(n.blur.cm).toBeCloseTo(1.8, 6)
    expect(n.distanceM).toBeGreaterThan(14 * (468 + 60 + 30))
    expect(n.timeS).toBeCloseTo(n.distanceM / 18, 6)
  })

  it('wind raises the interval-relevant ground speed', () => {
    const s = spec({ windMs: 2 })
    const { items, geometry } = gen(s)
    const n = surveyNumbers(s, geometry, items)
    expect(n.intervalS).toBeCloseTo(13.6 / 20, 6)
    expect(n.blur.cm).toBeCloseTo(2.0, 6)
  })
})

describe('size caps', () => {
  const square = (m: number) => [at(0, 0), at(m, 0), at(m, m), at(0, m)]
  it('more than 1000 lanes is too_large, answered without building them', () => {
    // 40 km at 30.6 m spacing: about 1300 lanes
    const started = performance.now()
    expect(generateSurvey(spec({ polygon: square(40_000) }), null)).toEqual({ error: 'too_large' })
    expect(performance.now() - started).toBeLessThan(500)
  })
  it('more than 5000 items is too_large', () => {
    // 15 km: about 490 lanes of about a dozen items each
    expect(generateSurvey(spec({ polygon: square(15_000) }), null)).toEqual({ error: 'too_large' })
  })
})
