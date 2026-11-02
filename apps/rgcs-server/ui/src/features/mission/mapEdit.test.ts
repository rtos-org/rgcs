import { describe, expect, it } from 'vitest'
import { altFromDrag, badgeEl, uidsInBox, dragDelta, handleEl, midHandles, updateBadgeEl } from './mapEdit'
import { appendWaypoint, emptyDraft, insertAfter, setCommand } from './model'
import { addSurvey } from '../survey/draftOps'
import { generateSurvey } from '../survey/generate'
import { fixtureSpec, HOME } from '../survey/surveyFixture'

describe('map editing helpers', () => {
  it('badge_element_shows_seq_and_selected_class', () => {
    const el = badgeEl(3, true, 'WAYPOINT')
    expect(el.className).toBe('rg-wp sel')
    expect(el.textContent).toBe('3')
    expect(el.title).toBe('MAV_CMD_NAV_WAYPOINT')
    updateBadgeEl(el, 4, false, 'TAKEOFF')
    expect(el.className).toBe('rg-wp')
    expect(el.textContent).toBe('T')
    expect(el.title).toBe('MAV_CMD_NAV_TAKEOFF')
    expect(handleEl().className).toBe('rg-mid')
  })

  it('mid_handles_sit_between_consecutive_positioned_items', () => {
    const d = appendWaypoint(appendWaypoint(appendWaypoint(emptyDraft(), 36.1, 139.1), 36.2, 139.2), 36.3, 139.3)
    const hs = midHandles(d)
    expect(hs.map((h) => h.afterUid)).toEqual([1, 2])
    expect(hs[0]!.lat).toBeCloseTo(36.15, 9)
    expect(hs[0]!.lon).toBeCloseTo(139.15, 9)
    expect(hs[1]!.lat).toBeCloseTo(36.25, 9)
    // a DO_ command between two waypoints is skipped, and the handle inserts after the DO_ item
    const withDo = setCommand(appendWaypoint(d, 36.4, 139.4), 3, 'DO_CHANGE_SPEED')
    expect(midHandles(withDo).map((h) => h.afterUid)).toEqual([1, 3])
    expect(midHandles(emptyDraft())).toEqual([])
    // each handle knows its leg: from the previous position to the leg's end item
    expect(hs.map((h) => [h.fromLat, h.toUid])).toEqual([
      [36.1, 2],
      [36.2, 3],
    ])
  })

  it('drag_delta_is_the_difference_of_lat_lon', () => {
    expect(dragDelta({ lat: 36, lon: 139 }, { lat: 36.5, lon: 139.25 })).toEqual({ dLat: 0.5, dLon: 0.25 })
  })
  it('shows the altitude chip in 3D and removes it in 2D', () => {
    const el = badgeEl(1, false, 'WAYPOINT')
    updateBadgeEl(el, 1, false, 'WAYPOINT', '▲ 80 m Rel')
    expect(el.querySelector('.chips .chip.altc')?.textContent).toBe('▲ 80 m Rel')
    updateBadgeEl(el, 1, false, 'WAYPOINT', null)
    expect(el.querySelector('.chips')).toBeNull()
  })
})

describe('altFromDrag', () => {
  it('turns a vertical drag into whole metres (up is higher)', () => {
    expect(altFromDrag(80, -50, 2)).toBe(105)
    expect(altFromDrag(80, 31, 2)).toBe(65)
  })
  it('keeps the altitude when the scale is unknown or degenerate', () => {
    expect(altFromDrag(80, -50, null)).toBe(80)
    expect(altFromDrag(80, -50, 0)).toBe(80)
  })
})

describe('uidsInBox', () => {
  it('keeps the items whose on-screen centre is inside the box, whichever way it was dragged', () => {
    const at = [
      { uid: 1, x: 10, y: 10 },
      { uid: 2, x: 50, y: 60 },
      { uid: 3, x: 200, y: 20 },
    ]
    expect(uidsInBox(at, { x0: 0, y0: 0, x1: 100, y1: 100 })).toEqual([1, 2])
    expect(uidsInBox(at, { x0: 100, y0: 100, x1: 40, y1: 50 })).toEqual([2])
  })

  it('the "+" on the leg entering a survey inserts before the whole survey, so it stays attached', () => {
    const spec = fixtureSpec()
    const gen = generateSurvey(spec, HOME)
    if ('error' in gen) throw new Error(gen.error)
    const before = appendWaypoint(appendWaypoint(emptyDraft(), HOME.lat, HOME.lon), HOME.lat + 0.001, HOME.lon)
    const { draft } = addSurvey(before, before.items.at(-1)!.uid, spec, gen.items)
    const survey = draft.surveys[0]!
    expect(draft.items.find((it) => it.uid === survey.uids[0])!.command).not.toBe('WAYPOINT') // leading DO_CHANGE_SPEED
    const entering = midHandles(draft).find((h) => h.toUid === survey.uids.find((u) => draft.items.find((it) => it.uid === u)!.lat !== 0))!
    expect(entering.afterUid).toBe(before.items.at(-1)!.uid)
    const after = insertAfter(draft, entering.afterUid, entering.lat, entering.lon)
    const first = after.items.findIndex((it) => it.uid === survey.uids[0])
    expect(after.items.slice(first, first + survey.uids.length).map((it) => it.uid)).toEqual(survey.uids)
  })
})
