import { describe, expect, it, vi } from 'vitest'
import type { ClientMessage } from '../../shared/api/types'
import { GimbalLoop } from './loop'
import { DEFAULT_PROFILE } from './profile'

function harness() {
  const sent: ClientMessage[] = []
  let now = 0
  let pad: { axes: readonly number[]; buttons: readonly boolean[] } | null = { axes: [0, 0], buttons: [false, false] }
  const onButton = vi.fn()
  const onRelease = vi.fn()
  const loop = new GimbalLoop({ send: (m) => (sent.push(m), true), onButton, onRelease, readGamepad: () => pad, now: () => now })
  return { sent, onButton, onRelease, loop, setPad: (p: typeof pad) => (pad = p), advance: (ms: number) => (now += ms) }
}

const rates = (sent: ClientMessage[]) => sent.filter((m) => m.t === 'gimbal_rate').map((m) => (m.t === 'gimbal_rate' ? [m.sysid, m.yaw, m.pitch] : []))

describe('GimbalLoop', () => {
  it('sends non-zero rates at 20 Hz and a single zero afterwards', () => {
    const h = h0()
    h.loop.start(DEFAULT_PROFILE, 1)
    h.setPad({ axes: [0.5, 0], buttons: [] })
    h.loop.tick()
    h.advance(50)
    h.loop.tick()
    expect(rates(h.sent)).toEqual([[1, 14, 0], [1, 14, 0]])
    h.setPad({ axes: [0, 0], buttons: [] })
    h.advance(50)
    h.loop.tick()
    h.advance(50)
    h.loop.tick()
    expect(rates(h.sent)).toEqual([[1, 14, 0], [1, 14, 0], [1, 0, 0]])
    const seqs = h.sent.filter((m) => m.t === 'gimbal_rate').map((m) => (m.t === 'gimbal_rate' ? m.seq : -1))
    expect(seqs).toEqual([1, 2, 3])
  })

  it('sends input_hb once per second only while a target is set', () => {
    const h = h0()
    h.loop.start(DEFAULT_PROFILE, 1)
    for (let i = 0; i < 25; i++) {
      h.loop.tick()
      h.advance(50)
    }
    expect(h.sent.filter((m) => m.t === 'input_hb')).toHaveLength(2)
    h.loop.setTarget(null)
    for (let i = 0; i < 25; i++) {
      h.loop.tick()
      h.advance(50)
    }
    expect(h.sent.filter((m) => m.t === 'input_hb')).toHaveLength(2)
  })

  it('setTarget sends zero to the old target then select once a pad has been seen', () => {
    const h = h0()
    h.loop.start(DEFAULT_PROFILE, 1)
    h.loop.tick()
    h.loop.setTarget(2)
    expect(h.sent).toEqual([
      { t: 'select', sysid: 1 },
      { t: 'input_hb', sysid: 1 },
      { t: 'gimbal_rate', sysid: 1, yaw: 0, pitch: 0, seq: 1 },
      { t: 'select', sysid: 2 },
    ])
  })

  it('without a gamepad, selecting vehicles sends select only: no zero, no heartbeat', () => {
    const h = h0()
    h.setPad(null)
    h.loop.start(DEFAULT_PROFILE, 1)
    for (let i = 0; i < 25; i++) {
      h.loop.tick()
      h.advance(50)
    }
    h.loop.setTarget(2)
    h.loop.stop()
    expect(h.sent).toEqual([{ t: 'select', sysid: 1 }, { t: 'select', sysid: 2 }])
  })

  it('disconnect sends zero and stops; stop() does the same', () => {
    const h = h0()
    h.loop.start(DEFAULT_PROFILE, 1)
    h.setPad({ axes: [1, 0], buttons: [] })
    h.loop.tick()
    h.setPad(null)
    h.advance(50)
    h.loop.tick()
    h.advance(50)
    h.loop.tick()
    expect(rates(h.sent)).toEqual([[1, 30, 0], [1, 0, 0]])
    h.setPad({ axes: [1, 0], buttons: [] })
    h.advance(50)
    h.loop.tick()
    expect(rates(h.sent)).toHaveLength(3)
    h.loop.stop()
    expect(rates(h.sent).at(-1)).toEqual([1, 0, 0])
    h.advance(50)
    h.loop.tick()
    expect(rates(h.sent)).toHaveLength(4)
  })

  it('routes rising button edges to onButton', () => {
    const h = h0()
    h.loop.start(DEFAULT_PROFILE, 1)
    h.setPad({ axes: [0, 0], buttons: [true, false] })
    h.loop.tick()
    h.loop.tick()
    expect(h.onButton).toHaveBeenCalledTimes(1)
    expect(h.onButton).toHaveBeenCalledWith('record_toggle', 1)
  })

  it('routes a press then a release of a held function to onButton then onRelease', () => {
    const h = h0()
    h.loop.start({ ...DEFAULT_PROFILE, buttons: [{ button: 0, fn: 'focus_far' }] }, 1)
    h.setPad({ axes: [0, 0], buttons: [true] })
    h.loop.tick()
    expect(h.onButton).toHaveBeenCalledWith('focus_far', 1)
    expect(h.onRelease).not.toHaveBeenCalled()
    h.setPad({ axes: [0, 0], buttons: [false] })
    h.loop.tick()
    expect(h.onRelease).toHaveBeenCalledOnce()
    expect(h.onRelease).toHaveBeenCalledWith('focus_far', 1)
  })

  it('a release goes to the vehicle the press went to, not the new selection', () => {
    const h = h0()
    h.loop.start({ ...DEFAULT_PROFILE, buttons: [{ button: 0, fn: 'focus_near' }, { button: 1, fn: 'focus_far' }] }, 1)
    h.setPad({ axes: [0, 0], buttons: [true, false] })
    h.loop.tick()
    expect(h.onButton).toHaveBeenLastCalledWith('focus_near', 1)
    h.loop.setTarget(2)
    h.setPad({ axes: [0, 0], buttons: [false, true] })
    h.loop.tick()
    expect(h.onRelease).toHaveBeenCalledWith('focus_near', 1)
    expect(h.onButton).toHaveBeenLastCalledWith('focus_far', 2)
    h.loop.setTarget(3)
    h.loop.stop()
    expect(h.onRelease).toHaveBeenLastCalledWith('focus_far', 2)
  })

  it('a pad that vanishes while a button is held releases it', () => {
    const h = h0()
    h.loop.start({ ...DEFAULT_PROFILE, buttons: [{ button: 0, fn: 'focus_near' }] }, 1)
    h.setPad({ axes: [0, 0], buttons: [true] })
    h.loop.tick()
    h.setPad(null)
    h.loop.tick()
    expect(h.onRelease).toHaveBeenCalledWith('focus_near', 1)
  })
})

function h0() {
  return harness()
}
