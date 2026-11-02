import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../shared/api/client'
import type { Assignment, CommandResult, ServerMessage } from '../../shared/api/types'
import type { FrameSource } from '../vehicles/store'
import { AssignmentStore, type AssignApi } from './store'

const row = (sysid: number, plan_id: number | null, extra: Partial<Assignment> = {}): Assignment => ({ sysid, plan_id, assigned_by: 'admin', assigned_at: 1, written: null, ...extra })

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function setup(api: Partial<AssignApi> = {}) {
  const full: AssignApi = { list: vi.fn(async () => []), put: vi.fn(async (sysid: number, planId: number | null) => row(sysid, planId)), ...api }
  const results: CommandResult[] = []
  const store = new AssignmentStore(full, { pushLocalResult: (r) => results.push(r) })
  return { store, api: full, results }
}

function frames() {
  const listeners = new Set<(m: ServerMessage) => void>()
  const source: FrameSource = {
    onFrame: (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
  }
  return { source, emit: (m: ServerMessage) => listeners.forEach((l) => l(m)), count: () => listeners.size }
}

describe('AssignmentStore', () => {
  it('load_fills_from_get', async () => {
    const { store } = setup({ list: vi.fn(async () => [row(1, 10), row(2, null)]) })
    const seen = vi.fn()
    store.subscribe(seen)
    await store.load()
    expect(store.getState().get(1)?.plan_id).toBe(10)
    expect(store.getState().get(2)?.plan_id).toBeNull()
    expect(store.getState().size).toBe(2)
    expect(seen).toHaveBeenCalled()
  })

  it('set_is_optimistic_and_sent', async () => {
    const put = deferred<Assignment>()
    const { store, api, results } = setup({ list: vi.fn(async () => [row(1, 10)]), put: vi.fn(() => put.promise) })
    await store.load()
    const before = store.getState()
    const done = store.set(1, 20)
    expect(store.getState().get(1)?.plan_id).toBe(20)
    expect(before.get(1)?.plan_id).toBe(10) // the old map is never mutated
    expect(api.put).toHaveBeenCalledWith(1, 20)
    put.resolve(row(1, 20, { assigned_at: 99 }))
    await done
    expect(store.getState().get(1)?.assigned_at).toBe(99)
    expect(results).toEqual([])
  })

  it('set_on_an_unknown_vehicle_adds_a_row', async () => {
    const { store } = setup()
    const done = store.set(3, 7)
    expect(store.getState().get(3)).toMatchObject({ sysid: 3, plan_id: 7, written: null })
    await done
  })

  it('set_rolls_back_on_failure_and_reports', async () => {
    const put = vi.fn(async (): Promise<Assignment> => {
      throw new ApiError(404, 'not_found', 'plan 20 not found')
    })
    const { store, results } = setup({ list: vi.fn(async () => [row(1, 10)]), put })
    await store.load()
    await store.set(1, 20)
    expect(store.getState().get(1)?.plan_id).toBe(10)
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ sysid: 1, cmd: 'assign', ok: false, reason: 'plan 20 not found' })
    expect(results[0].id).toBeLessThan(0)
  })

  it('a_failed_set_on_a_new_vehicle_removes_its_row', async () => {
    const { store } = setup({ put: vi.fn(async (): Promise<Assignment> => Promise.reject(new Error('offline'))) })
    await store.set(4, 1)
    expect(store.getState().has(4)).toBe(false)
  })

  it('a_frame_during_a_failing_put_wins_over_the_rollback', async () => {
    const put = deferred<Assignment>()
    const { store } = setup({ list: vi.fn(async () => [row(1, 10)]), put: vi.fn(() => put.promise) })
    await store.load()
    const done = store.set(1, 20)
    store.applyFrame([row(1, 30)])
    put.reject(new Error('conflict'))
    await done
    expect(store.getState().get(1)?.plan_id).toBe(30)
  })

  it('a_ws_frame_replaces_the_map', async () => {
    const { store } = setup({ list: vi.fn(async () => [row(1, 10), row(2, 11)]) })
    await store.load()
    const seen = vi.fn()
    store.subscribe(seen)
    store.applyFrame([row(2, 12)])
    expect([...store.getState().keys()]).toEqual([2])
    expect(store.getState().get(2)?.plan_id).toBe(12)
    expect(seen).toHaveBeenCalledTimes(1)
  })

  it('a_load_that_resolves_after_a_frame_is_ignored', async () => {
    const list = deferred<Assignment[]>()
    const { store } = setup({ list: vi.fn(() => list.promise) })
    const loading = store.load()
    store.applyFrame([row(1, 30)])
    list.resolve([row(1, 10)])
    await loading
    expect(store.getState().get(1)?.plan_id).toBe(30)
  })

  it('attach_routes_assignment_frames_and_reloads_on_snapshot', async () => {
    const f = frames()
    const { store, api } = setup({ list: vi.fn(async () => [row(5, 1)]) })
    const off = store.attach(f.source)
    f.emit({ t: 'assignments', rows: [row(1, 2)] })
    expect(store.getState().get(1)?.plan_id).toBe(2)
    f.emit({ t: 'snapshot', vehicles: [], cameras: [], video_sources: [] })
    await vi.waitFor(() => expect(store.getState().get(5)?.plan_id).toBe(1))
    expect(api.list).toHaveBeenCalledTimes(1)
    off()
    expect(f.count()).toBe(0)
  })
})
