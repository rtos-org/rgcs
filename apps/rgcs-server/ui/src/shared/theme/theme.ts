// Theme preference (user decision 2026-10-25): 自動 / ダーク / ライト per browser, default 自動 =
// prefers-color-scheme. Only the login screen has a light version; the app itself stays dark.
import { useSyncExternalStore } from 'react'

export type ThemePref = 'auto' | 'dark' | 'light'
export type Theme = 'dark' | 'light'

export const THEME_KEY = 'rgcs.theme'
const PREFS: readonly ThemePref[] = ['auto', 'dark', 'light']
const DARK_QUERY = '(prefers-color-scheme: dark)'

function isPref(v: unknown): v is ThemePref {
  return typeof v === 'string' && (PREFS as readonly string[]).includes(v)
}

export function readThemePref(): ThemePref {
  try {
    const stored = localStorage.getItem(THEME_KEY)
    return isPref(stored) ? stored : 'auto'
  } catch {
    return 'auto'
  }
}

export function writeThemePref(pref: ThemePref): void {
  try {
    localStorage.setItem(THEME_KEY, pref)
  } catch {
    // storage blocked: the choice lives for this page only
  }
}

export function resolveTheme(pref: ThemePref, prefersDark: boolean): Theme {
  if (pref !== 'auto') return pref
  return prefersDark ? 'dark' : 'light'
}

/** The OS preference; dark (the app's own look) when the browser cannot tell. */
export function systemPrefersDark(): boolean {
  try {
    return typeof window.matchMedia !== 'function' || window.matchMedia(DARK_QUERY).matches
  } catch {
    return true
  }
}

let current: ThemePref = readThemePref()
const listeners = new Set<() => void>()

function subscribePref(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function setThemePref(pref: ThemePref): void {
  if (pref === current) return
  current = pref
  writeThemePref(pref)
  listeners.forEach((l) => l())
}

export function useThemePref(): [ThemePref, (pref: ThemePref) => void] {
  const pref = useSyncExternalStore(subscribePref, () => current, () => current)
  return [pref, setThemePref]
}

function subscribeSystem(listener: () => void): () => void {
  if (typeof window.matchMedia !== 'function') return () => {}
  const mq = window.matchMedia(DARK_QUERY)
  mq.addEventListener?.('change', listener)
  return () => mq.removeEventListener?.('change', listener)
}

/** The theme the login screen draws now: the stored choice, or the OS when it is 自動. */
export function useTheme(): Theme {
  const [pref] = useThemePref()
  const dark = useSyncExternalStore(subscribeSystem, systemPrefersDark, systemPrefersDark)
  return resolveTheme(pref, dark)
}
