// Survey items in the mission screen's generic edit paths: the detach notice,
// Delete / context-menu delete taking the whole survey, nudges ignoring it, and keys inside the panel.
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { t } from '../../shared/i18n'
import { surveyDraft } from '../survey/surveyFixture'

let contextUid = 0
vi.mock('./MissionMap', () => ({
  MissionMap: (p: { onContext: (m: { uid: number; x: number; y: number }) => void }) => (
    <button type="button" data-testid="mission-map" onClick={() => p.onContext({ uid: contextUid, x: 0, y: 0 })}>
      map-context
    </button>
  ),
}))

const { MissionView } = await import('./MissionView')
const { MissionStore, edit, selectOne } = await import('./store')
const { appendWaypoint, updateItem } = await import('./model')
const { PlanSetStore } = await import('../plans/store')
const { rasterStyle } = await import('../map/style')

const dict = t('ja')
const envelope = (data: unknown) => new Response(JSON.stringify({ success: true, data }), { status: 200, headers: { 'content-type': 'application/json' } })

/** A survey then one plain waypoint; `select` picks the selected uid (default: the survey's second item). */
function seeded(select?: (survey: readonly number[], plain: number) => number) {
  vi.stubGlobal('fetch', vi.fn<typeof fetch>(async () => envelope([])))
  const store = new MissionStore()
  const d = appendWaypoint(surveyDraft().draft, 36.3, 139.1)
  const survey = d.surveys[0]!.uids
  const plain = d.items.at(-1)!.uid
  store.update((u) => selectOne(edit(u, d), select ? select(survey, plain) : survey[1]!, false))
  render(<MissionView vehicles={new Map()} dict={dict} style={rasterStyle('https://t/{z}/{x}/{y}.png', 'x')} store={store} plans={new PlanSetStore()} />)
  return { store, survey, plain }
}
const view = () => screen.getByTestId('mission-view')
const present = (store: InstanceType<typeof MissionStore>) => store.getState().history.present

describe('MissionView: survey items in generic edits', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('Delete with a survey item selected removes the whole survey as one undo step', () => {
    const { store, plain } = seeded()
    const past = store.getState().history.past.length
    fireEvent.keyDown(view(), { key: 'Delete' })
    expect(present(store).items.map((it) => it.uid)).toEqual([plain])
    expect(present(store).surveys).toEqual([])
    expect(store.getState().history.past).toHaveLength(past + 1)
  })

  it('the context-menu delete on a survey item removes the whole survey', () => {
    const { store, survey, plain } = seeded()
    contextUid = survey[4]!
    fireEvent.click(screen.getByTestId('mission-map'))
    fireEvent.click(screen.getByRole('menuitem', { name: dict.mDeleteItem }))
    expect(present(store).items.map((it) => it.uid)).toEqual([plain])
    expect(present(store).surveys).toEqual([])
  })

  it('arrow-key nudges leave a selected survey alone (no undo step)', () => {
    const { store } = seeded()
    const before = store.getState().history
    fireEvent.keyDown(view(), { key: 'ArrowUp' })
    expect(store.getState().history).toBe(before)
  })

  it('keys inside the survey panel or on a button are not editor shortcuts', () => {
    const { store } = seeded()
    const before = store.getState().history
    const panelButton = screen.getByRole('button', { name: dict.svExpand })
    fireEvent.keyDown(panelButton, { key: 'Backspace' })
    fireEvent.keyDown(screen.getByRole('button', { name: dict.svTurnSplit }), { key: 'Delete' })
    fireEvent.keyDown(screen.getByRole('button', { name: dict.mToolAdd }), { key: 'Delete' })
    expect(store.getState().history).toBe(before)
  })

  it('an edit that detaches a survey shows the notice once per name; Undo restores the survey', () => {
    const { store, survey } = seeded()
    act(() => store.update((u) => edit(u, updateItem(u.history.present, survey[2]!, { alt: 7 }))))
    const text = dict.svNotice.replace('{names}', 'Field')
    expect(screen.getByRole('status')).toHaveTextContent(text)
    fireEvent.click(within(screen.getByRole('status')).getByRole('button', { name: dict.svNoticeUndo }))
    expect(present(store).surveys).toHaveLength(1)
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('the notice can be closed, and names repeat only once', () => {
    const { store } = seeded()
    act(() => store.update((u) => ({ ...u, surveyNotice: ['Field', 'Field', 'North'] })))
    expect(screen.getByRole('status')).toHaveTextContent(dict.svNotice.replace('{names}', 'Field、North'))
    fireEvent.click(within(screen.getByRole('status')).getByRole('button', { name: dict.close }))
    expect(screen.queryByRole('status')).toBeNull()
  })
})
