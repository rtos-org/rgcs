import { describe, expect, it } from 'vitest'
import type { Mission, MissionItem } from '../../shared/api/types'
import { clearItems, emptyDraft, fromMission, insertAfter, remapJumps, toMission, updateItem } from '../mission/model'
import { addSurvey, expandSurvey, insertAnchor, reconcileSurveys, regenerateSurvey, surveyAt } from './draftOps'
import { surveyDraft } from './surveyFixture'
import { ALPHA7R4, defaultSpec, type SurveySpec } from './spec'

const wp = (lat: number): MissionItem => ({ command: 16, frame: 'rel', params: [0, 0, 0, 0], lat, lon: 139, alt: 100, autocontinue: true })
const jump = (seq: number): MissionItem => ({ command: 177, frame: 'rel', params: [seq, 1, 0, 0], lat: 0, lon: 0, alt: 0, autocontinue: true })
const spec = (name: string): SurveySpec => ({ ...defaultSpec([{ lat: 36, lon: 139 }, { lat: 36.01, lon: 139 }, { lat: 36.01, lon: 139.01 }], ALPHA7R4, 'plane'), name })

const mission = (): Mission => ({
  ...emptyDraft().mission,
  items: [wp(1), wp(2), wp(3), wp(4), wp(5), wp(6), wp(7)],
  surveys: [
    { id: 'a', first: 1, count: 2, spec: spec('A') },
    { id: 'b', first: 4, count: 3, spec: spec('B') },
  ],
})

describe('surveys in the draft', () => {
  it('round_trips_two_surveys_through_the_draft', () => {
    const m = mission()
    const d = fromMission(m)
    expect(d.surveys.map((s) => s.uids)).toEqual([[2, 3], [5, 6, 7]])
    expect('surveys' in d.mission).toBe(false)
    expect(toMission(d)).toEqual(m)
  })

  it('drops_a_block_with_a_bad_spec_or_range_on_load_and_keeps_the_items', () => {
    const m = mission()
    const bad: Mission = { ...m, surveys: [{ id: 'x', first: 0, count: 2, spec: { name: 'nope' } }, { id: 'y', first: 5, count: 9, spec: spec('Y') }, ...m.surveys] }
    const d = fromMission(bad)
    expect(d.items).toHaveLength(7)
    expect(d.surveys.map((s) => s.id)).toEqual(['a', 'b'])
  })

  it('a_huge_count_is_dropped_without_allocating', () => {
    for (const count of [5e9, 3e7]) {
      const started = performance.now()
      const d = fromMission({ ...mission(), surveys: [{ id: 'h', first: 0, count, spec: spec('H') }] })
      expect(performance.now() - started).toBeLessThan(100)
      expect(d.surveys).toEqual([])
      expect(d.items).toHaveLength(7)
    }
  })

  it('inserting_a_waypoint_before_a_survey_keeps_it_and_shifts_first', () => {
    const prev = fromMission(mission())
    const next = insertAfter(prev, 1, 36, 139)
    const { draft, dropped } = reconcileSurveys(prev, next)
    expect(dropped).toEqual([])
    expect(toMission(draft).surveys.map((s) => s.first)).toEqual([2, 5])
  })

  it('an_edit_inside_a_survey_drops_it_and_reports_its_name', () => {
    const prev = fromMission(mission())
    const { draft, dropped } = reconcileSurveys(prev, updateItem(prev, 6, { alt: 3 }))
    expect(dropped).toEqual(['B'])
    expect(draft.surveys.map((s) => s.id)).toEqual(['a'])
    expect(draft.items).toHaveLength(7)
  })

  it('add_survey_inserts_tagged_items_with_fresh_uids', () => {
    const base = fromMission({ ...mission(), surveys: [] })
    const { draft, id } = addSurvey(base, 1, spec('N'), [wp(10), wp(11)])
    const s = surveyAt(draft, 8)
    expect(s?.id).toBe(id)
    expect(s?.uids).toEqual([8, 9])
    expect(draft.items.map((it) => it.uid).slice(0, 3)).toEqual([1, 8, 9])
    expect(reconcileSurveys(base, draft).dropped).toEqual([])
    expect(surveyAt(draft, 1)).toBeNull()
  })

  it('regenerate_with_fewer_items_shrinks_the_range_and_keeps_jumps', () => {
    const m: Mission = { ...mission(), items: [...mission().items, jump(4), jump(7)] }
    const prev = fromMission(m)
    const regen = regenerateSurvey(prev, 'a', spec('A2'), [wp(20)])
    const next = remapJumps(prev, regen)
    const { draft, dropped } = reconcileSurveys(prev, next)
    expect(dropped).toEqual([])
    const out = toMission(draft)
    expect(out.items.map((it) => it.lat)).toEqual([1, 20, 4, 5, 6, 7, 0, 0])
    expect(out.surveys).toMatchObject([{ id: 'a', first: 1, count: 1, spec: { name: 'A2' } }, { id: 'b', first: 3, count: 3 }])
    expect(out.items.slice(6).map((it) => it.params[0])).toEqual([3, 6])
    expect(draft.items[1]!.uid).toBeGreaterThan(9)
  })

  it('expand_keeps_the_items_and_removes_the_tag', () => {
    const d = fromMission(mission())
    const e = expandSurvey(d, 'b')
    expect(e.items).toBe(d.items)
    expect(e.surveys.map((s) => s.id)).toEqual(['a'])
    expect(surveyAt(e, 6)).toBeNull()
  })
})

describe('insertAnchor', () => {
  it('maps an item inside a survey to the survey\'s last item; others and null pass through', () => {
    const { draft } = surveyDraft()
    const uids = draft.surveys[0]!.uids
    expect(insertAnchor(draft, uids[2]!)).toBe(uids.at(-1))
    expect(insertAnchor(draft, 9999)).toBe(9999)
    expect(insertAnchor(draft, null)).toBeNull()
  })
})

describe('clearing the list', () => {
  it('removes the surveys with their items, so no detach notice names them', () => {
    const { draft } = surveyDraft()
    const cleared = clearItems(draft)
    expect(cleared.items).toEqual([])
    expect(cleared.surveys).toEqual([])
    expect(reconcileSurveys(draft, cleared).dropped).toEqual([])
  })
})
