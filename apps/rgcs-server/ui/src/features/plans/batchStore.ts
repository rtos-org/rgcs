// The 割当どおり書き込む sheet and its running batch, kept outside MissionView: leaving the planner
// unmounts the view but not the writes, so coming back shows them and no second batch can start.
import { useSyncExternalStore } from 'react'
import type { BatchState, Leftover } from './batch'
import type { SheetLine } from './BatchWriteSheet'

export interface BatchSheet {
  /** Bumped by every open: a late leftover read of an earlier sheet is dropped, the sheet remounts. */
  readonly session: number
  readonly lines: readonly SheetLine[]
  readonly leftovers: ReadonlyMap<number, Leftover> | null
  readonly states: ReadonlyMap<string, BatchState>
  readonly running: boolean
}

export class BatchStore {
  private state: BatchSheet | null = null
  private sessions = 0
  private readonly listeners = new Set<() => void>()

  getState = (): BatchSheet | null => this.state

  /** A session number never used before (also after close). */
  nextSession = (): number => ++this.sessions

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  update(fn: (s: BatchSheet | null) => BatchSheet | null): void {
    const next = fn(this.state)
    if (next === this.state) return
    this.state = next
    this.listeners.forEach((l) => l())
  }

  /** Changes the sheet of `session` only (an earlier sheet's late result is ignored). */
  patch(session: number, fn: (s: BatchSheet) => BatchSheet): void {
    this.update((s) => (s !== null && s.session === session ? fn(s) : s))
  }
}

export const batchStore = new BatchStore()

export function useBatchSheet(store: BatchStore = batchStore): BatchSheet | null {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState)
}
