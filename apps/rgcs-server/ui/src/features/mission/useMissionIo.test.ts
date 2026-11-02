import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mission } from '../../shared/api/types'
import { t } from '../../shared/i18n'
import { PlanSetStore } from '../plans/store'
import type { VehicleStore } from '../vehicles/store'
import { appendWaypoint, emptyDraft, toMission } from './model'
import { INITIAL_MISSION_UI, MissionStore, edit, loaded } from './store'
import { useMissionIo } from './useMissionIo'

const api = vi.hoisted(() => ({
  validateMission: vi.fn(),
  uploadMission: vi.fn(),
  uploadSavedMission: vi.fn(),
}))
vi.mock('./api', async (orig) => ({ ...(await orig<typeof import('./api')>()), ...api }))

const dict = t('ja')
const REPORT = { items: 2, verified: true, mismatched: [], findings: [] }
const mission = (): Mission => ({ ...toMission(appendWaypoint(emptyDraft(), 36.25, 137.64)), name: 'p7' })

function setup(dirty: boolean) {
  const store = new MissionStore()
  store.update(() => loaded(INITIAL_MISSION_UI, mission(), 7))
  if (dirty) store.update((u) => edit(u, appendWaypoint(u.history.present, 36.26, 137.64)))
  const vehicles = { pushLocalResult: vi.fn(), setVehicleMission: vi.fn() } as unknown as VehicleStore
  const { result } = renderHook(() => useMissionIo(store, new PlanSetStore(), 1, dict, vehicles))
  return { store, vehicles, result }
}

beforeEach(() => {
  vi.resetAllMocks()
  api.validateMission.mockResolvedValue({ findings: [], stats: {} })
  api.uploadMission.mockResolvedValue(REPORT)
  api.uploadSavedMission.mockResolvedValue(REPORT)
})

describe('useMissionIo upload', () => {
  it('a_saved_clean_plan_uses_the_saved_upload', async () => {
    const { store, vehicles, result } = setup(false)
    await act(async () => result.current.upload())
    expect(api.validateMission).toHaveBeenCalledWith(expect.objectContaining({ name: 'p7' }), 1)
    expect(api.uploadSavedMission.mock.calls).toEqual([[1, 7]])
    expect(api.uploadMission).not.toHaveBeenCalled()
    // the same report and pill as the content upload
    expect(store.getState().lastReport).toEqual(REPORT)
    expect(vehicles.setVehicleMission).toHaveBeenCalledWith(1, expect.objectContaining({ name: 'p7', sysid: 1 }))
    expect(vi.mocked(vehicles.pushLocalResult).mock.calls[0]?.[0]).toMatchObject({ cmd: 'mission_upload', ok: true, sysid: 1 })
  })

  it('a_dirty_plan_uses_the_content_upload', async () => {
    const { store, result } = setup(true)
    expect(store.getState().dirty).toBe(true)
    await act(async () => result.current.upload())
    expect(api.uploadMission).toHaveBeenCalledTimes(1)
    expect(api.uploadMission.mock.calls[0]?.[1].items).toHaveLength(store.getState().history.present.items.length)
    expect(api.uploadSavedMission).not.toHaveBeenCalled()
  })

  it('an_unsaved_plan_uses_the_content_upload', async () => {
    const { store, result } = setup(false)
    store.update((u) => ({ ...u, savedId: null }))
    await act(async () => result.current.upload())
    expect(api.uploadMission).toHaveBeenCalledTimes(1)
    expect(api.uploadSavedMission).not.toHaveBeenCalled()
  })
})
