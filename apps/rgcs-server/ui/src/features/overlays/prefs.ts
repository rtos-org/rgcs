// Each overlay's switch and opacity, per browser and shared by the operations and planner maps
// (localStorage `rgcs.overlays`, keyed `plugin/overlay`): a viewing preference, never sent to the server.
import { useSyncExternalStore } from 'react'

export interface OverlayPrefs {
  readonly on: boolean
  /** Layer opacity in percent, 10–100. */
  readonly opacity: number
}

export type OverlayPrefsMap = Readonly<Record<string, OverlayPrefs>>

export const OVERLAY_PREFS_KEY = 'rgcs.overlays'
export const MIN_OPACITY = 10
export const MAX_OPACITY = 100

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>

const clampOpacity = (v: number): number => Math.min(MAX_OPACITY, Math.max(MIN_OPACITY, Math.round(v)))

function entry(v: unknown): OverlayPrefs | null {
  if (typeof v !== 'object' || v === null) return null
  const { on, opacity } = v as Record<string, unknown>
  if (typeof on !== 'boolean' || typeof opacity !== 'number' || !Number.isFinite(opacity)) return null
  return { on, opacity: clampOpacity(opacity) }
}

/** The stored map; bad entries are dropped. */
function read(storage: Storage): OverlayPrefsMap {
  try {
    const p: unknown = JSON.parse(storage.getItem(OVERLAY_PREFS_KEY) ?? 'null')
    if (typeof p !== 'object' || p === null || Array.isArray(p)) return {}
    const out: Record<string, OverlayPrefs> = {}
    for (const [k, v] of Object.entries(p)) {
      const e = entry(v)
      if (e) out[k] = e
    }
    return out
  } catch {
    return {}
  }
}

/** An overlay's prefs; untouched overlays are off at the manifest's opacity. */
export function prefsFor(state: OverlayPrefsMap, key: string, defaultOpacity: number): OverlayPrefs {
  return state[key] ?? { on: false, opacity: clampOpacity(defaultOpacity) }
}

export class OverlayPrefsStore {
  private state: OverlayPrefsMap
  private readonly storage: Storage
  private readonly listeners = new Set<() => void>()

  constructor(storage: Storage = localStorage) {
    this.storage = storage
    this.state = read(storage)
  }

  getState = (): OverlayPrefsMap => this.state

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  toggle(key: string, defaultOpacity: number): void {
    const p = prefsFor(this.state, key, defaultOpacity)
    this.set(key, { ...p, on: !p.on })
  }

  setOpacity(key: string, percent: number, defaultOpacity: number): void {
    if (!Number.isFinite(percent)) return
    this.set(key, { ...prefsFor(this.state, key, defaultOpacity), opacity: clampOpacity(percent) })
  }

  private set(key: string, next: OverlayPrefs): void {
    this.state = { ...this.state, [key]: next }
    try {
      this.storage.setItem(OVERLAY_PREFS_KEY, JSON.stringify(this.state))
    } catch {
      // storage blocked or full: the choice lasts for this page only
    }
    this.listeners.forEach((l) => l())
  }
}

let shared: OverlayPrefsStore | null = null
/** The app's store, made on first use (tests make their own). */
export const overlayPrefsStore = (): OverlayPrefsStore => (shared ??= new OverlayPrefsStore())

export function useOverlayPrefs(store: OverlayPrefsStore = overlayPrefsStore()): OverlayPrefsMap {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState)
}
