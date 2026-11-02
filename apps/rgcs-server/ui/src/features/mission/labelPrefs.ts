// Which planner map labels are shown (WP numbers, the 3D altitude chips, the + between WPs). Kept per browser:
// a viewing preference, never sent to the server.
import { useSyncExternalStore } from 'react'

export interface LabelPrefs {
  /** The number (T / L / R) inside each waypoint dot. */
  readonly wpNumbers: boolean
  /** The altitude and frame chip under each waypoint ("80 m REL", 3D). */
  readonly altitudes: boolean
  /** The "+" between two waypoints that inserts one (`.rg-mid`). */
  readonly insertHandles: boolean
}

export type LabelKey = keyof LabelPrefs

export const LABELS_KEY = 'rgcs.planLabels'
export const DEFAULT_LABELS: LabelPrefs = { wpNumbers: true, altitudes: true, insertHandles: true }

type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>

const KEYS = Object.keys(DEFAULT_LABELS) as LabelKey[]

/** A stored entry; a key it lacks (saved by an older version) shows. Any wrong type: the defaults. */
function read(storage: Storage): LabelPrefs {
  try {
    const p: unknown = JSON.parse(storage.getItem(LABELS_KEY) ?? 'null')
    if (typeof p !== 'object' || p === null || Array.isArray(p)) return DEFAULT_LABELS
    const stored = p as Record<string, unknown>
    if (KEYS.some((k) => k in stored && typeof stored[k] !== 'boolean')) return DEFAULT_LABELS
    return Object.fromEntries(KEYS.map((k) => [k, stored[k] ?? DEFAULT_LABELS[k]])) as unknown as LabelPrefs
  } catch {
    return DEFAULT_LABELS
  }
}

export class LabelPrefsStore {
  private state: LabelPrefs
  private readonly storage: Storage
  private readonly listeners = new Set<() => void>()

  constructor(storage: Storage = localStorage) {
    this.storage = storage
    this.state = read(storage)
  }

  getState = (): LabelPrefs => this.state

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  toggle(key: LabelKey): void {
    this.state = { ...this.state, [key]: !this.state[key] }
    try {
      this.storage.setItem(LABELS_KEY, JSON.stringify(this.state))
    } catch {
      // storage blocked or full: the choice lasts for this page only
    }
    this.listeners.forEach((l) => l())
  }
}

let shared: LabelPrefsStore | null = null
/** The app's store, made on first use (tests make their own). */
export const labelPrefsStore = (): LabelPrefsStore => (shared ??= new LabelPrefsStore())

export function useLabelPrefs(store: LabelPrefsStore = labelPrefsStore()): LabelPrefs {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState)
}

/** Classes for the planner root that hide the labels switched off (styles/mission.css). */
export const labelClasses = (p: LabelPrefs): string => `${p.wpNumbers ? '' : ' labels-no-num'}${p.altitudes ? '' : ' labels-no-alt'}${p.insertHandles ? '' : ' labels-no-mid'}`
