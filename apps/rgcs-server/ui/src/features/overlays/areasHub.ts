// The saved areas of every `area` overlay, keyed `plugin/overlay` and shared by both maps, the
// notices and the manage sheet. While an overlay has an area fetching, its list is read again
// every second (progress, and the maps pick up the new tiles when it ends).
import { useEffect, useSyncExternalStore } from 'react'
import type { OverlayArea } from '../../shared/api/types'
import { listAreas, type OverlayRef } from './api'

export interface AreasState {
  readonly areas: readonly OverlayArea[]
  readonly loaded: boolean
  /** The last read failed (the list shown is the one before). */
  readonly error: boolean
}

export type AreasMap = Readonly<Record<string, AreasState>>

export const POLL_MS = 1000
const EMPTY: AreasState = { areas: [], loaded: false, error: false }

const keyOf = (r: OverlayRef): string => `${r.plugin}/${r.overlay}`

/** One overlay's areas (empty and not loaded when never read). */
export const areasOf = (state: AreasMap, key: string): AreasState => state[key] ?? EMPTY

export class AreasHub {
  private state: AreasMap = {}
  private readonly load: (r: OverlayRef) => Promise<readonly OverlayArea[]>
  private readonly listeners = new Set<() => void>()
  private readonly inflight = new Map<string, Promise<void>>()
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(load: (r: OverlayRef) => Promise<readonly OverlayArea[]> = listAreas) {
    this.load = load
  }

  getState = (): AreasMap => this.state

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
      if (this.listeners.size === 0) this.stopPolling()
    }
  }

  /** Reads an overlay's list unless it was read already (or is being read). */
  ensureLoaded(r: OverlayRef): void {
    const k = keyOf(r)
    if (!areasOf(this.state, k).loaded && !this.inflight.has(k)) void this.reload(r)
  }

  /** Reads an overlay's list now; never throws. */
  reload(r: OverlayRef): Promise<void> {
    const k = keyOf(r)
    const running = this.inflight.get(k)
    if (running) return running
    const p = this.fetchOnce(r, k).finally(() => {
      this.inflight.delete(k)
      this.schedule(r, k)
    })
    this.inflight.set(k, p)
    return p
  }

  private async fetchOnce(r: OverlayRef, k: string): Promise<void> {
    try {
      const areas = await this.load(r)
      this.set(k, { areas: [...areas], loaded: true, error: false })
    } catch {
      this.set(k, { ...areasOf(this.state, k), loaded: true, error: true })
    }
  }

  private schedule(r: OverlayRef, k: string): void {
    const fetching = areasOf(this.state, k).areas.some((a) => a.status === 'fetching')
    if (!fetching || this.listeners.size === 0 || this.timers.has(k)) return
    const timer = setTimeout(() => {
      this.timers.delete(k)
      void this.reload(r)
    }, POLL_MS)
    this.timers.set(k, timer)
  }

  private stopPolling(): void {
    this.timers.forEach((t) => clearTimeout(t))
    this.timers.clear()
  }

  private set(k: string, next: AreasState): void {
    this.state = { ...this.state, [k]: next }
    this.listeners.forEach((l) => l())
  }
}

let shared: AreasHub | null = null
/** The app's hub, made on first use (tests make their own). */
export const areasHub = (): AreasHub => (shared ??= new AreasHub())

/** The areas of every overlay; each of `refs` is read from the server once. */
export function useAreas(refs: readonly OverlayRef[], hub: AreasHub = areasHub()): AreasMap {
  const want = refs.map(keyOf).join('|')
  useEffect(() => {
    if (!want) return
    for (const k of want.split('|')) {
      const [plugin = '', overlay = ''] = k.split('/')
      hub.ensureLoaded({ plugin, overlay })
    }
  }, [want, hub])
  return useSyncExternalStore(hub.subscribe, hub.getState, hub.getState)
}
