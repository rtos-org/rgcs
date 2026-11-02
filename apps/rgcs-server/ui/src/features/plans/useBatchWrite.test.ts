import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mission, VehicleState } from '../../shared/api/types'
import { appendWaypoint, emptyDraft, toMission } from '../mission/model'
import { INITIAL_MISSION_UI, loaded } from '../mission/store'
import { addRow, assign, emptyWorkspace, type Workspace } from './model'
import { BatchStore } from './batchStore'
import type { SheetLine } from './BatchWriteSheet'
import { useBatchWrite } from './useBatchWrite'

const api = vi.hoisted(() => ({
  validateMission: vi.fn(),
  uploadMission: vi.fn(),
  uploadSavedMission: vi.fn(),
  writeFence: vi.fn(),
  writeRally: vi.fn(),
  readFence: vi.fn(),
  readRally: vi.fn(),
  getRegistry: vi.fn(),
}))
vi.mock('../mission/api', () => api)
vi.mock('../logbook/api', () => ({ getRegistry: api.getRegistry }))

const vehicle = (sysid: number, link: VehicleState['link'] = 'ok') => ({ sysid, name: `UAV-0${sysid}`, link }) as VehicleState
const mission = (name: string): Mission => ({ ...toMission(appendWaypoint(emptyDraft(), 35, 139)), name })

/** A on 1, B on 2 (lost link), C missing on 3, D unassigned. */
function workspace(): Workspace {
  const base = emptyWorkspace()
  const a: Workspace = { ...base, rows: base.rows.map((r) => ({ ...r, ui: loaded(INITIAL_MISSION_UI, mission('A'), 1) })) }
  const abcd = ['B', 'C', 'D'].reduce((w, n, i) => addRow(w, loaded(INITIAL_MISSION_UI, mission(n), i + 2)), a)
  const [ka, kb, kc] = abcd.rows.map((r) => r.key)
  const assigned = assign(assign(assign(abcd, ka!, 1), kb!, 2), kc!, 3)
  return { ...assigned, rows: assigned.rows.map((r) => (r.key === kc ? { ...r, missing: true } : r)) }
}

/** The board's lines: saved plan 10 + sysid → UAV-0n. */
const boardLine = (sysid: number, name: string): SheetLine => ({ key: `vehicle-${sysid}`, color: '#9cc9ff', name, sysid, vehicle: `UAV-0${sysid}`, distanceM: 100, mission: mission(name), savedId: 10 + sysid })
const BOARD = [boardLine(1, 'A'), boardLine(2, 'B')]
const jobsOf = (lines: readonly SheetLine[]) => lines.map((l) => ({ key: l.key, sysid: l.sysid, mission: l.mission, savedId: l.savedId, clearFence: false, clearRally: false }))

beforeEach(() => {
  vi.resetAllMocks()
  api.getRegistry.mockImplementation(async (sysid: number) => ({ endurance_minutes: sysid === 1 ? 20 : null }))
  api.validateMission.mockResolvedValue({ findings: [], stats: {} })
  api.uploadMission.mockResolvedValue({ items: 2, verified: true, mismatched: [], findings: [] })
  api.uploadSavedMission.mockResolvedValue({ items: 2, verified: true, mismatched: [], findings: [] })
  api.writeFence.mockResolvedValue({ items: 0, verified: true, mismatched: [], findings: [] })
  api.writeRally.mockResolvedValue({ items: 0, verified: true, mismatched: [], findings: [] })
  api.readFence.mockResolvedValue({ zones: [] })
  api.readRally.mockResolvedValue({ points: [] })
})

describe('useBatchWrite', () => {
  it('compares_every_row_but_the_missing_and_writes_the_board_lines', async () => {
    const vehicles = new Map([[1, vehicle(1)], [2, vehicle(2, 'lost')]])
    const onVerified = vi.fn()
    const store = new BatchStore()
    const { result } = renderHook(() => useBatchWrite(workspace(), vehicles, onVerified, store))
    expect(result.current.lines.map((l) => [l.name, l.vehicle])).toEqual([['A', 'UAV-01'], ['B', 'UAV-02'], ['D', null]])
    expect(result.current.canWrite).toBe(true)
    await waitFor(() => expect(result.current.lines[0]!.batteryPct).not.toBeNull())
    // nothing to write: no sheet
    act(() => result.current.open([]))
    expect(result.current.sheet).toBeNull()
    act(() => result.current.open(BOARD))
    expect(result.current.sheet?.lines.map((l) => l.name)).toEqual(['A', 'B'])
    await waitFor(() => expect(result.current.sheet?.leftovers).not.toBeNull())
    await act(async () => result.current.write(jobsOf(result.current.sheet!.lines)))
    const states = [...result.current.sheet!.states.values()].map((s) => [s.phase, s.reason])
    expect(states).toEqual([['done', null], ['failed', 'offline']])
    // the saved upload, by plan id: the server records the written plan
    expect(api.uploadSavedMission.mock.calls).toEqual([[1, 11]])
    expect(api.uploadMission).not.toHaveBeenCalled()
    expect(onVerified).toHaveBeenCalledWith(1, expect.objectContaining({ name: 'A' }))
    expect(result.current.sheet?.running).toBe(false)
  })

  it('a_running_batch_outlives_the_view_and_no_second_one_starts', async () => {
    const vehicles = new Map([[1, vehicle(1)], [2, vehicle(2)]])
    const store = new BatchStore()
    let release: (v: unknown) => void = () => {}
    api.uploadSavedMission.mockImplementationOnce(() => new Promise((r) => (release = r)))
    const first = renderHook(() => useBatchWrite(workspace(), vehicles, vi.fn(), store))
    act(() => first.result.current.open(BOARD))
    await waitFor(() => expect(first.result.current.sheet?.leftovers).not.toBeNull())
    const jobs = jobsOf(first.result.current.sheet!.lines)
    let running: Promise<void> = Promise.resolve()
    act(() => {
      running = first.result.current.write(jobs)
    })
    await waitFor(() => expect(api.uploadSavedMission).toHaveBeenCalledTimes(1))
    first.unmount()
    // back to the planner: the running batch is shown and nothing new can start
    const again = renderHook(() => useBatchWrite(workspace(), vehicles, vi.fn(), store))
    expect(again.result.current.canWrite).toBe(false)
    expect(again.result.current.sheet?.running).toBe(true)
    expect(again.result.current.sheet?.states.get(jobs[0]!.key)?.phase).toBe('writing')
    const session = again.result.current.sheet!.session
    act(() => again.result.current.open(BOARD))
    await act(async () => again.result.current.write(jobs))
    expect(again.result.current.sheet?.session).toBe(session)
    await act(async () => {
      release({ items: 2, verified: true, mismatched: [], findings: [] })
      await running
    })
    expect(api.uploadSavedMission).toHaveBeenCalledTimes(2)
    expect([...again.result.current.sheet!.states.values()].map((s) => s.phase)).toEqual(['done', 'done'])
    expect(again.result.current.canWrite).toBe(true)
  })
})
