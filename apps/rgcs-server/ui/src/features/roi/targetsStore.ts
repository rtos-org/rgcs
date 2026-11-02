// Saved ROI presets per vehicle, shared by the map markers, the cockpit chips and the joystick.
import { useEffect, useSyncExternalStore } from 'react'
import type { RoiTarget } from '../../shared/api/types'
import { getRoiTargets } from './api'

export interface RoiTargetsStore {
  get(sysid: number): readonly RoiTarget[] | undefined
  load(sysid: number): Promise<void>
  set(sysid: number, t: readonly RoiTarget[]): void
  subscribe(l: () => void): () => void
  /** Snapshot for `useSyncExternalStore` (a new map on every change). */
  snapshot(): ReadonlyMap<number, readonly RoiTarget[]>
}

export function createRoiTargetsStore(): RoiTargetsStore {
  let state: ReadonlyMap<number, readonly RoiTarget[]> = new Map()
  const listeners = new Set<() => void>()
  const set = (sysid: number, t: readonly RoiTarget[]) => {
    state = new Map([...state, [sysid, t]])
    listeners.forEach((l) => l())
  }
  return {
    get: (sysid) => state.get(sysid),
    load: async (sysid) => {
      try {
        set(sysid, await getRoiTargets(sysid))
      } catch {
        // an older server or a transient error: no markers / chips until the next load
      }
    },
    set,
    subscribe: (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    snapshot: () => state,
  }
}

export const roiTargetsStore = createRoiTargetsStore()

const requested = new Set<number>()
const NONE: readonly RoiTarget[] = []

/** The vehicle's saved presets ([] until loaded); the first use per vehicle fetches them. */
export function useRoiTargets(sysid: number | null): readonly RoiTarget[] {
  const all = useSyncExternalStore(roiTargetsStore.subscribe, roiTargetsStore.snapshot, roiTargetsStore.snapshot)
  useEffect(() => {
    if (sysid === null || requested.has(sysid)) return
    requested.add(sysid)
    void roiTargetsStore.load(sysid)
  }, [sysid])
  return sysid === null ? NONE : (all.get(sysid) ?? NONE)
}
