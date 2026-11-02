import { describe, expect, it } from 'vitest'
import { INITIAL_PLAYER, backoffMs, connected, failed, start, stopped } from './state'

describe('player state', () => {
  it('walks idle → connecting → playing and keeps holdFrame after the first picture', () => {
    const s1 = start(INITIAL_PLAYER)
    expect(s1.phase).toBe('connecting')
    expect(s1.holdFrame).toBe(false)
    const s2 = connected(s1)
    expect(s2).toMatchObject({ phase: 'playing', attempt: 0, holdFrame: true, lastError: null })
    const s3 = failed(s2, 'ice failed')
    expect(s3).toMatchObject({ phase: 'reconnecting', attempt: 1, holdFrame: true, lastError: 'ice failed' })
    const s4 = failed(s3, 'http_503')
    expect(s4.attempt).toBe(2)
    expect(stopped(s4).phase).toBe('stopped')
    expect(INITIAL_PLAYER.phase).toBe('idle')
  })

  it('backs off 1, 2, 4 s and caps at 5 s', () => {
    expect([0, 1, 2, 3, 10].map(backoffMs)).toEqual([1000, 2000, 4000, 5000, 5000])
  })
})
