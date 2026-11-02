import { describe, expect, it, vi } from 'vitest'
import type { FenceZone, Mission, RallyPoint, UploadReport } from '../../shared/api/types'
import { emptyDraft, toMission } from '../mission/model'
import { leftovers, runBatch, type BatchDeps, type BatchJob, type BatchState } from './batch'

const ZONE: FenceZone = { kind: 'circle', inclusion: true, center: { lat: 35, lon: 139 }, radius: 100 }
const RALLY: RallyPoint = { lat: 35, lon: 139, alt: 30 }
const mission = (name: string, extra: Partial<Mission> = {}): Mission => ({ ...toMission(emptyDraft()), name, ...extra })
const job = (key: string, sysid: number, m: Mission = mission(key), clear = { fence: false, rally: false }): BatchJob => ({ key, sysid, mission: m, clearFence: clear.fence, clearRally: clear.rally })
const report = (verified = true): UploadReport => ({ items: 1, verified, mismatched: verified ? [] : [2], findings: [] })

function deps(over: Partial<BatchDeps> = {}): BatchDeps {
  return {
    validate: vi.fn(async () => ({ findings: [], stats: { distance_m: 0, duration_s: 0, max_alt: 0 } })) as unknown as BatchDeps['validate'],
    upload: vi.fn(async () => report()),
    uploadSaved: vi.fn(async () => report()),
    writeFence: vi.fn(async () => report()),
    writeRally: vi.fn(async () => report()),
    connected: () => true,
    ...over,
  }
}

const finals = (states: BatchState[]) => {
  const last = new Map<string, BatchState>()
  for (const s of states) last.set(s.key, s)
  return [...last.values()].map((s) => [s.key, s.phase, s.reason])
}

describe('runBatch', () => {
  it('writes_each_job_in_order_and_continues_after_a_failure', async () => {
    const d = deps({ connected: (sysid) => sysid !== 2 })
    const states: BatchState[] = []
    await runBatch([job('a', 1), job('b', 2), job('c', 3)], d, (s) => states.push(s))
    expect(finals(states)).toEqual([
      ['a', 'done', null],
      ['b', 'failed', 'offline'],
      ['c', 'done', null],
    ])
    expect(vi.mocked(d.upload).mock.calls.map((c) => c[0])).toEqual([1, 3])
    // every job is announced as waiting first, then written one at a time
    expect(states.slice(0, 3).map((s) => s.phase)).toEqual(['waiting', 'waiting', 'waiting'])
    expect(states.filter((s) => s.key === 'a').map((s) => s.phase)).toEqual(['waiting', 'writing', 'done'])
  })

  it('fatal_validation_stops_only_that_job', async () => {
    const validate = vi.fn(async (_m: Mission, sysid: number | null) => ({
      findings: sysid === 1 ? [{ level: 'fatal' as const, code: 'x', seq: null, message: 'x' }] : [],
      stats: { distance_m: 0, duration_s: 0, max_alt: 0 },
    }))
    const d = deps({ validate: validate as unknown as BatchDeps['validate'], upload: vi.fn(async (sysid: number) => report(sysid !== 3)) })
    const states: BatchState[] = []
    await runBatch([job('a', 1), job('b', 2), job('c', 3), job('e', 4)], d, (s) => states.push(s))
    expect(finals(states)).toEqual([
      ['a', 'failed', 'fatal'],
      ['b', 'done', null],
      ['c', 'failed', 'mismatch'],
      ['e', 'done', null],
    ])
    expect(vi.mocked(d.upload).mock.calls.map((c) => c[0])).toEqual([2, 3, 4])
  })

  it('reports_a_thrown_error_with_its_message_and_continues', async () => {
    const d = deps({ upload: vi.fn(async (sysid: number) => (sysid === 1 ? Promise.reject(new Error('timeout')) : report())) })
    const states: BatchState[] = []
    await runBatch([job('a', 1), job('b', 2)], d, (s) => states.push(s))
    expect(finals(states)).toEqual([
      ['a', 'failed', 'timeout'],
      ['b', 'done', null],
    ])
  })

  it('clear_flags_write_empty_fence_and_rally_only_when_the_mission_has_none', async () => {
    const d = deps()
    const withBoth = mission('a', { fence: [ZONE], rally: [RALLY] })
    await runBatch(
      [job('a', 1, withBoth, { fence: true, rally: true }), job('b', 2, mission('b'), { fence: true, rally: false }), job('c', 3, mission('c'), { fence: false, rally: true }), job('e', 4)],
      d,
      () => {},
    )
    expect(vi.mocked(d.writeFence).mock.calls).toEqual([
      [1, [ZONE]],
      [2, []],
    ])
    expect(vi.mocked(d.writeRally).mock.calls).toEqual([
      [1, [RALLY]],
      [3, []],
    ])
  })
})

describe('runBatch fence / rally step', () => {
  it('names_the_fence_or_rally_step_that_failed_after_the_mission_was_written', async () => {
    const d = deps({ writeFence: vi.fn(async () => report(false)), writeRally: vi.fn(async () => report(false)) })
    const states: BatchState[] = []
    await runBatch([job('a', 1, mission('a', { fence: [ZONE] })), job('b', 2, mission('b', { rally: [RALLY] }))], d, (s) => states.push(s))
    expect(finals(states)).toEqual([
      ['a', 'failed', 'fenceMismatch'],
      ['b', 'failed', 'rallyMismatch'],
    ])
  })
})

describe('runBatch board jobs', () => {
  const saved = (key: string, sysid: number, m: Mission = mission(key)): BatchJob => ({ ...job(key, sysid, m), savedId: sysid * 10 })
  const BOARD = { missionLast: true }

  it('board_jobs_write_fence_rally_then_mission', async () => {
    const calls: string[] = []
    const d = deps({
      validate: vi.fn(async () => (calls.push('validate'), { findings: [], stats: { distance_m: 0, duration_s: 0, max_alt: 0 } })) as unknown as BatchDeps['validate'],
      uploadSaved: vi.fn(async () => (calls.push('mission'), report())),
      writeFence: vi.fn(async () => (calls.push('fence'), report())),
      writeRally: vi.fn(async () => (calls.push('rally'), report())),
    })
    await runBatch([saved('a', 1, mission('a', { fence: [ZONE], rally: [RALLY] }))], d, () => {}, BOARD)
    expect(calls).toEqual(['validate', 'fence', 'rally', 'mission'])
  })

  it('board_jobs_use_the_saved_upload', async () => {
    const d = deps()
    const states: BatchState[] = []
    await runBatch([saved('a', 1), saved('b', 2)], d, (s) => states.push(s), BOARD)
    expect(vi.mocked(d.uploadSaved).mock.calls).toEqual([[1, 10], [2, 20]])
    expect(d.upload).not.toHaveBeenCalled()
    expect(finals(states)).toEqual([['a', 'done', null], ['b', 'done', null]])
  })

  it('one_failure_does_not_stop_the_rest', async () => {
    // a's fence fails: its mission is not written (the card stays 書込待ち); b and c still go
    const d = deps({
      writeFence: vi.fn(async (sysid: number) => report(sysid !== 1)),
      uploadSaved: vi.fn(async (sysid: number) => (sysid === 2 ? Promise.reject(new Error('timeout')) : report())),
    })
    const states: BatchState[] = []
    await runBatch([saved('a', 1, mission('a', { fence: [ZONE] })), saved('b', 2), saved('c', 3)], d, (s) => states.push(s), BOARD)
    expect(finals(states)).toEqual([
      ['a', 'failed', 'fenceMismatch'],
      ['b', 'failed', 'timeout'],
      ['c', 'done', null],
    ])
    expect(vi.mocked(d.uploadSaved).mock.calls.map((c) => c[0])).toEqual([2, 3])
  })
})

describe('leftovers', () => {
  it('leftovers_reads_only_what_is_needed_and_reports_unknown_on_error', async () => {
    const fence = vi.fn(async (sysid: number) => (sysid === 3 ? Promise.reject(new Error('no link')) : { zones: sysid === 2 ? [ZONE, ZONE] : [] }))
    const rally = vi.fn(async (sysid: number) => ({ points: sysid === 2 ? [RALLY] : [] }))
    const got = await leftovers(
      [
        { sysid: 1, mission: mission('a', { fence: [ZONE], rally: [RALLY] }) },
        { sysid: 2, mission: mission('b') },
        { sysid: 3, mission: mission('c', { rally: [RALLY] }) },
      ],
      { fence, rally },
    )
    expect(fence.mock.calls.map((c) => c[0])).toEqual([2, 3])
    expect(rally.mock.calls.map((c) => c[0])).toEqual([2])
    expect(got.has(1)).toBe(false)
    expect(got.get(2)).toEqual({ fence: 2, rally: 1 })
    expect(got.get(3)).toEqual({ fence: null, rally: 0 })
  })

  it('leftovers_reads_one_vehicle_fence_then_rally_never_overlapping', async () => {
    // the server allows one mission transfer per sysid: an overlapping second read is refused (409 mission_busy)
    const active = new Set<number>()
    const busyRead = <T>(value: T) => async (sysid: number): Promise<T> => {
      if (active.has(sysid)) throw new Error('mission_busy')
      active.add(sysid)
      await new Promise((r) => setTimeout(r, 5))
      active.delete(sysid)
      return value
    }
    const got = await leftovers([{ sysid: 1, mission: mission('a') }, { sysid: 2, mission: mission('b') }], {
      fence: busyRead({ zones: [ZONE, ZONE] }) as never,
      rally: busyRead({ points: [RALLY] }) as never,
    })
    expect(got.get(1)).toEqual({ fence: 2, rally: 1 })
    expect(got.get(2)).toEqual({ fence: 2, rally: 1 })
  })
})
