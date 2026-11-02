import { describe, expect, it } from 'vitest'
import { localResult } from './result'

describe('localResult', () => {
  it('carries the MAV_CMD of an other command', () => {
    const r = localResult(1, { cmd: 'other', args: { mav_cmd: 511, params: [30, 0, 0, 0, 0, 0, 0] } }, 'boom', 5)
    expect(r).toEqual({ id: -5, sysid: 1, cmd: 'other', ok: false, reason: 'boom', ts: 5, mav_cmd: 511 })
  })
  it('leaves named commands without one', () => {
    expect(localResult(2, { cmd: 'rtl' }, 'x', 6)).toEqual({ id: -6, sysid: 2, cmd: 'rtl', ok: false, reason: 'x', ts: 6 })
  })
})
