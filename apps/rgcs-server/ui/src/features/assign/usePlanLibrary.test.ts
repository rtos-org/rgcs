import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Mission, MissionSummaryRow } from '../../shared/api/types'
import { INITIAL_MISSION_UI, MissionStore, loaded } from '../mission/store'
import { addRow, emptyWorkspace } from '../plans/model'
import { PlanSetStore } from '../plans/store'
import { clearPlanLibraryCache, planLibraryChanged, usePlanLibrary, type LibraryApi } from './usePlanLibrary'

const mission = (id: number, name: string): Mission => ({ id, name, sysid: null, default_alt: 50, default_frame: 'global_relative_alt', speed: 10, home: null, items: [], fence: [], rally: [], surveys: [] }) as unknown as Mission
const summary = (id: number, name: string, updated_at: number): MissionSummaryRow => ({ id, name, sysid: null, item_count: 0, updated_at })

function setup(rows: () => MissionSummaryRow[]) {
  const api: LibraryApi = {
    list: vi.fn(async () => rows()),
    get: vi.fn(async (id: number) => mission(id, `full ${id}`)),
  }
  const plans = new PlanSetStore()
  const editor = new MissionStore()
  return { api, plans, editor }
}

afterEach(() => clearPlanLibraryCache())

describe('usePlanLibrary', () => {
  it('loads_summaries_then_full_plans', async () => {
    const { api, plans, editor } = setup(() => [summary(1, 'A', 10), summary(2, 'B', 20)])
    const { result } = renderHook(() => usePlanLibrary({ api, plans, editor }))
    expect(result.current.plans).toBeNull()
    await waitFor(() => expect(result.current.plans).not.toBeNull())
    expect(result.current.plans?.map((p) => [p.id, p.name, p.updated_at, p.mission.name, p.dirty])).toEqual([
      [1, 'A', 10, 'full 1', false],
      [2, 'B', 20, 'full 2', false],
    ])
    expect(api.get).toHaveBeenCalledTimes(2)
    expect(result.current.error).toBeNull()
  })

  it('cached_by_version', async () => {
    let version = 10
    const { api, plans, editor } = setup(() => [summary(1, 'A', version)])
    const { result } = renderHook(() => usePlanLibrary({ api, plans, editor }))
    await waitFor(() => expect(result.current.plans).toHaveLength(1))
    act(() => result.current.reload())
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(result.current.plans).toHaveLength(1))
    expect(api.get).toHaveBeenCalledTimes(1)
    version = 11
    act(() => result.current.reload())
    await waitFor(() => expect(result.current.plans?.[0].updated_at).toBe(11))
    expect(api.get).toHaveBeenCalledTimes(2)
  })

  it('marks_open_dirty_plans', async () => {
    const { api, plans, editor } = setup(() => [summary(1, 'A', 10), summary(2, 'B', 20), summary(3, 'C', 30)])
    // row for plan 1 parked with unsaved edits; row for plan 2 parked clean; plan 3 is the live editor, dirty
    const parkedDirty = { ...loaded(INITIAL_MISSION_UI, mission(1, 'A'), 1), dirty: true }
    const parkedClean = loaded(INITIAL_MISSION_UI, mission(2, 'B'), 2)
    const live = loaded(INITIAL_MISSION_UI, mission(3, 'C'), 3)
    plans.update(() => addRow(addRow(addRow(emptyWorkspace(), parkedDirty), parkedClean), live))
    editor.update(() => ({ ...live, dirty: true }))
    const { result } = renderHook(() => usePlanLibrary({ api, plans, editor }))
    await waitFor(() => expect(result.current.plans).toHaveLength(3))
    expect(result.current.plans?.map((p) => p.dirty)).toEqual([true, false, true])
    act(() => editor.update((u) => ({ ...u, dirty: false })))
    expect(result.current.plans?.map((p) => p.dirty)).toEqual([true, false, false])
  })

  it('refreshes_after_a_save_signal', async () => {
    let rows = [summary(1, 'A', 10)]
    const { api, plans, editor } = setup(() => rows)
    const { result } = renderHook(() => usePlanLibrary({ api, plans, editor }))
    await waitFor(() => expect(result.current.plans).toHaveLength(1))
    rows = [summary(1, 'A', 10), summary(2, 'B', 20)]
    act(() => planLibraryChanged())
    await waitFor(() => expect(result.current.plans).toHaveLength(2))
  })

  it('reports_a_failed_list', async () => {
    const { api, plans, editor } = setup(() => {
      throw new Error('boom')
    })
    const { result } = renderHook(() => usePlanLibrary({ api, plans, editor }))
    await waitFor(() => expect(result.current.error).toBe('boom'))
  })
})
