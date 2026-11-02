import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { INTRO_MS } from './intro'
import { IntroStore, markAppPainted } from './introStore'

describe('IntroStore', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  const make = (reduced = false) => new IntroStore({ now: () => Date.now(), reducedMotion: () => reduced })

  it('plays the whole sequence on its own timers', () => {
    const s = make()
    const seen: string[] = []
    s.subscribe(() => {
      const phase = s.getState().phase
      if (seen.at(-1) !== phase) seen.push(phase)
    })
    s.submit()
    s.authResult(true)
    vi.advanceTimersByTime(INTRO_MS.gatherMin)
    expect(s.getState().phase).toBe('done')
    vi.advanceTimersByTime(INTRO_MS.paintMax)
    expect(s.getState().phase).toBe('clear')
    vi.advanceTimersByTime(INTRO_MS.clear)
    expect(s.getState().phase).toBe('app')
    expect(seen).toEqual(['gather', 'done', 'clear', 'app'])
  })

  it('clears as soon as the app reports its first paint', () => {
    const s = make()
    s.submit()
    s.authResult(true)
    vi.advanceTimersByTime(INTRO_MS.gatherMin)
    markAppPainted()
    expect(s.getState().phase).toBe('done')
    vi.advanceTimersByTime(INTRO_MS.done)
    expect(s.getState().phase).toBe('clear')
  })

  it('reads reduced motion at submit', () => {
    const s = make(true)
    s.submit()
    s.authResult(true)
    expect(s.getState().phase).toBe('done')
    vi.advanceTimersByTime(INTRO_MS.reduced)
    expect(s.getState().phase).toBe('app')
  })

  it('a failure drops back to idle with the error and stops its timers', () => {
    const s = make()
    s.submit()
    s.authResult(false)
    expect(s.getState()).toMatchObject({ phase: 'idle', error: true })
    vi.advanceTimersByTime(10_000)
    expect(s.getState().phase).toBe('idle')
  })
})
