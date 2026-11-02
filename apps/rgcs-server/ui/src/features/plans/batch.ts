// 割当どおり書き込む (spec 2026-10-20 §5.5): each assigned row to its vehicle, one after another,
// with the same validate → upload → read-back check as 機体に書き込む; a failure never stops the rest.
// A board write (2026-10-31 §7) sends the saved plan by id and the mission last (fence → rally →
// mission): the server records the written plan only when the mission verifies.
import type { FenceZone, Mission, RallyPoint } from '../../shared/api/types'
import type { readFence, readRally, uploadMission, uploadSavedMission, validateMission, writeFence, writeRally } from '../mission/api'

export interface BatchJob {
  readonly key: string
  readonly sysid: number
  readonly mission: Mission
  /** Write an empty fence when the mission has none (the vehicle's old one is removed). */
  readonly clearFence: boolean
  readonly clearRally: boolean
  /** The saved plan's id: the mission goes through the saved upload (`POST …/mission/upload`). */
  readonly savedId?: number
}

export interface BatchOptions {
  /** Fence and rally first, the mission last (a board write). */
  readonly missionLast?: boolean
}

/** `reason`: one of BATCH_REASONS, or a thrown error's message. */
export type BatchState = { readonly key: string; readonly phase: 'waiting' | 'writing' | 'done' | 'failed'; readonly reason: string | null }

/** Reason codes the sheet translates; any other reason is shown as it is. */
export const BATCH_REASONS = { offline: 'offline', fatal: 'fatal', mismatch: 'mismatch', fenceMismatch: 'fenceMismatch', rallyMismatch: 'rallyMismatch' } as const

export interface BatchDeps {
  validate: typeof validateMission
  upload: typeof uploadMission
  uploadSaved: typeof uploadSavedMission
  writeFence: typeof writeFence
  writeRally: typeof writeRally
  connected: (sysid: number) => boolean
}

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/** What to write for a fence / rally: the mission's own, an empty list to clear, or nothing. */
function extra<T>(own: readonly T[], clear: boolean): readonly T[] | null {
  if (own.length > 0) return own
  return clear ? [] : null
}

async function writeMission(job: BatchJob, deps: BatchDeps): Promise<string | null> {
  const report = job.savedId === undefined ? await deps.upload(job.sysid, job.mission) : await deps.uploadSaved(job.sysid, job.savedId)
  return report.verified ? null : BATCH_REASONS.mismatch
}

async function writeExtras(job: BatchJob, deps: BatchDeps): Promise<string | null> {
  const { sysid, mission } = job
  const fence: readonly FenceZone[] | null = extra(mission.fence, job.clearFence)
  if (fence !== null && !(await deps.writeFence(sysid, fence)).verified) return BATCH_REASONS.fenceMismatch
  const rally: readonly RallyPoint[] | null = extra(mission.rally, job.clearRally)
  if (rally !== null && !(await deps.writeRally(sysid, rally)).verified) return BATCH_REASONS.rallyMismatch
  return null
}

/** One job; resolves to its failure reason, or null when done (a fence / rally reason after the mission: the mission itself was written). */
async function writeJob(job: BatchJob, deps: BatchDeps, opts: BatchOptions): Promise<string | null> {
  if (!deps.connected(job.sysid)) return BATCH_REASONS.offline
  const { findings } = await deps.validate(job.mission, job.sysid)
  if (findings.some((f) => f.level === 'fatal')) return BATCH_REASONS.fatal
  const steps = opts.missionLast ? [writeExtras, writeMission] : [writeMission, writeExtras]
  for (const step of steps) {
    const reason = await step(job, deps)
    if (reason !== null) return reason
  }
  return null
}

export async function runBatch(jobs: readonly BatchJob[], deps: BatchDeps, onState: (s: BatchState) => void, opts: BatchOptions = {}): Promise<void> {
  for (const { key } of jobs) onState({ key, phase: 'waiting', reason: null })
  for (const job of jobs) {
    onState({ key: job.key, phase: 'writing', reason: null })
    let reason: string | null
    try {
      reason = await writeJob(job, deps, opts)
    } catch (e) {
      reason = errText(e)
    }
    onState({ key: job.key, phase: reason === null ? 'done' : 'failed', reason })
  }
}

/** What a vehicle still holds; null = could not read. */
export interface Leftover {
  readonly fence: number | null
  readonly rally: number | null
}

const countOrNull = async (read: () => Promise<number>): Promise<number | null> => {
  try {
    return await read()
  } catch {
    return null
  }
}

/** Reads the vehicles' fence / rally (vehicles in parallel, one read at a time per vehicle) only where the assigned mission has none (0 = not read, not needed). */
export async function leftovers(
  jobs: readonly { sysid: number; mission: Mission }[],
  read: { fence: typeof readFence; rally: typeof readRally },
): Promise<ReadonlyMap<number, Leftover>> {
  const needed = jobs.filter((j) => j.mission.fence.length === 0 || j.mission.rally.length === 0)
  const entries = await Promise.all(
    needed.map(async ({ sysid, mission }): Promise<[number, Leftover]> => {
      // one transfer per vehicle at a time (the server answers 409 mission_busy): fence, then rally
      const fence = mission.fence.length > 0 ? 0 : await countOrNull(async () => (await read.fence(sysid)).zones.length)
      const rally = mission.rally.length > 0 ? 0 : await countOrNull(async () => (await read.rally(sysid)).points.length)
      return [sysid, { fence, rally }]
    }),
  )
  return new Map(entries)
}
