import { describe, expect, it, vi } from 'vitest'
import { OVERLAY_PREFS_KEY, OverlayPrefsStore, prefsFor } from './prefs'

const memory = (init: Record<string, string> = {}) => {
  const items = { ...init }
  return { getItem: (k: string) => items[k] ?? null, setItem: (k: string, v: string) => void (items[k] = v), items }
}

describe('overlay prefs', () => {
  it('an_overlay_is_off_at_its_default_opacity_until_touched', () => {
    const s = new OverlayPrefsStore(memory())
    expect(prefsFor(s.getState(), 'carrier/lte', 60)).toEqual({ on: false, opacity: 60 })
    expect(prefsFor(s.getState(), 'sea/marks', 80)).toEqual({ on: false, opacity: 80 })
  })

  it('remembers_each_overlay_in_the_browser', () => {
    const storage = memory()
    const s = new OverlayPrefsStore(storage)
    const listener = vi.fn()
    s.subscribe(listener)
    s.toggle('carrier/lte', 60)
    s.setOpacity('carrier/lte', 35, 60)
    s.setOpacity('sea/marks', 90, 80)
    expect(listener).toHaveBeenCalledTimes(3)
    expect(JSON.parse(storage.items[OVERLAY_PREFS_KEY]!)).toEqual({ 'carrier/lte': { on: true, opacity: 35 }, 'sea/marks': { on: false, opacity: 90 } })
    const again = new OverlayPrefsStore(storage).getState()
    expect(prefsFor(again, 'carrier/lte', 60)).toEqual({ on: true, opacity: 35 })
  })

  it('keeps_the_opacity_between_10_and_100_percent', () => {
    const s = new OverlayPrefsStore(memory())
    const at = () => prefsFor(s.getState(), 'a/b', 60).opacity
    s.setOpacity('a/b', 3, 60)
    expect(at()).toBe(10)
    s.setOpacity('a/b', 250, 60)
    expect(at()).toBe(100)
    s.setOpacity('a/b', 42.6, 60)
    expect(at()).toBe(43)
    s.setOpacity('a/b', Number.NaN, 60)
    expect(at()).toBe(43)
  })

  it('a_state_object_is_never_mutated', () => {
    const s = new OverlayPrefsStore(memory())
    const before = s.getState()
    s.toggle('a/b', 60)
    expect(before).toEqual({})
    expect(s.getState()).not.toBe(before)
  })

  it('drops_bad_entries_and_survives_a_blocked_storage', () => {
    const raw = JSON.stringify({ 'a/b': { on: true, opacity: 500 }, 'c/d': { on: 'yes', opacity: 50 }, 'e/f': 3 })
    expect(new OverlayPrefsStore(memory({ [OVERLAY_PREFS_KEY]: raw })).getState()).toEqual({ 'a/b': { on: true, opacity: 100 } })
    expect(new OverlayPrefsStore(memory({ [OVERLAY_PREFS_KEY]: '{' })).getState()).toEqual({})
    expect(new OverlayPrefsStore(memory({ [OVERLAY_PREFS_KEY]: '[1]' })).getState()).toEqual({})
    const broken = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } }
    const s = new OverlayPrefsStore(broken)
    expect(() => s.toggle('a/b', 60)).not.toThrow()
    expect(prefsFor(s.getState(), 'a/b', 60).on).toBe(true)
  })
})
