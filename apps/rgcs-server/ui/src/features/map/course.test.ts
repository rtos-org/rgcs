import { describe, expect, it } from 'vitest'
import type { VehicleState } from '../../shared/api/types'
import { courseGeoJson, VECTOR_SECONDS } from './course'

const M_PER_DEG = 111_320
const v = (over: Partial<VehicleState> = {}): VehicleState => ({
  sysid: 1, name: 'UAV-01', kind: 'copter', mode: 'AUTO', armed: true, lat: 36, lon: 139, alt_rel: 50, alt_msl: 450, hdg: 0,
  ground_speed: 5, climb: 0, battery: { pct: 50, volt: 22, current: null }, link: 'ok', last_rx_ms: 0,
  gps: { fix: 3, sats: 10, hdop: 1 }, warn: false, unread: 0, ...over,
})
const kinds = (fc: ReturnType<typeof courseGeoJson>) => fc.features.map((f) => (f.properties as { kind: string }).kind)
const line = (fc: ReturnType<typeof courseGeoJson>, kind: string) =>
  (fc.features.find((f) => (f.properties as { kind: string }).kind === kind)!.geometry as unknown as { coordinates: [number, number][] }).coordinates

describe('courseGeoJson', () => {
  it('vector_points_along_course_and_scales_with_speed', () => {
    const fc = courseGeoJson(new Map([[1, v({ cog: 90, ground_speed: 5 })]]), 1)
    const [a, b] = line(fc, 'vector')
    expect(a).toEqual([139, 36])
    expect(b![1]).toBeCloseTo(36, 6)
    const east = (b![0] - 139) * M_PER_DEG * Math.cos((36 * Math.PI) / 180)
    expect(east).toBeCloseTo(5 * VECTOR_SECONDS, 0)
    expect(fc.features[0]!.properties).toMatchObject({ sel: 1 })
  })

  it('vector_has_a_visible_minimum_length_on_screen', () => {
    // 10 m/px (zoomed out): a 2 m/s vehicle still gets a 70 px vector
    const fc = courseGeoJson(new Map([[1, v({ cog: 0, ground_speed: 2 })]]), null, 10)
    const [, b] = line(fc, 'vector')
    expect((b![1] - 36) * M_PER_DEG).toBeCloseTo(700, -1)
  })

  it('no_vector_when_slow_or_no_cog', () => {
    expect(kinds(courseGeoJson(new Map([[1, v({ cog: 90, ground_speed: 0.3 })]]), null))).not.toContain('vector')
    expect(kinds(courseGeoJson(new Map([[1, v({ ground_speed: 5 })]]), null))).not.toContain('vector')
  })

  it('nav_line_uses_bearing_and_distance_and_a_target_only_when_it_agrees', () => {
    // 80 m north ≈ 36.000719; a target 5 m away from that point is used, one near home is not
    const near = { lat: 36.00076, lon: 139.00001, alt: 50 }
    const guided = courseGeoJson(new Map([[1, v({ mode: 'GUIDED', nav: { target_bearing: 0, wp_dist: 80 }, target: near })]]), null)
    expect(line(guided, 'nav')[1]).toEqual([near.lon, near.lat])
    const off = courseGeoJson(new Map([[1, v({ mode: 'GUIDED', nav: { target_bearing: 0, wp_dist: 80 }, target: { lat: 35.999, lon: 139, alt: 50 } })]]), null)
    expect((line(off, 'nav')[1]![1] - 36) * M_PER_DEG).toBeCloseTo(80, 0)
    expect(guided.features.find((f) => (f.properties as { kind: string }).kind === 'target')).toBeDefined()
    const auto = courseGeoJson(new Map([[1, v({ mode: 'AUTO', nav: { target_bearing: 0, wp_dist: 100 } })]]), null)
    const end = line(auto, 'nav')[1]!
    expect((end[1] - 36) * M_PER_DEG).toBeCloseTo(100, 0)
    expect(end[0]).toBeCloseTo(139, 9)
    expect((auto.features.find((f) => (f.properties as { kind: string }).kind === 'nav')!.properties as { dist: number }).dist).toBe(100)
  })

  it('no_nav_line_when_not_navigating', () => {
    const nav = { target_bearing: 0, wp_dist: 100 }
    expect(kinds(courseGeoJson(new Map([[1, v({ mode: 'LOITER', nav })]]), null))).not.toContain('nav')
    expect(kinds(courseGeoJson(new Map([[1, v({ mode: 'AUTO', nav: { target_bearing: 0, wp_dist: 0 } })]]), null))).not.toContain('nav')
    expect(kinds(courseGeoJson(new Map([[1, v({ mode: 'AUTO', nav, armed: false })]]), null))).not.toContain('nav')
    expect(kinds(courseGeoJson(new Map([[1, v({ mode: 'AUTO', nav, gps: { fix: 1, sats: 0, hdop: null } })]]), null))).toEqual([])
  })
  it('no_course_for_a_vehicle_whose_link_is_lost (its last course is stale)', () => {
    const lost = v({ link: 'lost', cog: 90, ground_speed: 8, mode: 'AUTO', nav: { target_bearing: 90, wp_dist: 100 } })
    expect(courseGeoJson(new Map([[1, lost]]), null).features).toEqual([])
  })
})
