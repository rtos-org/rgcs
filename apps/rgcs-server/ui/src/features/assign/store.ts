// Plan assignments per vehicle, mirrored from the server: `GET /api/assignments` on every WS
// snapshot (connect / reconnect), then `assignments` frames. `set` is optimistic and rolls back
// (with a footer pill) when the PUT fails.
import { useSyncExternalStore } from 'react'
import type { Assignment, CommandResult } from '../../shared/api/types'
import { localResultId } from '../vehicles/localResultId'
import { vehicleStore, type FrameSource } from '../vehicles/store'
import { listAssignments, putAssignment } from './api'

export type Assignments = ReadonlyMap<number, Assignment>

export interface AssignApi {
  readonly list: () => Promise<Assignment[]>
  readonly put: (sysid: number, planId: number | null) => Promise<Assignment>
}

export interface ResultSink {
  readonly pushLocalResult: (r: CommandResult) => void
}

const DEFAULT_API: AssignApi = { list: listAssignments, put: putAssignment }

const toMap = (rows: readonly Assignment[]): Assignments => new Map(rows.map((r) => [r.sysid, r]))

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/** `map` with `sysid`'s row replaced (or removed when `next` is undefined); a new map. */
function withRow(map: Assignments, sysid: number, next: Assignment | undefined): Assignments {
  const copy = new Map(map)
  if (next === undefined) copy.delete(sysid)
  else copy.set(sysid, next)
  return copy
}

export class AssignmentStore {
  private state: Assignments = new Map()
  private readonly listeners = new Set<() => void>()
  /** Bumped by every whole-map replace, so a load that started earlier cannot overwrite a frame. */
  private generation = 0
  private readonly api: AssignApi
  private readonly results: ResultSink

  constructor(api: AssignApi = DEFAULT_API, results: ResultSink = vehicleStore) {
    this.api = api
    this.results = results
  }

  getState = (): Assignments => this.state

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async load(): Promise<void> {
    const started = ++this.generation
    const rows = await this.api.list()
    if (started === this.generation) this.replace(toMap(rows))
  }

  /** A server `assignments` frame: the whole table. */
  applyFrame(rows: readonly Assignment[]): void {
    this.generation++
    this.replace(toMap(rows))
  }

  /** Optimistic: shown at once; the server's row replaces it, a failure restores the previous one. */
  async set(sysid: number, planId: number | null): Promise<void> {
    const prev = this.state.get(sysid)
    const optimistic: Assignment = { ...(prev ?? { sysid, assigned_by: null, assigned_at: null, written: null }), plan_id: planId }
    this.replace(withRow(this.state, sysid, optimistic))
    try {
      const saved = await this.api.put(sysid, planId)
      if (this.state.get(sysid) === optimistic) this.replace(withRow(this.state, sysid, saved))
    } catch (e) {
      // a frame that arrived meanwhile is newer than both rows: leave it
      if (this.state.get(sysid) === optimistic) this.replace(withRow(this.state, sysid, prev))
      this.results.pushLocalResult({ id: localResultId(), sysid, cmd: 'assign', ok: false, reason: errText(e), ts: Date.now() })
    }
  }

  /** Routes `assignments` frames here and reloads on each `snapshot` (a (re)connect). */
  attach(frames: FrameSource): () => void {
    return frames.onFrame((msg) => {
      if (msg.t === 'assignments') this.applyFrame(msg.rows)
      else if (msg.t === 'snapshot') this.load().catch(() => {}) // keeps the last table; the next frame refreshes it
    })
  }

  private replace(next: Assignments): void {
    if (next === this.state) return
    this.state = next
    this.listeners.forEach((l) => l())
  }
}

export const assignmentStore = new AssignmentStore()

export function useAssignments(store: AssignmentStore = assignmentStore): Assignments {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState)
}
