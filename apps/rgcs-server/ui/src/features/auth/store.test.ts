import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../shared/api/client'
import type { Me } from '../../shared/api/types'
import { AuthStore } from './store'

const me: Me = { username: 'admin', role: 'admin', dev_mode: true, hostname: 'rgcs' }

function storeWith(api: (path: string, init?: unknown) => Promise<unknown>): AuthStore {
  return new AuthStore(api as never)
}

describe('AuthStore', () => {
  it('load() → authed with me on 200', async () => {
    const s = storeWith(vi.fn().mockResolvedValue(me))
    await s.load()
    expect(s.getState()).toEqual({ status: 'authed', me, error: null })
  })

  it('load() → anon without error on 401', async () => {
    const s = storeWith(vi.fn().mockRejectedValue(new ApiError(401, 'unauthorized', 'sign in first')))
    await s.load()
    expect(s.getState()).toEqual({ status: 'anon', me: null, error: null })
  })

  it('login() maps 401 → invalid, 429 → locked, network → network, 200 → authed', async () => {
    const api = vi
      .fn()
      .mockRejectedValueOnce(new ApiError(401, 'unauthorized', 'wrong'))
      .mockRejectedValueOnce(new ApiError(429, 'locked', 'try again'))
      .mockRejectedValueOnce(new ApiError(0, 'network', 'offline'))
      .mockResolvedValueOnce(me)
    const s = storeWith(api)
    await s.login('admin', 'x')
    expect(s.getState().error).toBe('invalid')
    await s.login('admin', 'x')
    expect(s.getState().error).toBe('locked')
    await s.login('admin', 'x')
    expect(s.getState().error).toBe('network')
    await s.login('admin', 'admin')
    expect(s.getState()).toEqual({ status: 'authed', me, error: null })
    expect(api).toHaveBeenLastCalledWith('/api/auth/login', {
      method: 'POST',
      body: { username: 'admin', password: 'admin' },
    })
  })

  it('logout() → anon and clears me', async () => {
    const s = storeWith(vi.fn().mockResolvedValue(me))
    await s.login('admin', 'admin')
    await s.logout()
    expect(s.getState()).toEqual({ status: 'anon', me: null, error: null })
  })

  it('setAnon() is idempotent and clearError() drops the error', async () => {
    const s = storeWith(vi.fn().mockRejectedValue(new ApiError(401, 'unauthorized', 'wrong')))
    await s.login('admin', 'x')
    const before = s.getState()
    s.clearError()
    expect(s.getState().error).toBeNull()
    s.setAnon()
    const after = s.getState()
    s.setAnon()
    expect(s.getState()).toBe(after)
    expect(before.error).toBe('invalid')
  })

  it('notifies subscribers on change only', async () => {
    const s = storeWith(vi.fn().mockResolvedValue(me))
    const listener = vi.fn()
    s.subscribe(listener)
    s.setAnon()
    s.setAnon()
    expect(listener).toHaveBeenCalledTimes(1)
    await s.load()
    expect(listener).toHaveBeenCalledTimes(2)
  })
})

describe('recheck()', () => {
  it('drops to anon only on 401 and keeps the session through network failures', async () => {
    const api = vi
      .fn()
      .mockResolvedValueOnce(me)
      .mockRejectedValueOnce(new ApiError(0, 'network', 'offline'))
      .mockRejectedValueOnce(new ApiError(401, 'unauthorized', 'expired'))
    const s = storeWith(api)
    await s.load()
    const authed = s.getState()
    await s.recheck()
    expect(s.getState()).toBe(authed)
    await s.recheck()
    expect(s.getState()).toEqual({ status: 'anon', me: null, error: null })
  })
})
