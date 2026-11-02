// A fence / rally read from the vehicle lands only in the mission that asked for it (spec 2026-10-20 §8):
// a row switch while it runs drops the result instead of filling the new active mission.
import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { FenceZone, Mission } from '../../shared/api/types'
import { t } from '../../shared/i18n'

const pending: { resolve: (v: { zones: FenceZone[] }) => void }[] = []
vi.mock('./api', () => ({
  readFence: vi.fn(() => new Promise((resolve) => pending.push({ resolve }))),
  readFenceParams: vi.fn(() => new Promise(() => undefined)),
  readRally: vi.fn(),
  setFenceAltMax: vi.fn(),
  writeFence: vi.fn(),
  writeRally: vi.fn(),
}))

const { usePlanEditor } = await import('./planEditor')
const { MissionStore, INITIAL_MISSION_UI, edit, loaded } = await import('./store')
const { appendWaypoint, emptyDraft, toMission } = await import('./model')
const { PlanSetStore, openInNewRow, switchRow } = await import('../plans/store')
const { vehicleStore } = await import('../vehicles/store')

const ZONE: FenceZone = { kind: 'circle', inclusion: true, center: { lat: 35, lon: 139 }, radius: 100 }
const dict = t('ja')
const mission = (name: string): Mission => ({ ...toMission(appendWaypoint(emptyDraft(), 36, 139)), name })

function setup() {
  localStorage.setItem('rgcs.planTab', 'fence')
  const m = new MissionStore()
  const b = new PlanSetStore()
  m.update(() => loaded(INITIAL_MISSION_UI, mission('Alpha'), null))
  openInNewRow(b, m, loaded(INITIAL_MISSION_UI, mission('Beta'), null))
  switchRow(b, m, b.getState().rows[0]!.key)
  const change = (fn: (d: ReturnType<typeof emptyDraft>) => ReturnType<typeof emptyDraft>) => m.update((u) => edit(u, fn(u.history.present)))
  const hook = renderHook(() => usePlanEditor({ draft: m.getState().history.present, sysid: 1, dict, change, home: null, onFit: () => undefined, store: m }))
  return { m, b, hook }
}

describe('usePlanEditor read', () => {
  afterEach(() => {
    pending.length = 0
    localStorage.removeItem('rgcs.planTab')
  })

  it('a_fence_read_finishing_after_a_row_switch_leaves_the_new_mission_alone', async () => {
    const { m, b, hook } = setup()
    expect(m.getState().history.present.mission.name).toBe('Alpha')
    act(() => hook.result.current.read())
    switchRow(b, m, b.getState().rows[1]!.key)
    expect(m.getState().history.present.mission.name).toBe('Beta')
    const before = vehicleStore.getState().results.length
    await act(async () => pending[0]!.resolve({ zones: [ZONE] }))
    expect(m.getState().history.present.mission.fence).toEqual([])
    expect(b.getState().rows[0]!.ui.history.present.mission.fence).toEqual([])
    expect(hook.result.current.status?.ok).toBe(false)
    expect(vehicleStore.getState().results.length).toBe(before + 1)
  })

  it('a_fence_read_on_the_same_mission_applies_even_after_an_edit', async () => {
    const { m, hook } = setup()
    act(() => hook.result.current.read())
    m.update((u) => edit(u, appendWaypoint(u.history.present, 36.1, 139)))
    await act(async () => pending[0]!.resolve({ zones: [ZONE] }))
    expect(m.getState().history.present.mission.fence).toEqual([ZONE])
    expect(m.getState().history.present.items).toHaveLength(2)
    expect(hook.result.current.status?.ok).toBe(true)
  })
})
