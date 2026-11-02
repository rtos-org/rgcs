import { describe, expect, it } from 'vitest'
import { secondsLeft } from './countdown'

describe('secondsLeft', () => {
  it('rounds up and never goes below zero', () => {
    expect(secondsLeft(10_000, 5_100)).toBe(5)
    expect(secondsLeft(10_000, 5_000)).toBe(5)
    expect(secondsLeft(10_000, 9_999)).toBe(1)
    expect(secondsLeft(10_000, 10_500)).toBe(0)
  })
  it('is null without a deadline', () => {
    expect(secondsLeft(null, 5_000)).toBeNull()
  })
})
