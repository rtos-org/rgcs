// Vehicle list order (operator proposal 10): by number, or vehicles that need attention first.
import { useSyncExternalStore } from 'react'
import type { VehicleState } from '../../shared/api/types'

export type VehicleSort = 'id' | 'alerts'

export function sortVehicles(list: readonly VehicleState[], mode: VehicleSort): VehicleState[] {
  const byId = (a: VehicleState, b: VehicleState) => a.sysid - b.sysid
  if (mode === 'id') return [...list].sort(byId)
  return [...list].sort((a, b) => b.unread - a.unread || Number(b.warn) - Number(a.warn) || byId(a, b))
}

const KEY = 'rgcs.vehicleSort'
const listeners = new Set<() => void>()
let memo: VehicleSort | undefined

function read(): VehicleSort {
  try {
    return localStorage.getItem(KEY) === 'alerts' ? 'alerts' : 'id'
  } catch {
    return 'id'
  }
}

export function saveVehicleSort(mode: VehicleSort): void {
  try {
    localStorage.setItem(KEY, mode)
  } catch {
    // blocked storage: lasts the session
  }
  memo = mode
  listeners.forEach((l) => l())
}

export function useVehicleSort(): VehicleSort {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => (memo ??= read()),
  )
}
