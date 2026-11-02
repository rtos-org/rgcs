import { describe, expect, it } from 'vitest'
import { EMPTY_PENDING, PENDING_TTL_MS, clearPending, isPending, markPending } from './pending'

describe('pending camera commands', () => {
  it('marks, expires after 3 s and clears on the next camera_state', () => {
    const p = markPending(EMPTY_PENDING, 1, 'record_start', 1000)
    expect(isPending(p, 1, 1500)).toBe(true)
    expect(isPending(p, 2, 1500)).toBe(false)
    expect(isPending(p, 1, 1000 + PENDING_TTL_MS)).toBe(false)
    expect(isPending(clearPending(p, 1), 1, 1500)).toBe(false)
    expect(clearPending(EMPTY_PENDING, 1)).toBe(EMPTY_PENDING)
    expect(PENDING_TTL_MS).toBe(3000)
  })
})
