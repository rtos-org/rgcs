import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Draft } from '../mission/model'
import { HOME, surveyDraft } from './surveyFixture'
import { useSurvey, type SurveyArgs } from './useSurvey'

/** A draft holder standing in for the mission store: `change` replaces the draft and counts commits. */
function setup(over: Partial<SurveyArgs> = {}) {
  const start = surveyDraft()
  let draft: Draft = start.draft
  const commits = vi.fn()
  const change = (fn: (d: Draft) => Draft) => {
    draft = fn(draft)
    commits()
  }
  const args = (): SurveyArgs => ({ draft, change, home: HOME, elevAt: null, vehicleParams: new Map(), ...over })
  const hook = renderHook(() => useSurvey(args()))
  return { id: start.id, hook, commits, draft: () => draft, rerender: () => hook.rerender() }
}

afterEach(() => vi.useRealTimers())

describe('useSurvey', () => {
  it('update_regenerates_the_items_in_one_commit', () => {
    const s = setup()
    const before = s.draft().surveys[0]!.uids
    act(() => s.hook.result.current.update(s.id, { altM: 120 }))
    expect(s.commits).toHaveBeenCalledTimes(1)
    const now = s.draft().surveys[0]!
    expect(now.spec.altM).toBe(120)
    expect(now.uids).not.toEqual(before)
  })

  it('an_invalid_patch_is_not_committed', () => {
    const s = setup()
    act(() => s.hook.result.current.update(s.id, { altM: 2 }))
    expect(s.commits).not.toHaveBeenCalled()
  })

  it('a_commit_that_yields_no_lanes_keeps_the_items_and_reports_rejected_until_the_next_good_commit', () => {
    const s = setup()
    const items = s.draft().items
    const poly = s.draft().surveys[0]!.spec.polygon
    act(() => s.hook.result.current.update(s.id, { polygon: poly.slice(0, 2) }))
    expect(s.commits).not.toHaveBeenCalled()
    expect(s.draft().items).toBe(items)
    s.rerender()
    expect(s.hook.result.current.rejected).toBe('invalid_polygon')
    act(() => s.hook.result.current.update(s.id, { altM: 120 }))
    expect(s.hook.result.current.rejected).toBeNull()
  })

  it('a_spec_failing_the_schema_is_rejected_as_invalid_spec', () => {
    const s = setup()
    act(() => s.hook.result.current.update(s.id, { altM: 2 }))
    expect(s.hook.result.current.rejected).toBe('invalid_spec')
  })

  it('a_change_making_the_survey_too_large_is_rejected_and_nothing_is_committed', () => {
    const s = setup()
    const poly = s.draft().surveys[0]!.spec.polygon
    // stretched about 33 km north at 95 % side overlap (5 m spacing): thousands of lanes
    act(() => s.hook.result.current.update(s.id, { polygon: poly.map((p, i) => (i >= 2 ? { ...p, lat: p.lat + 0.3 } : p)), sidePct: 95 }))
    expect(s.commits).not.toHaveBeenCalled()
    expect(s.hook.result.current.rejected).toBe('too_large')
  })

  it('rejected_belongs_to_the_survey_it_was_raised_for', () => {
    const s = setup()
    act(() => s.hook.result.current.update(s.id, { altM: 2 }))
    expect(s.hook.result.current.rejectedFor(s.id)).toBe('invalid_spec')
    expect(s.hook.result.current.rejectedFor('another')).toBeNull()
  })

  it('live_updates_preview_once_per_frame_and_done_commits_once', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] })
    const s = setup()
    const uid = s.draft().surveys[0]!.uids[0]!
    act(() => {
      s.hook.result.current.update(s.id, { angleDeg: 10 }, 'live')
      s.hook.result.current.update(s.id, { angleDeg: 20 }, 'live')
    })
    expect(s.hook.result.current.surveyFor(uid)?.spec.angleDeg).toBe(90)
    act(() => vi.advanceTimersToNextFrame())
    expect(s.hook.result.current.surveyFor(uid)?.spec.angleDeg).toBe(20)
    expect(s.hook.result.current.metrics(s.id)?.spec.angleDeg).toBe(20)
    expect(s.commits).not.toHaveBeenCalled()
    act(() => s.hook.result.current.update(s.id, { angleDeg: 30 }, 'done'))
    expect(s.commits).toHaveBeenCalledTimes(1)
    expect(s.draft().surveys[0]!.spec.angleDeg).toBe(30)
  })

  it('a_live_preview_does_not_run_the_predictor_and_keeps_the_committed_entry_check', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] })
    // a predicted path far from every shooting start: the committed survey misses its entries
    const predict = vi.fn(() => ({ home: HOME, points: [{ lat: 0, lon: 0, alt: 0 }] }))
    const s = setup({ predict })
    expect(s.hook.result.current.metrics(s.id)?.warnings).toContain('entry')
    const calls = predict.mock.calls.length
    act(() => s.hook.result.current.update(s.id, { angleDeg: 20 }, 'live'))
    act(() => vi.advanceTimersToNextFrame())
    const m = s.hook.result.current.metrics(s.id)!
    expect(m.spec.angleDeg).toBe(20)
    expect(m.warnings).toContain('entry')
    expect(predict).toHaveBeenCalledTimes(calls)
    act(() => s.hook.result.current.update(s.id, { angleDeg: 20 }, 'done'))
    s.rerender()
    s.hook.result.current.metrics(s.id)
    expect(predict).toHaveBeenCalledTimes(calls + 1)
  })

  it('cancel_drops_a_preview_without_a_commit', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] })
    const s = setup()
    act(() => s.hook.result.current.update(s.id, { angleDeg: 20 }, 'live'))
    act(() => vi.advanceTimersToNextFrame())
    expect(s.hook.result.current.preview).not.toBeNull()
    act(() => s.hook.result.current.cancel())
    expect(s.hook.result.current.preview).toBeNull()
    act(() => s.hook.result.current.update(s.id, {}, 'done'))
    expect(s.commits).not.toHaveBeenCalled()
  })

  it('metrics_has_numbers_ground_and_worst_case_from_the_terrain', () => {
    const elevAt = (lon: number) => (lon > HOME.lon ? 40 : 0)
    const s = setup({ elevAt })
    const m = s.hook.result.current.metrics(s.id)!
    expect(m.numbers.lanes).toBeGreaterThan(0)
    expect(m.ground).toEqual({ min: 40, max: 40 })
    expect(m.worst?.minGsdCm).toBeLessThan(m.worst!.gsdCm + 1e-9)
    expect(m.warnings).toContain('wp_radius')
    expect(s.hook.result.current.metrics(s.id)).toBe(m)
  })

  it('the_bank_warning_uses_the_vehicle_roll_limit', () => {
    const s = setup({ vehicleParams: new Map([['ROLL_LIMIT_DEG', 25]]) })
    const m = s.hook.result.current.metrics(s.id)!
    expect(m.rollLimitDeg).toBe(25)
    expect(m.warnings).toContain('bank')
  })

  it('expand_removes_the_tag_and_keeps_the_items', () => {
    const s = setup()
    const n = s.draft().items.length
    act(() => s.hook.result.current.expand(s.id))
    expect(s.draft().surveys).toEqual([])
    expect(s.draft().items).toHaveLength(n)
  })
})
