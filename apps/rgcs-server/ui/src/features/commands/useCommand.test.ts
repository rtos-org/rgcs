import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../shared/api/client'
import { runCommand } from './useCommand'

describe('runCommand', () => {
  it('asks for confirmation before calling the API for confirm-required commands', async () => {
    const send = vi.fn()
    const r = await runCommand(1, { cmd: 'arm' }, undefined, send)
    expect(r).toEqual({ kind: 'needs_confirm' })
    expect(send).not.toHaveBeenCalled()
  })

  it('sends immediately when a token is given or the command needs none', async () => {
    const send = vi.fn().mockResolvedValue({ id: 5 })
    expect(await runCommand(1, { cmd: 'arm' }, 'tok', send)).toEqual({ kind: 'queued', id: 5 })
    expect(send).toHaveBeenLastCalledWith(1, { cmd: 'arm' }, 'tok')
    expect(await runCommand(1, { cmd: 'pause' }, undefined, send)).toEqual({ kind: 'queued', id: 5 })
    expect(send).toHaveBeenLastCalledWith(1, { cmd: 'pause' }, undefined)
  })

  it('sends mode change, RTL and land without a confirmation', async () => {
    const send = vi.fn().mockResolvedValue({ id: 7 })
    for (const command of [{ cmd: 'rtl' }, { cmd: 'land' }, { cmd: 'set_mode', args: { mode: 'LOITER' } }] as const) {
      expect(await runCommand(1, command, undefined, send)).toEqual({ kind: 'queued', id: 7 })
      expect(send).toHaveBeenLastCalledWith(1, command, undefined)
    }
  })

  it('maps 409 confirm_required (expired token) back to needs_confirm with the server message', async () => {
    const send = vi.fn().mockRejectedValue(new ApiError(409, 'confirm_required', 'confirm token expired'))
    expect(await runCommand(1, { cmd: 'arm' }, 'old', send)).toEqual({ kind: 'needs_confirm', message: 'confirm token expired' })
  })

  it('maps other API errors to error results', async () => {
    const send = vi.fn().mockRejectedValue(new ApiError(503, 'link_lost', 'no heartbeat for 10 s'))
    expect(await runCommand(1, { cmd: 'pause' }, undefined, send)).toEqual({ kind: 'error', code: 'link_lost', message: 'no heartbeat for 10 s' })
    const boom = vi.fn().mockRejectedValue(new Error('x'))
    expect(await runCommand(1, { cmd: 'pause' }, undefined, boom)).toEqual({ kind: 'error', code: 'unknown', message: 'x' })
  })

  it('passes the AI proposal id to the send', async () => {
    const send = vi.fn().mockResolvedValue({ id: 9 })
    expect(await runCommand(3, { cmd: 'rtl' }, undefined, send, { aiProposalId: 'p-1' })).toEqual({ kind: 'queued', id: 9 })
    expect(send).toHaveBeenLastCalledWith(3, { cmd: 'rtl' }, undefined, 'p-1')
    expect(await runCommand(3, { cmd: 'arm' }, undefined, send, { aiProposalId: 'p-1' })).toEqual({ kind: 'needs_confirm' })
    expect(send).toHaveBeenCalledTimes(1)
  })
})
