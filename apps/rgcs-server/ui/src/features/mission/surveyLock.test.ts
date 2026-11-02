// Survey items are read-only in every generic edit path: only the survey ops change them.
import { describe, expect, it } from 'vitest'
import type { Mission, MissionItem } from '../../shared/api/types'
import { removeSurvey, removeWithSurveys } from '../survey/draftOps'
import { ALPHA7R4, defaultSpec } from '../survey/spec'
import { midHandles } from './mapEdit'
import { emptyDraft, fromMission, moveItem, moveItems, setAltBulk, setArc, shiftAlts } from './model'
import { INITIAL_MISSION_UI, loaded, removeSelected, selectOne, undoUi } from './store'

const wp = (lat: number): MissionItem => ({ command: 16, frame: 'rel', params: [0, 0, 0, 0], lat, lon: 139, alt: 100, autocontinue: true })
const spec = { ...defaultSpec([], ALPHA7R4, 'plane'), name: 'Field' }
/** Items 1..5; the survey 's' holds uids 2–4. */
const mission = (): Mission => ({ ...emptyDraft().mission, items: [wp(36.1), wp(36.2), wp(36.3), wp(36.4), wp(36.5)], surveys: [{ id: 's', first: 1, count: 3, spec }] })
const draft = () => fromMission(mission())
const lats = (d: ReturnType<typeof draft>) => d.items.map((it) => it.lat)

describe('survey items are read-only to generic edits', () => {
  it('moveItems / moveItem leave survey items where they are', () => {
    const d = draft()
    const moved = moveItems(d, new Set([1, 2, 3]), 0.5, 0)
    expect(lats(moved)).toEqual([36.6, 36.2, 36.3, 36.4, 36.5])
    expect(moved.items[1]).toBe(d.items[1])
    expect(moveItem(d, 3, 10, 10)).toBe(d)
  })

  it('shiftAlts / setAltBulk ignore survey items', () => {
    const d = draft()
    expect(shiftAlts(d, new Set([1, 2]), 10).items.map((it) => it.alt)).toEqual([110, 100, 100, 100, 100])
    expect(setAltBulk(d, new Set([2, 5]), 40, 'abs').items.map((it) => it.alt)).toEqual([100, 100, 100, 100, 40])
  })

  it('setArc does not bend a survey leg', () => {
    const d = draft()
    expect(setArc(d, 3, 45)).toBe(d)
    expect(setArc(d, 5, 45).items[4]!.command).toBe(36)
  })

  it('no mid-leg "+" on a leg whose both ends are inside one survey', () => {
    // legs 1→2 (into the survey) and 4→5 (out of it) keep their handles
    expect(midHandles(draft()).map((h) => h.toUid)).toEqual([2, 5])
  })
})

describe('deleting a survey item deletes the whole survey', () => {
  it('removeSurvey drops its items and its tag', () => {
    const d = removeSurvey(draft(), 's')
    expect(d.items.map((it) => it.uid)).toEqual([1, 5])
    expect(d.surveys).toEqual([])
    expect(removeSurvey(d, 'nope')).toBe(d)
  })

  it('removeWithSurveys widens the set to every survey it touches', () => {
    const d = removeWithSurveys(draft(), new Set([1, 3]))
    expect(d.items.map((it) => it.uid)).toEqual([5])
    expect(d.surveys).toEqual([])
  })

  it('Delete with a survey item selected removes the survey in one undo step, without the detach notice', () => {
    const ui = selectOne(loaded(INITIAL_MISSION_UI, mission(), null), 3, false)
    const next = removeSelected(ui)
    expect(next.history.present.items.map((it) => it.uid)).toEqual([1, 5])
    expect(next.history.present.surveys).toEqual([])
    expect(next.surveyNotice).toEqual([])
    expect(next.history.past).toHaveLength(1)
    const back = undoUi(next).history.present
    expect(back.items).toHaveLength(5)
    expect(back.surveys).toHaveLength(1)
  })
})
