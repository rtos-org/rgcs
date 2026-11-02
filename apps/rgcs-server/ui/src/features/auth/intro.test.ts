import { describe, expect, it } from 'vitest'
import { IDLE, INTRO_MS, isScene, nextWake, step, type Intro } from './intro'

const submit = (s: Intro, now: number, reduced = false) => step(s, { type: 'submit', now, reduced })
const auth = (s: Intro, ok: boolean, now: number) => step(s, { type: 'auth', ok, now })
const tick = (s: Intro, now: number) => step(s, { type: 'tick', now })
const painted = (s: Intro, now: number) => step(s, { type: 'painted', now })

describe('intro state machine', () => {
  it('starts idle with no scene running', () => {
    expect(IDLE.phase).toBe('idle')
    expect(isScene(IDLE.phase)).toBe(false)
    expect(nextWake(IDLE)).toBeNull()
  })

  it('submit starts gather at once', () => {
    const s = submit(IDLE, 1000)
    expect(s.phase).toBe('gather')
    expect(s.at).toBe(1000)
    expect(s.error).toBe(false)
    expect(isScene(s.phase)).toBe(true)
  })

  it('gather waits for both the auth answer and 2400 ms', () => {
    let s = submit(IDLE, 0)
    s = auth(s, true, 300)
    expect(s.phase).toBe('gather')
    expect(nextWake(s)).toBe(INTRO_MS.gatherMin)
    expect(tick(s, 2399).phase).toBe('gather')
    s = tick(s, 2400)
    expect(s.phase).toBe('done')
    expect(s.at).toBe(2400)
  })

  it('a slow auth answer moves to done the moment it arrives', () => {
    let s = submit(IDLE, 0)
    expect(nextWake(s)).toBeNull()
    s = tick(s, 5000)
    expect(s.phase).toBe('gather')
    s = auth(s, true, 5200)
    expect(s.phase).toBe('done')
    expect(s.at).toBe(5200)
  })

  it('a failed auth returns to idle with the error at once', () => {
    let s = submit(IDLE, 0)
    s = auth(s, false, 400)
    expect(s.phase).toBe('idle')
    expect(s.error).toBe(true)
    expect(s.at).toBe(400)
    expect(nextWake(s)).toBeNull()
  })

  it('a new submit after a failure clears the error', () => {
    const s = submit(auth(submit(IDLE, 0), false, 400), 900)
    expect(s.phase).toBe('gather')
    expect(s.error).toBe(false)
  })

  it('done waits 700 ms and for the app first paint', () => {
    let s = tick(auth(submit(IDLE, 0), true, 100), 2400)
    expect(nextWake(s)).toBe(2400 + INTRO_MS.paintMax)
    s = tick(s, 3100)
    expect(s.phase).toBe('done')
    s = painted(s, 3300)
    expect(s.phase).toBe('clear')
    expect(s.at).toBe(3300)
  })

  it('a paint before 700 ms still holds done for 700 ms', () => {
    let s = tick(auth(submit(IDLE, 0), true, 100), 2400)
    s = painted(s, 2500)
    expect(s.phase).toBe('done')
    expect(nextWake(s)).toBe(3100)
    expect(tick(s, 3100).phase).toBe('clear')
  })

  it('done gives up on the paint after 1500 ms', () => {
    let s = tick(auth(submit(IDLE, 0), true, 100), 2400)
    expect(tick(s, 3899).phase).toBe('done')
    s = tick(s, 3900)
    expect(s.phase).toBe('clear')
  })

  it('clear runs about 4100 ms, then the app phase ends the scene', () => {
    let s = tick(tick(auth(submit(IDLE, 0), true, 100), 2400), 3900)
    expect(s.phase).toBe('clear')
    expect(nextWake(s)).toBe(3900 + INTRO_MS.clear)
    expect(tick(s, 7999).phase).toBe('clear')
    s = tick(s, 8000)
    expect(s.phase).toBe('app')
    expect(isScene(s.phase)).toBe(false)
    expect(nextWake(s)).toBeNull()
  })

  it('reduced motion: no 2400 ms hold, a 300 ms crossfade, no clear', () => {
    let s = submit(IDLE, 0, true)
    expect(s.reduced).toBe(true)
    s = auth(s, true, 200)
    expect(s.phase).toBe('done')
    expect(nextWake(s)).toBe(200 + INTRO_MS.reduced)
    s = tick(s, 500)
    expect(s.phase).toBe('app')
  })

  it('ignores auth answers and paints outside their phase', () => {
    expect(auth(IDLE, true, 10)).toBe(IDLE)
    expect(painted(IDLE, 10)).toBe(IDLE)
    const g = submit(IDLE, 0)
    expect(painted(g, 10).phase).toBe('gather')
  })

  it('ignores a second submit while the scene runs', () => {
    const g = submit(IDLE, 0)
    expect(submit(g, 50)).toBe(g)
  })
})
