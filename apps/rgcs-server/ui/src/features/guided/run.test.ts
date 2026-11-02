import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../shared/api/client'
import { runGuided, startGuided, type StartDeps } from './run'

const body = { lat: 36, lon: 139, alt_mode: 'keep' as const }

describe('runGuided', () => {
  it('sends and reports the id and warning', async () => {
    const send = vi.fn().mockResolvedValue({ id: 4, warning: null })
    expect(await runGuided(1, body, undefined, send)).toEqual({ kind: 'sent', id: 4, warning: null })
    expect(send).toHaveBeenCalledWith(1, { ...body, confirm_token: undefined })
  })

  it('maps mode_required, confirm_required, fence_alt and other errors', async () => {
    const errs = [
      new ApiError(409, 'mode_required', 'switch to GUIDED first'),
      new ApiError(409, 'confirm_required', 'confirm token required'),
      new ApiError(409, 'fence_alt', 'above FENCE_ALT_MAX'),
      new ApiError(503, 'link_lost', 'no heartbeat'),
    ]
    const send = vi.fn()
    for (const e of errs) send.mockRejectedValueOnce(e)
    expect(await runGuided(1, body, undefined, send)).toEqual({ kind: 'mode_required' })
    expect(await runGuided(1, body, undefined, send)).toEqual({ kind: 'needs_confirm', message: 'confirm token required' })
    expect(await runGuided(1, body, undefined, send)).toEqual({ kind: 'error', code: 'fence_alt', message: 'above FENCE_ALT_MAX' })
    expect(await runGuided(1, body, undefined, send)).toEqual({ kind: 'error', code: 'link_lost', message: 'no heartbeat' })
  })
})

describe('startGuided (one press of 移動開始)', () => {
  const tok = (cmd: string) => Promise.resolve({ confirm_token: `tok-${cmd}`, expires_in: 30 })
  function deps(mode: string, over: Partial<StartDeps> = {}) {
    const calls: string[] = []
    let current = mode
    const d: StartDeps = {
      mode: () => current,
      confirm: vi.fn(async (_s: number, cmd: string) => {
        calls.push(`confirm:${cmd}`)
        return tok(cmd)
      }),
      command: vi.fn(async (_s, c, t) => {
        calls.push(`command:${c.cmd}:${(c as { args?: { mode?: string } }).args?.mode}:${t}`)
        current = 'GUIDED'
        return { id: 1, status: 'queued' }
      }),
      waitFor: vi.fn(async (pred: () => boolean) => pred()),
      send: vi.fn(async (_s, b) => {
        calls.push(`send:${b.confirm_token}`)
        return { id: 9, warning: null }
      }),
      ...over,
    }
    return { d, calls }
  }
  it('already GUIDED: sends the target at once', async () => {
    const { d, calls } = deps('GUIDED')
    expect(await startGuided(1, body, d)).toEqual({ kind: 'sent', id: 9, warning: null })
    expect(calls).toEqual(['send:undefined'])
  })
  it('switches to GUIDED without a confirm token, waits until the vehicle reports it, then sends the target', async () => {
    const { d, calls } = deps('LOITER')
    expect(await startGuided(1, body, d)).toEqual({ kind: 'sent', id: 9, warning: null })
    expect(calls).toEqual(['command:set_mode:GUIDED:undefined', 'send:undefined'])
    expect(d.confirm).not.toHaveBeenCalled()
    expect(d.waitFor).toHaveBeenCalledWith(expect.any(Function), 5000)
  })
  it('never sends the target when the vehicle does not reach GUIDED', async () => {
    const { d, calls } = deps('LOITER', { command: vi.fn(async () => ({ id: 1, status: 'queued' })), waitFor: vi.fn(async () => false) })
    expect(await startGuided(1, body, d)).toEqual({ kind: 'error', code: 'mode_timeout', message: 'GUIDED' })
    expect(calls).toEqual([])
    expect(d.send).not.toHaveBeenCalled()
  })
  it('answers the server confirm itself: the press is the confirmation', async () => {
    const send = vi.fn().mockRejectedValueOnce(new ApiError(409, 'confirm_required', 'confirm token required')).mockResolvedValueOnce({ id: 3, warning: null })
    const { d } = deps('GUIDED', { send })
    expect(await startGuided(1, body, d)).toEqual({ kind: 'sent', id: 3, warning: null })
    expect(d.confirm).toHaveBeenCalledWith(1, 'guided')
    expect(send).toHaveBeenLastCalledWith(1, { ...body, confirm_token: 'tok-guided' })
  })
  it('reports a refused mode change as an error', async () => {
    const { d } = deps('LOITER', { command: vi.fn().mockRejectedValue(new ApiError(503, 'link_lost', 'no heartbeat')) })
    expect(await startGuided(1, body, d)).toEqual({ kind: 'error', code: 'link_lost', message: 'no heartbeat' })
    expect(d.send).not.toHaveBeenCalled()
  })
})
