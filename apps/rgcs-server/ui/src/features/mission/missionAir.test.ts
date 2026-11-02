import { describe, expect, it } from 'vitest'
import { toMercator } from '../map/air'
import type { DraftItem } from './model'
import { missionAirData, othersAirLines } from './missionAir'
import { RECT, surveyDraft } from '../survey/surveyFixture'
import { SURVEY_LIFT_M } from '../survey/surveyAir'

const it_ = (uid: number, lat: number, alt: number, frame: DraftItem['frame'] = 'rel', command = 16): DraftItem => ({ uid, command, frame, params: [0, 0, 0, 0], lat, lon: 138.47829, alt, autocontinue: true })
const draft = (items: DraftItem[], home: { lat: number; lon: number; alt: number } | null = null) => ({ mission: { id: null, name: 'm', sysid: null, default_alt: 60, default_frame: 'rel' as const, speed: 8, home, items: [] }, items, nextUid: 99, surveys: [] })
const POST: readonly number[] = [0xbf / 255, 0xe0 / 255, 1]
const AMBER: readonly number[] = [0xf2 / 255, 0xb5 / 255, 0x44 / 255]

describe('missionAirData', () => {
  it('draws one altitude line per leg at the item altitudes', () => {
    const d = missionAirData(draft([it_(1, 35.479883, 30), it_(2, 35.480883, 80)]) as never, new Set(), () => 100)
    expect(d.lines).toHaveLength(1)
    const line = d.lines[0]!
    expect(line[0]!.z).toBeCloseTo(toMercator(138.47829, 35.479883, 130).z, 12)
    expect(line.at(-1)!.z).toBeCloseTo(toMercator(138.47829, 35.480883, 180).z, 12)
    expect(d.alts.get(1)).toBe(130)
  })
  it('colours each leg by its climb: level cyan, steep climb red', () => {
    // 0.001° latitude ≈ 111 m: +0 m level, +200 m steep
    const d = missionAirData(draft([it_(1, 35.479883, 50), it_(2, 35.480883, 50), it_(3, 35.481883, 250)]) as never, new Set(), () => 100)
    expect(d.lines[0]!.every((v) => v.c[0] === 0x9c / 255)).toBe(true)
    expect(d.lines[1]!.every((v) => v.c[0] === 1 && v.c[1] === 0x69 / 255)).toBe(true)
  })
  it('colours a terrain-following leg by the slope it actually flies', () => {
    // ground rises 100 m over the first half (≈ 50 m) then stays flat
    const ground = (_lon: number, lat: number) => (lat < 35.480333 ? 100 + ((lat - 35.479883) / 0.00045) * 100 : 200)
    const d = missionAirData(draft([it_(1, 35.479883, 40, 'ter'), it_(2, 35.480773, 40, 'ter')]) as never, new Set(), ground)
    const line = d.lines[0]!
    expect(line[0]!.c).toEqual([1, 0x69 / 255, 0x61 / 255])
    expect(line.at(-2)!.c).toEqual([0x9c / 255, 0xc9 / 255, 1])
  })
  it('subdivides a terrain-following leg every 20 m', () => {
    // 0.00089° latitude ≈ 99 m → 5 segments
    const d = missionAirData(draft([it_(1, 35.479883, 40, 'ter'), it_(2, 35.480773, 40, 'ter')]) as never, new Set(), () => 100)
    expect(d.lines[0]).toHaveLength(6)
  })
  it('gives each positioned item a post, amber when selected', () => {
    const d = missionAirData(draft([it_(1, 35.479883, 30), it_(2, 35.480883, 80), it_(3, 0, 0, 'rel', 178)]) as never, new Set([2]), () => 100)
    expect(d.posts).toHaveLength(2)
    expect(d.posts[0]![0]!.c).toEqual(POST)
    expect(d.posts[1]![0]!.c).toEqual(AMBER)
    expect(d.discs.features.map((f) => f.properties.sel)).toEqual([0, 1])
  })
  it('starts at the home when the mission has one', () => {
    const d = missionAirData(draft([it_(1, 35.480883, 30)], { lat: 35.479883, lon: 138.47829, alt: 400 }) as never, new Set(), () => 100)
    expect(d.lines).toHaveLength(1)
    expect(d.lines[0]![0]!.z).toBeCloseTo(toMercator(138.47829, 35.479883, 100).z, 12)
  })
  it('draws nothing (and no NaN) while the ground is unknown', () => {
    const d = missionAirData(draft([it_(1, 35.479883, 30), it_(2, 35.480883, 80)]) as never, new Set(), () => null)
    expect(d.lines).toHaveLength(0)
    expect(d.posts).toHaveLength(0)
    expect(d.alts.get(1)).toBeNull()
  })
  it('knows the altitude at each mid-leg handle, by the uid ending its leg (handles inside a survey are skipped)', () => {
    const d = missionAirData(draft([it_(1, 35.479883, 30), it_(2, 35.480883, 80), it_(3, 35.481883, 40)]) as never, new Set(), () => 100)
    expect(d.mids).toEqual(new Map([[2, 155], [3, 160]]))
  })

  it('raises each fence zone as a wall up to the FENCE_ALT_MAX ceiling (green inclusion, red exclusion)', () => {
    const base = draft([it_(1, 35.479883, 30)], { lat: 35.479883, lon: 138.47829, alt: 400 }) as never as Parameters<typeof missionAirData>[0]
    const fenced = { ...base, mission: { ...base.mission, fence: [{ kind: 'polygon', inclusion: true, vertices: [{ lat: 35.479883, lon: 138.47829 }, { lat: 35.479883, lon: 138.48829 }, { lat: 35.489883, lon: 138.48829 }] }, { kind: 'circle', inclusion: false, center: { lat: 35.484883, lon: 138.48329 }, radius: 50 }] } } as never
    const plain = missionAirData(fenced, new Set(), () => 100)
    const walled = missionAirData(fenced, new Set(), () => 100, 120)
    expect(walled.lines.length).toBe(plain.lines.length + 2) // a top ring per zone
    const ring = walled.lines.at(-2)!
    expect(ring).toHaveLength(4) // closed triangle
    expect(ring[0]!.z).toBeCloseTo(toMercator(138.47829, 35.479883, 220).z, 12)
    expect(ring[0]!.c).toEqual([0x5f / 255, 0xd3 / 255, 0x9b / 255])
    expect(walled.lines.at(-1)![0]!.c).toEqual([1, 0x69 / 255, 0x61 / 255])
    expect(walled.posts.length).toBe(plain.posts.length + 3 + 4) // polygon vertices + 4 around the circle
  })

  it('without a mission home or items the walls stand on the vehicle\'s home (FENCE_ALT_MAX is above it)', () => {
    const empty = draft([]) as never as Parameters<typeof missionAirData>[0]
    const fenced = { ...empty, mission: { ...empty.mission, fence: [{ kind: 'circle', inclusion: true, center: { lat: 35.484883, lon: 138.48329 }, radius: 50 }] } } as never
    expect(missionAirData(fenced, new Set(), () => 100, 120).lines).toHaveLength(0)
    const walled = missionAirData(fenced, new Set(), () => 100, 120, { lat: 35.479883, lon: 138.47829 })
    expect(walled.lines).toHaveLength(1)
    expect(walled.lines[0]![0]!.z).toBeCloseTo(toMercator(138.48329, 35.484883 + 50 / 110_540, 220).z, 9)
  })
  it('adds the predicted flight path as a thin translucent line above the home ground (posts pass)', () => {
    const home = { lat: 35.479883, lon: 138.47829 }
    const points = [{ ...home, alt: 0 }, { ...home, alt: 40 }, { lat: 35.480883, lon: 138.47829, alt: 40 }]
    const d = missionAirData(draft([]) as never, new Set(), () => 100, null, null, { home, points })
    expect(d.lines).toHaveLength(0)
    expect(d.posts).toHaveLength(1)
    expect(d.posts[0]!.map((v) => v.z)).toEqual(points.map((p) => toMercator(p.lon, p.lat, 100 + p.alt).z))
    expect(missionAirData(draft([]) as never, new Set(), () => null, null, null, { home, points }).posts).toHaveLength(0)
  })
  it('drapes each survey area outline on the ground: a closed line just above the DEM', () => {
    const { draft: sd } = surveyDraft()
    const d = missionAirData(sd, new Set(), () => 100)
    const base = missionAirData({ ...sd, surveys: [] }, new Set(), () => 100)
    expect(d.lines).toHaveLength(base.lines.length + 1)
    const outline = d.lines.at(-1)!
    expect(outline.length).toBeGreaterThan(RECT.length + 1)
    expect([outline[0]!.x, outline[0]!.y]).toEqual([outline.at(-1)!.x, outline.at(-1)!.y])
    expect(outline[0]!.z).toBeCloseTo(toMercator(RECT[0]!.lon, RECT[0]!.lat, 100 + SURVEY_LIFT_M).z, 12)
  })
})

describe('othersAirLines', () => {
  const dim = (c: number, base: number) => c / 255 + (base / 255 - c / 255) * 0.45
  it('others_air_lines_use_the_dimmed_mission_colour_and_amsl', () => {
    const other = { key: 'b', color: '#9cc9ff', draft: draft([it_(1, 35.479883, 30), it_(2, 35.480883, 80)]) as never, predicted: null }
    const lines = othersAirLines([other], () => 100)
    expect(lines).toHaveLength(1)
    const line = lines[0]!
    const c = [dim(0x9c, 0x11), dim(0xc9, 0x16), dim(0xff, 0x1e)]
    line.forEach((v) => v.c.forEach((x, i) => expect(x).toBeCloseTo(c[i]!, 12)))
    expect(line[0]!.z).toBeCloseTo(toMercator(138.47829, 35.479883, 130).z, 12)
    expect(line.at(-1)!.z).toBeCloseTo(toMercator(138.47829, 35.480883, 180).z, 12)
  })
  it('joins every leg of a mission into one line and skips a mission with nothing to draw', () => {
    const three = { key: 'a', color: '#5fd39b', draft: draft([it_(1, 35.479883, 30), it_(2, 35.480883, 80), it_(3, 35.481883, 80)]) as never, predicted: null }
    const single = { key: 'c', color: '#5fd39b', draft: draft([it_(1, 35.479883, 30)]) as never, predicted: null }
    const legs = missionAirData(three.draft, new Set(), () => 100).lines
    const lines = othersAirLines([three, single], () => 100)
    expect(lines).toHaveLength(1)
    expect(lines[0]).toHaveLength(legs[0]!.length + legs[1]!.length - 1)
    expect(othersAirLines([three], () => null)).toHaveLength(0)
  })
})
