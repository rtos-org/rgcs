import { describe, expect, it } from 'vitest'
import type { LogEntry } from '../../shared/api/types'
import { clearPress, failPress, NO_FEEDBACK, press, settle, stateOf } from './feedback'

const entry = (id: number, sysid: number, text: string, severity: 'ok' | 'error' = 'ok'): LogEntry => ({ id, ts: 0, sysid, source: 'command', severity, text, ackable: false, acked_by: null, acked_at: null })
const old = [entry(1, 1, 'pause')]

describe('command button feedback', () => {
  it('is sending after a press and ok when a new result for that command arrives', () => {
    const fb = press(NO_FEEDBACK, 1, 'pause', old, 1000)
    expect(stateOf(fb, 1, 'pause', 1000)).toBe('sending')
    expect(settle(fb, old, 1500)).toBe(fb)
    const done = settle(fb, [entry(2, 1, 'pause'), ...old], 1500)
    expect(stateOf(done, 1, 'pause', 1500)).toBe('ok')
    expect(stateOf(done, 1, 'pause', 5400)).toBe('ok')
    expect(stateOf(done, 1, 'pause', 5600)).toBeNull()
  })
  it('a failed result marks the button failed', () => {
    const fb = settle(press(NO_FEEDBACK, 1, 'rtl', [], 0), [entry(3, 1, 'rtl rejected', 'error')], 10)
    expect(stateOf(fb, 1, 'rtl', 10)).toBe('fail')
  })
  it('results of another vehicle or command do not settle it', () => {
    const fb = press(NO_FEEDBACK, 1, 'pause', [], 0)
    const same = settle(fb, [entry(4, 2, 'pause'), entry(5, 1, 'resume')], 10)
    expect(stateOf(same, 1, 'pause', 10)).toBe('sending')
    expect(stateOf(same, 2, 'pause', 10)).toBeNull()
  })
  it('a send error fails it at once; a cancelled confirm clears it; sending gives up after 15 s', () => {
    const fb = press(NO_FEEDBACK, 1, 'land', [], 0)
    expect(stateOf(failPress(fb, 1, 'land', 5), 1, 'land', 5)).toBe('fail')
    expect(stateOf(clearPress(fb, 1, 'land'), 1, 'land', 5)).toBeNull()
    expect(stateOf(fb, 1, 'land', 15_001)).toBeNull()
  })
})
