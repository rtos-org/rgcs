import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readThemePref, resolveTheme, systemPrefersDark, THEME_KEY, writeThemePref } from './theme'

describe('theme preference', () => {
  beforeEach(() => localStorage.clear())
  afterEach(() => vi.unstubAllGlobals())

  it('defaults to auto and round-trips a stored choice', () => {
    expect(readThemePref()).toBe('auto')
    writeThemePref('light')
    expect(localStorage.getItem(THEME_KEY)).toBe('light')
    expect(readThemePref()).toBe('light')
  })

  it('treats unknown stored values as auto', () => {
    localStorage.setItem(THEME_KEY, 'sepia')
    expect(readThemePref()).toBe('auto')
  })

  it('falls back to auto when storage throws', () => {
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    })
    expect(readThemePref()).toBe('auto')
    expect(() => writeThemePref('dark')).not.toThrow()
  })

  it('resolves auto from the OS preference and keeps explicit choices', () => {
    expect(resolveTheme('auto', true)).toBe('dark')
    expect(resolveTheme('auto', false)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
    expect(resolveTheme('light', true)).toBe('light')
  })

  it('reads the OS preference through matchMedia, dark when unavailable', () => {
    expect(systemPrefersDark()).toBe(true)
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q === '(prefers-color-scheme: dark)' ? false : true }))
    expect(systemPrefersDark()).toBe(false)
  })
})
