import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, apiFetch, setUnauthorizedHandler } from './client'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('apiFetch', () => {
  const fetchMock = vi.fn<typeof fetch>()
  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockReset()
    setUnauthorizedHandler(null)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('adds the CSRF header and same-origin credentials', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { success: true, data: null }))
    await apiFetch('/api/auth/logout', { method: 'POST' })
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe('/api/auth/logout')
    expect(init?.credentials).toBe('same-origin')
    expect(new Headers(init?.headers).get('X-Requested-With')).toBe('rgcs')
    expect(init?.method).toBe('POST')
  })

  it('accepts an empty 204 answer (DELETE)', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }))
    await expect(apiFetch('/api/missions/5', { method: 'DELETE' })).resolves.toBeUndefined()
  })

  it('sends JSON bodies and unwraps success envelopes', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { success: true, data: { a: 1 } }))
    const data = await apiFetch<{ a: number }>('/api/x', { method: 'POST', body: { q: 'v' } })
    expect(data).toEqual({ a: 1 })
    const [, init] = fetchMock.mock.calls[0]!
    expect(init?.body).toBe('{"q":"v"}')
    expect(new Headers(init?.headers).get('content-type')).toBe('application/json')
  })

  it('throws ApiError with code and status on failure envelopes', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(409, { success: false, error: { code: 'confirm_required', message: 'confirm token required' } }),
    )
    const err = await apiFetch('/api/x').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).status).toBe(409)
    expect((err as ApiError).code).toBe('confirm_required')
    expect((err as ApiError).message).toBe('confirm token required')
  })

  it('keeps retry_after_s of a rate-limit error', async () => {
    fetchMock.mockResolvedValue(jsonResponse(429, { success: false, error: { code: 'rate_limited', message: 'slow', retry_after_s: 12 } }))
    const err = await apiFetch('/api/ai/chat', { method: 'POST', body: {} }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiError)
    expect(err).toMatchObject({ status: 429, code: 'rate_limited', retryAfterS: 12 })
    fetchMock.mockResolvedValue(jsonResponse(409, { success: false, error: { code: 'ai_busy', message: 'busy' } }))
    expect(await apiFetch('/api/ai/chat').catch((e: unknown) => e)).toMatchObject({ retryAfterS: undefined })
  })

  it('calls the unauthorized handler once on 401 before throwing', async () => {
    const onUnauthorized = vi.fn()
    setUnauthorizedHandler(onUnauthorized)
    fetchMock.mockResolvedValue(jsonResponse(401, { success: false, error: { code: 'unauthorized', message: 'sign in first' } }))
    await expect(apiFetch('/api/vehicles')).rejects.toBeInstanceOf(ApiError)
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
  })

  it('maps a network failure to ApiError status 0 code network', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
    const err = (await apiFetch('/api/x').catch((e: unknown) => e)) as ApiError
    expect(err.status).toBe(0)
    expect(err.code).toBe('network')
  })
})
