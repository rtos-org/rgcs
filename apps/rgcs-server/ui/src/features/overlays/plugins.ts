// The plugins the server found (GET /api/plugins), read once per page and shared by both maps,
// the menus, the notices and the settings page (UI).
import { useEffect, useSyncExternalStore } from 'react'
import type { LocalText, OverlayInfo, PluginInfo } from '../../shared/api/types'
import { listPlugins, type OverlayRef } from './api'

export interface PluginsState {
  readonly plugins: readonly PluginInfo[]
  readonly loaded: boolean
  /** The last read failed (the list shown is the one before). */
  readonly error: boolean
}

/** An overlay of a loaded, enabled plugin. `key` = `plugin/overlay`. */
export interface ActiveOverlay {
  readonly key: string
  readonly ref: OverlayRef
  readonly plugin: PluginInfo
  readonly overlay: OverlayInfo
}

/** Plugin text in `lang`, else English (`langCode` of the dictionary). */
export function pickText(t: LocalText | null | undefined, lang: string): string {
  if (!t) return ''
  const v = lang === 'ja' || lang === 'zh' || lang === 'ko' ? t[lang] : undefined
  return v ?? t.en
}

const usable = (p: PluginInfo): boolean => p.status === 'ok' && p.enabled

export function activeOverlays(plugins: readonly PluginInfo[]): ActiveOverlay[] {
  return plugins.filter(usable).flatMap((p) => p.overlays.map((o) => ({ key: `${p.id}/${o.id}`, ref: { plugin: p.id, overlay: o.id }, plugin: p, overlay: o })))
}

/** The loaded, enabled plugins that have links. */
export function activeLinks(plugins: readonly PluginInfo[]): PluginInfo[] {
  return plugins.filter((p) => usable(p) && p.links.length > 0)
}

const INITIAL: PluginsState = { plugins: [], loaded: false, error: false }

export class PluginsStore {
  private state: PluginsState = INITIAL
  private readonly load: () => Promise<readonly PluginInfo[]>
  private readonly listeners = new Set<() => void>()
  private inflight: Promise<void> | null = null

  constructor(load: () => Promise<readonly PluginInfo[]> = listPlugins) {
    this.load = load
  }

  getState = (): PluginsState => this.state

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Reads the list unless it was read already (or is being read). */
  ensureLoaded(): void {
    if (!this.state.loaded && !this.inflight) void this.reload()
  }

  /** Reads the list now; never throws. */
  reload(): Promise<void> {
    this.inflight ??= this.fetchOnce().finally(() => {
      this.inflight = null
    })
    return this.inflight
  }

  private async fetchOnce(): Promise<void> {
    try {
      const plugins = await this.load()
      this.set({ plugins: [...plugins], loaded: true, error: false })
    } catch {
      this.set({ ...this.state, loaded: true, error: true })
    }
  }

  private set(next: PluginsState): void {
    this.state = next
    this.listeners.forEach((l) => l())
  }
}

let shared: PluginsStore | null = null
/** The app's store, made on first use (tests make their own). */
export const pluginsStore = (): PluginsStore => (shared ??= new PluginsStore())

/** The plugins; `active` reads them from the server once. */
export function usePlugins(active: boolean, store: PluginsStore = pluginsStore()): PluginsState {
  useEffect(() => {
    if (active) store.ensureLoaded()
  }, [active, store])
  return useSyncExternalStore(store.subscribe, store.getState, store.getState)
}
