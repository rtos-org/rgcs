import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { SurveyCamera } from '../../shared/api/types'
import { appendWaypoint, emptyDraft, type Draft } from '../mission/model'
import { ALPHA7R4 } from './spec'
import { at, HOME, RECT } from './surveyFixture'
import { useSurveyDraw, type DrawVehicle } from './useSurveyDraw'

const base = (): Draft => [0, 1, 2].reduce((d, k) => appendWaypoint(d, 36 + k / 1000, 139), emptyDraft())

function setup(o: { afterUid?: number | null; vehicle?: DrawVehicle | null; cameras?: readonly SurveyCamera[] } = {}) {
  let draft = base()
  const change = vi.fn((fn: (d: Draft) => Draft) => {
    draft = fn(draft)
  })
  const select = vi.fn()
  const hook = renderHook(() => useSurveyDraw({ change, afterUid: o.afterUid ?? null, home: HOME, cameras: o.cameras ?? [], vehicle: o.vehicle ?? null, select }))
  const drawRect = () => {
    act(() => hook.result.current.start())
    RECT.forEach((p) => act(() => hook.result.current.addVertex(p)))
  }
  return { hook, change, select, drawRect, draft: () => draft }
}

describe('useSurveyDraw', () => {
  it('start enters drawing with no vertices; each click adds one', () => {
    const { hook } = setup()
    expect(hook.result.current.drawing).toBeNull()
    act(() => hook.result.current.start())
    expect(hook.result.current.drawing).toEqual([])
    act(() => hook.result.current.addVertex(RECT[0]!))
    expect(hook.result.current.drawing).toEqual([RECT[0]])
  })

  it('moveVertex moves one vertex of the area being drawn, leaving the others', () => {
    const { hook, drawRect, change } = setup()
    drawRect()
    act(() => hook.result.current.moveVertex(1, { lat: 36.3, lon: 139.3 }))
    expect(hook.result.current.drawing).toEqual([RECT[0], { lat: 36.3, lon: 139.3 }, ...RECT.slice(2)])
    expect(change).not.toHaveBeenCalled()
  })

  it('finish creates the survey after the selected item and selects its first item', () => {
    const { hook, drawRect, draft, select } = setup({ afterUid: 2 })
    drawRect()
    act(() => hook.result.current.finish())
    const d = draft()
    expect(d.surveys).toHaveLength(1)
    const s = d.surveys[0]!
    const at2 = d.items.findIndex((it) => it.uid === 2)
    expect(d.items[at2 + 1]?.uid).toBe(s.uids[0])
    expect(d.items.at(-1)?.uid).toBe(3)
    expect(s.spec.polygon).toEqual(RECT)
    expect(select).toHaveBeenCalledWith(s.uids[0])
    expect(hook.result.current.drawing).toBeNull()
  })

  it('finish needs three vertices', () => {
    const { hook, change } = setup()
    act(() => hook.result.current.start())
    act(() => hook.result.current.addVertex(RECT[0]!))
    act(() => hook.result.current.addVertex(RECT[1]!))
    act(() => hook.result.current.finish())
    expect(change).not.toHaveBeenCalled()
    expect(hook.result.current.drawing).toHaveLength(2)
  })

  it('cancel leaves the draft unchanged', () => {
    const { hook, drawRect, change } = setup()
    drawRect()
    act(() => hook.result.current.cancel())
    expect(change).not.toHaveBeenCalled()
    expect(hook.result.current.drawing).toBeNull()
  })

  it('a polygon no lane fits stays in drawing and reports invalid_polygon', () => {
    const { hook, change } = setup()
    act(() => hook.result.current.start())
    ;[at(0, 0), at(100, 0), at(200, 0)].forEach((p) => act(() => hook.result.current.addVertex(p)))
    act(() => hook.result.current.finish())
    expect(change).not.toHaveBeenCalled()
    expect(hook.result.current.error).toBe('invalid_polygon')
    expect(hook.result.current.drawing).toHaveLength(3)
  })

  it('an area too large to generate is refused at once with too_large: nothing inserted, no freeze', () => {
    const { hook, change } = setup()
    act(() => hook.result.current.start())
    ;[at(0, 0), at(40_000, 0), at(40_000, 40_000), at(0, 40_000)].forEach((p) => act(() => hook.result.current.addVertex(p)))
    const started = performance.now()
    act(() => hook.result.current.finish())
    expect(performance.now() - started).toBeLessThan(500)
    expect(change).not.toHaveBeenCalled()
    expect(hook.result.current.error).toBe('too_large')
    expect(hook.result.current.drawing).toHaveLength(4)
  })

  it('without a vehicle: plane, bank 30, WP_RADIUS 90, the α7R IV', () => {
    const { hook, drawRect, draft } = setup()
    drawRect()
    act(() => hook.result.current.finish())
    const spec = draft().surveys[0]!.spec
    expect([spec.airframe, spec.bankDeg, spec.wpRadiusM]).toEqual(['plane', 30, 90])
    expect(spec.camera).toEqual(ALPHA7R4)
    expect(spec.name).toBe('1')
  })

  it('takes the airframe, ROLL_LIMIT_DEG (capped at 30) and WP_RADIUS from the vehicle', () => {
    const plane = setup({ vehicle: { kind: 'plane', params: new Map([['ROLL_LIMIT_DEG', 25], ['WP_RADIUS', 60]]) } })
    plane.drawRect()
    act(() => plane.hook.result.current.finish())
    expect(plane.draft().surveys[0]!.spec).toMatchObject({ airframe: 'plane', bankDeg: 25, wpRadiusM: 60 })
    const copter = setup({ vehicle: { kind: 'copter', params: new Map([['ROLL_LIMIT_DEG', 45]]) } })
    copter.drawRect()
    act(() => copter.hook.result.current.finish())
    expect(copter.draft().surveys[0]!.spec).toMatchObject({ airframe: 'copter', bankDeg: 30, wpRadiusM: 90 })
  })

  it('a plane survey starts with the suggested lane skip (2R apart); a copter one with none', () => {
    const plane = setup()
    plane.drawRect()
    act(() => plane.hook.result.current.finish())
    // α7R IV at 100 m, 70 % side: 30.6 m spacing; 18 m/s at 30°: R 57.2 m → skip 3
    expect(plane.draft().surveys[0]!.spec.skip).toBe(3)
    const copter = setup({ vehicle: { kind: 'copter', params: new Map() } })
    copter.drawRect()
    act(() => copter.hook.result.current.finish())
    expect(copter.draft().surveys[0]!.spec.skip).toBe(0)
  })

  it('a connected plane flies the survey at its AIRSPEED_CRUISE (the parameter is only read)', () => {
    const plane = setup({ vehicle: { kind: 'plane', params: new Map([['AIRSPEED_CRUISE', 22]]) } })
    plane.drawRect()
    act(() => plane.hook.result.current.finish())
    expect(plane.draft().surveys[0]!.spec.speedMs).toBe(22)
    const unknown = setup({ vehicle: { kind: 'plane', params: new Map() } })
    unknown.drawRect()
    act(() => unknown.hook.result.current.finish())
    expect(unknown.draft().surveys[0]!.spec.speedMs).toBe(18)
  })

  it('uses the first built-in camera when the list has one', () => {
    const cam: SurveyCamera = { id: 7, name: 'Builtin', sensor_w_mm: 13.2, sensor_h_mm: 8.8, image_w_px: 5472, image_h_px: 3648, focal_mm: 8.8, shutter_s: 0.001, min_interval_s: 2, builtin: true }
    const { hook, drawRect, draft } = setup({ cameras: [{ ...cam, id: 3, name: 'Mine', builtin: false }, cam] })
    drawRect()
    act(() => hook.result.current.finish())
    expect(draft().surveys[0]!.spec.camera.name).toBe('Builtin')
  })

  it('fromKml creates a survey named after the placemark, without drawing', () => {
    const { hook, draft, select } = setup()
    act(() => hook.result.current.fromKml([...RECT], 'North field'))
    expect(draft().surveys[0]!.spec.name).toBe('North field')
    expect(select).toHaveBeenCalledWith(draft().surveys[0]!.uids[0])
    expect(hook.result.current.drawing).toBeNull()
  })
})
