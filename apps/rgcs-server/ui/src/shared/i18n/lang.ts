import { useSyncExternalStore } from 'react'
import type { Lang } from './index'

export const LANG_KEY = 'rgcs.lang'
/** The UI languages, in picker order. Chinese is Simplified (zh-CN). */
export const LANGS: readonly Lang[] = ['en', 'ja', 'zh', 'ko']

function isLang(v: unknown): v is Lang {
  return typeof v === 'string' && (LANGS as readonly string[]).includes(v)
}

/** The first browser language we support (`zh-TW` → `zh`), else English. */
export function detectLang(tags: readonly string[]): Lang {
  for (const tag of tags) {
    const base = tag.toLowerCase().split('-')[0]
    if (isLang(base)) return base
  }
  return 'en'
}

function browserTags(): readonly string[] {
  try {
    return navigator.languages?.length ? navigator.languages : navigator.language ? [navigator.language] : []
  } catch {
    return []
  }
}

/** Per-browser preference, else the browser language; storage may be blocked, so every access is guarded. */
export function readLang(): Lang {
  try {
    const stored = localStorage.getItem(LANG_KEY)
    if (isLang(stored)) return stored
  } catch {
    // storage blocked: fall through to the browser language
  }
  return detectLang(browserTags())
}

export function writeLang(lang: Lang): void {
  try {
    localStorage.setItem(LANG_KEY, lang)
  } catch {
    // storage blocked: the choice lives for this page only
  }
}

let current: Lang = readLang()
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Screen readers and the browser's font choice follow the page language. */
function markDocument(lang: Lang): void {
  try {
    document.documentElement.lang = lang === 'zh' ? 'zh-CN' : lang
  } catch {
    // no document (tests without a DOM)
  }
}

markDocument(current)

export function setLang(lang: Lang): void {
  if (lang === current) return
  current = lang
  markDocument(lang)
  writeLang(lang)
  listeners.forEach((l) => l())
}

export function useLang(): [Lang, (lang: Lang) => void] {
  const lang = useSyncExternalStore(subscribe, () => current, () => current)
  return [lang, setLang]
}
