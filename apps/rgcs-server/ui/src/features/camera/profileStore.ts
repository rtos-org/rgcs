// Camera profiles per vehicle, so the cockpit reads ai_box_px / thermal_overlay without opening the sheet.
import { useEffect, useSyncExternalStore } from 'react'
import type { CameraProfile } from '../../shared/api/types'
import { getCameraProfile } from './api'

type Profiles = ReadonlyMap<number, CameraProfile>

let state: Profiles = new Map()
const listeners = new Set<() => void>()
const requested = new Set<number>()

function publish(next: Profiles): void {
  state = next
  listeners.forEach((l) => l())
}

async function load(sysid: number): Promise<void> {
  requested.add(sysid)
  try {
    const p = await getCameraProfile(sysid)
    publish(new Map([...state, [sysid, p]]))
  } catch {
    // an older server or a transient error: the next use retries
    requested.delete(sysid)
  }
}

function subscribe(l: () => void): () => void {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

const snapshot = (): Profiles => state

export const cameraProfileStore = {
  /** The cached profile, or null before the first load / set. */
  get(sysid: number): CameraProfile | null {
    return state.get(sysid) ?? null
  },
  /** The saved profile (e.g. a PUT result); no fetch. */
  set(sysid: number, p: CameraProfile): void {
    requested.add(sysid)
    publish(new Map([...state, [sysid, p]]))
  },
  /** Fetches the profile again; the cached one stays visible until the answer arrives. */
  invalidate(sysid: number): void {
    void load(sysid)
  },
}

/** The vehicle's camera profile (null until loaded); the first use per vehicle fetches it. */
export function useCameraProfile(sysid: number | null): CameraProfile | null {
  const all = useSyncExternalStore(subscribe, snapshot, snapshot)
  useEffect(() => {
    if (sysid === null || requested.has(sysid)) return
    void load(sysid)
  }, [sysid])
  return sysid === null ? null : (all.get(sysid) ?? null)
}
