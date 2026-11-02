import { useSyncExternalStore } from 'react'
import type { VehicleState } from '../../shared/api/types'
import { hasPosition } from './markers'
import { appendPoint, trimTracks, type Tracks } from './tracks'

const MINUTE_MS = 60_000
/** Until the app settings arrive (map.track_minutes default). */
const DEFAULT_KEEP_MINUTES = 10

/** Accumulates vehicle positions into tracks; fed from the vehicle store, read by the map. */
export class TracksStore {
  private state: Tracks = new Map()
  private keepMs = DEFAULT_KEEP_MINUTES * MINUTE_MS
  private readonly listeners = new Set<() => void>()

  getState = (): Tracks => this.state

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** 軌跡を残す時間 (app setting); a shorter value trims at once, 0 keeps no track. */
  setKeepMinutes(minutes: number, now: number = Date.now()): void {
    this.keepMs = Math.max(0, minutes) * MINUTE_MS
    this.publish(trimTracks(this.state, now, this.keepMs))
  }

  ingest(vehicles: ReadonlyMap<number, VehicleState>, now: number = Date.now()): void {
    if (this.keepMs <= 0) return this.publish(trimTracks(this.state, now, 0))
    let next = this.state
    for (const v of vehicles.values()) if (hasPosition(v)) next = appendPoint(next, v.sysid, { lon: v.lon, lat: v.lat, alt: v.alt_rel, t: now })
    this.publish(trimTracks(next, now, this.keepMs))
  }

  private publish(next: Tracks): void {
    if (next === this.state) return
    this.state = next
    this.listeners.forEach((l) => l())
  }
}

export const tracksStore = new TracksStore()

export function useTracks(store: TracksStore = tracksStore): Tracks {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState)
}
